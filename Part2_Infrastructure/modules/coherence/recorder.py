"""The recorder: poll the watchlist, write the tape, keep going.

Shaped after ``modules/tca_engine/supervision.py``'s snapshot loop, and for its
reasons — sleep the interval, do the work, hand every disk write to a thread so
the event loop is never held by DuckDB, re-raise ``CancelledError`` and log
anything else without stopping.

Why this runs before any strategy code exists: depth is forward-only. A book
you did not record at 14:32 cannot be recovered at 14:33 from any endpoint, and
the questions this engine is for — how long does a dislocation survive, did
moving crypto onto its own shard change how efficiently it prices — are
questions about a tape that has to already exist when you think to ask them.
The recorder is therefore the first thing switched on and the last thing that
should be switched off.

It is off by default. ``COHERENCE_POLL_S`` unset means no polling, because a
process that starts hitting an exchange the moment it boots is not something to
enable by accident.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any

from modules.backoff import Backoff
from modules.coherence import tunables
from modules.coherence.drivers.kalshi_rest import KalshiClient, KalshiUnavailable
from modules.coherence.episodes import EpisodeTracker
from modules.coherence.fs.store import BookRow, CoherenceStore, TapeUnavailable, get_store
from modules.coherence.kernel.coherence_index import measure
from modules.coherence.kernel.costs import FeeSchedule
from modules.coherence.kernel.lattice import build_component
from modules.coherence.scheduler.budget import get_read_budget
from modules.coherence.syscalls.certify import certify
from modules.coherence.syscalls.observe import Observation, observe_series

logger = logging.getLogger(__name__)

# A failing exchange should not become a hot loop. Base and ceiling are wide
# because the recorder's job is to be running in an hour, not to retry quickly.
BACKOFF_BASE_S = 2.0
BACKOFF_CEILING_S = 300.0


@dataclass(slots=True)
class RecorderState:
    """What the recorder has actually done. Read by the status route.

    Every field here is a measurement rather than an intention: "configured to
    poll every 15s" and "last wrote 40 minutes ago" are different facts, and a
    surface that shows only the first cannot report a stalled recorder.
    """

    running: bool = False
    polls: int = 0
    books_written: int = 0
    last_poll_ts_ns: int | None = None
    last_error: str | None = None
    last_error_ts_ns: int | None = None
    consecutive_failures: int = 0
    episodes_closed: int = 0
    series_seen: set[str] = field(default_factory=set)

    def to_dict(self) -> dict[str, Any]:
        return {
            "running": self.running,
            "configured": tunables.watchlist_configured() and tunables.POLL_SECONDS > 0,
            "poll_seconds": tunables.POLL_SECONDS,
            "watchlist": list(tunables.SERIES_WATCHLIST),
            "polls": self.polls,
            "books_written": self.books_written,
            "last_poll_ts_ns": self.last_poll_ts_ns,
            "seconds_since_last_poll": (
                None if self.last_poll_ts_ns is None else round((time.time_ns() - self.last_poll_ts_ns) / 1e9, 1)
            ),
            "last_error": self.last_error,
            "consecutive_failures": self.consecutive_failures,
            "episodes_closed": self.episodes_closed,
            "series_seen": sorted(self.series_seen),
        }


_STATE = RecorderState()

#: Episodes span polls, so the tracker outlives any one of them. Process-wide
#: for the same reason the tape is: two trackers would each see half the polls
#: and each conclude every violation was shorter than it was.
_EPISODES = EpisodeTracker()


def episode_tracker() -> EpisodeTracker:
    """The one tracker. Read by the routes, written by the loop."""
    return _EPISODES


def recorder_state() -> RecorderState:
    """The one state object. The route reads it; the loop writes it."""
    return _STATE


def rows_from(observation: Observation) -> list[BookRow]:
    """An observation to tape rows. Pure — the replay path uses it too."""
    return [
        BookRow(
            ts_ns=observation.ts_ns,
            ticker=item.ticker,
            event_ticker=observation.event.event_ticker,
            series_ticker=observation.event.series_ticker,
            exchange_index=observation.event.exchange_index,
            mutually_exclusive=observation.event.mutually_exclusive,
            book=item.book,
            source=f"kalshi:{observation.depth}",
        )
        for item in observation.markets
    ]


async def poll_once(client: KalshiClient, store: CoherenceStore, state: RecorderState | None = None) -> int:
    """One pass over the watchlist. Returns how many books were written.

    Each observation does three things: the books go on the tape, the family is
    measured for coherence, and any violation episode is opened or closed. All
    three happen on the same snapshot on purpose — an index computed from a
    later read than the books it describes is a measurement of two moments.

    Separated from the loop so a test, a notebook and the loop all take the
    same path, and so a single poll can be triggered without a background task.
    """
    tracked = state or _STATE
    written = 0
    for series_ticker in tunables.SERIES_WATCHLIST:
        observations = await observe_series(client, series_ticker)
        for observation in observations:
            rows = rows_from(observation)
            if not rows:
                continue
            written += await asyncio.to_thread(store.record_books, rows)
            tracked.series_seen.add(series_ticker)
            await _measure(observation, store, tracked)
    tracked.polls += 1
    tracked.books_written += written
    tracked.last_poll_ts_ns = time.time_ns()
    return written


async def _measure(observation: Observation, store: CoherenceStore, tracked: RecorderState) -> None:
    """Index the family and track its violation episode.

    Failures here are recorded and swallowed rather than allowed to stop the
    poll: the tape is the asset, and losing a book because an index could not
    be computed would trade the thing that cannot be recovered for the thing
    that can be recomputed from it later.
    """
    component = build_component(observation.event, [item.market for item in observation.markets])
    books = {item.ticker: item.book for item in observation.markets}
    reading = measure(component, books)
    await asyncio.to_thread(
        store.record_index,
        observation.ts_ns,
        component.series_ticker,
        component.event_ticker,
        component.exchange_index,
        reading.ci,
        reading.engine,
        reading.detail,
    )

    certificate = certify(observation, _schedule())
    violated = certificate.verdict == "incoherent" and certificate.worth_doing
    closed = _EPISODES.observe(
        component_id=component.component_id,
        series_ticker=component.series_ticker,
        event_ticker=component.event_ticker,
        exchange_index=component.exchange_index,
        ts_ns=observation.ts_ns,
        violated=violated,
        family=certificate.family,
        ci=reading.ci,
        net_edge=certificate.net_edge,
    )
    if closed is not None:
        await asyncio.to_thread(store.record_episode, closed)
        tracked.episodes_closed += 1


def _schedule() -> FeeSchedule:
    """The fee shape the recorder prices with.

    Read from configuration rather than fetched per poll: the per-series
    multiplier changes on a schedule measured in days, and spending a read
    token on it every fifteen seconds would buy nothing. The certify route
    fetches the live one when a reader asks for a specific family.
    """
    return FeeSchedule(
        taker_rate=tunables.TAKER_RATE,
        maker_ratio=tunables.MAKER_RATIO,
        balance_precision=tunables.BALANCE_PRECISION,
    )


async def recorder_loop() -> None:
    """Poll forever. Cancelled by the lifespan that started it.

    The exception handling is the load-bearing part. ``CancelledError`` is
    re-raised immediately — a task that swallows cancellation cannot be shut
    down — while every other failure backs off and continues, because the
    recorder's value is cumulative and a gap costs more than a retry.
    """
    if not tunables.watchlist_configured() or tunables.POLL_SECONDS <= 0:
        logger.info("coherence: recorder idle (set COHERENCE_SERIES and COHERENCE_POLL_S to record)")
        return

    store = get_store()
    client = KalshiClient(budget=get_read_budget())
    backoff = Backoff(base_s=BACKOFF_BASE_S, ceiling_s=BACKOFF_CEILING_S)
    _STATE.running = True
    logger.info(
        "coherence: recording %s every %ss",
        ",".join(tunables.SERIES_WATCHLIST),
        tunables.POLL_SECONDS,
    )
    try:
        await _seed_budget(client)
        while True:
            try:
                written = await poll_once(client, store)
                _STATE.consecutive_failures = 0
                _STATE.last_error = None
                backoff = Backoff(base_s=BACKOFF_BASE_S, ceiling_s=BACKOFF_CEILING_S)
                logger.debug("coherence: wrote %d books", written)
                await asyncio.sleep(tunables.POLL_SECONDS)
            except asyncio.CancelledError:
                raise
            except (KalshiUnavailable, TapeUnavailable) as exc:
                _record_failure(exc)
                backoff.failed()
                await asyncio.sleep(backoff.delay_s)
            except Exception as exc:  # noqa: BLE001 - a recorder that dies on a surprise records nothing
                logger.exception("coherence: unexpected failure in the recorder")
                _record_failure(exc)
                backoff.failed()
                await asyncio.sleep(backoff.delay_s)
    finally:
        _STATE.running = False


def _record_failure(exc: BaseException) -> None:
    reason = getattr(exc, "reason", None) or f"{type(exc).__name__}: {exc}"
    _STATE.last_error = str(reason)
    _STATE.last_error_ts_ns = time.time_ns()
    _STATE.consecutive_failures += 1
    logger.warning("coherence: poll failed (%s)", reason)


async def _seed_budget(client: KalshiClient) -> None:
    """Learn the exchange's own token costs before spending against a guess."""
    try:
        fetched = await client.endpoint_costs()
    except KalshiUnavailable as exc:
        logger.info("coherence: endpoint costs unavailable (%s); using published defaults", exc.reason)
        return
    learnt = get_read_budget().learn_costs(fetched.payload)
    logger.info("coherence: learnt %d non-default endpoint costs", learnt)
