"""The recorder: poll the watchlist, write the tape, keep going.

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
from modules.coherence import recorder_durability as durable
from modules.coherence import tunables, warm
from modules.coherence.drivers.kalshi_rest import KalshiClient, KalshiUnavailable
from modules.coherence.episodes import EpisodeTracker
from modules.coherence.fs import calibration_store, corpus
from modules.coherence.fs.store import BookRow, CoherenceStore, TapeUnavailable, get_store
from modules.coherence.kernel.coherence_index import measure
from modules.coherence.kernel.costs import FeeSchedule
from modules.coherence.kernel.lattice import build_component
from modules.coherence.scheduler.budget import get_read_budget
from modules.coherence.syscalls import calibrate
from modules.coherence.syscalls.certify import certify
from modules.coherence.syscalls.live_universe import observe_live_families
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
    episodes_recovered: int = 0
    certification_decisions: int = 0
    campaign: dict[str, Any] = field(default_factory=dict)
    storage: dict[str, Any] = field(default_factory=dict)
    series_seen: set[str] = field(default_factory=set)

    def to_dict(self) -> dict[str, Any]:
        return {
            "running": self.running,
            "configured": tunables.watchlist_configured() and tunables.POLL_SECONDS > 0,
            "poll_seconds": durable.active_poll_seconds(self.campaign),
            "watchlist": (
                [f"up to {tunables.LIVE_FAMILY_LIMIT} open Kalshi families"]
                if tunables.LIVE_FAMILY_LIMIT else list(tunables.SERIES_WATCHLIST)
            ),
            "polls": self.polls,
            "books_written": self.books_written,
            "last_poll_ts_ns": self.last_poll_ts_ns,
            "seconds_since_last_poll": (
                None if self.last_poll_ts_ns is None else round((time.time_ns() - self.last_poll_ts_ns) / 1e9, 1)
            ),
            "last_error": self.last_error,
            "consecutive_failures": self.consecutive_failures,
            "episodes_closed": self.episodes_closed,
            "episodes_recovered": self.episodes_recovered,
            "certification_decisions": self.certification_decisions,
            "campaign": self.campaign or durable.default_campaign_status(),
            "storage": self.storage or durable.default_storage_status(),
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

    A test, notebook and the loop all take this same path.
    """
    tracked = state or _STATE
    poll_id, written = time.time_ns(), 0
    series_decisions = {ticker: 0 for ticker in tunables.SERIES_WATCHLIST}
    observations: list[Observation] = []
    tagged: list[tuple[str, Any]] = []
    live_notes: list[str] = []
    if tunables.LIVE_FAMILY_LIMIT > 0:
        batch = await observe_live_families(client, tunables.LIVE_FAMILY_LIMIT)
        observations, live_notes = batch.observations, batch.notes
        tagged = [(item.event.series_ticker, item) for item in observations]
    else:
        for series_ticker in tunables.SERIES_WATCHLIST:
            series_observations = await observe_series(
                client, series_ticker, max_events=tunables.MAX_EVENTS_PER_SERIES,
                require_selected_complete=True,
            )
            observations.extend(series_observations)
            tagged.extend((series_ticker, item) for item in series_observations)

    for series_ticker, observation in tagged:
        series_decisions.setdefault(series_ticker, 0)
        rows = rows_from(observation)
        if not rows:
            continue
        written += await asyncio.to_thread(store.record_books, rows)
        tracked.series_seen.add(series_ticker)
        if await _measure(observation, store, tracked):
            series_decisions[series_ticker] += 1

    await durable.finish_campaign_poll(
        store, tracked, poll_id=poll_id,
        series_decisions=series_decisions, books_written=written,
    )
    if shareable := [item for item in observations if isinstance(item, Observation)]:
        warm.publish_observations(
            shareable, notes=live_notes,
            family_limit=tunables.LIVE_FAMILY_LIMIT or None, mark_pass=True,
        )
    tracked.polls += 1
    tracked.books_written += written
    tracked.last_poll_ts_ns = time.time_ns()
    return written


async def _measure(observation: Observation, store: CoherenceStore, tracked: RecorderState) -> bool:
    """Index the family and track its violation episode.

    Failures here must not cost the forward-only raw tape.
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
    inserted = await durable.persist_decision(
        store, component=component, observation=observation,
        certificate=certificate, reading=reading, violated=violated,
    )
    if not inserted:
        # Counting the same snapshot twice would shorten an open episode.
        return False
    tracked.certification_decisions += 1
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
    return True


def restore_episode_tracker(store: CoherenceStore) -> tuple[int, int]:
    global _EPISODES
    _EPISODES, recovered = durable.restore_episode_tracker(store)
    return len(_EPISODES.open_episodes), recovered

maintain_storage = durable.maintain_storage

def _calibration_due(store: CoherenceStore, now_ns: int | None) -> int | None:
    """The instant to score at when the cadence says so, else None.

    One predicate for the harvest and the score, so the two can never disagree
    about whether this iteration is a scoring one. Read off the tape rather
    than held in memory: each recorded row IS a run, and a copy that reset on
    restart could disagree with the series it describes.
    """
    every = tunables.CALIBRATION_EVERY_SECONDS
    if every <= 0:
        return None
    stamp = time.time_ns() if now_ns is None else now_ns
    last = calibration_store.last_calibration_ns(store)
    if last is not None and stamp - last < every * 1_000_000_000:
        return None
    return stamp


async def harvest_if_due(client: KalshiClient, store: CoherenceStore, now_ns: int | None = None) -> bool:
    """Read settled markets when a score is due, so the score has something to score.

    THE ONE EXCHANGE READ THE CADENCE MAKES, and it exists because for a week it
    did not. ``calibrate.harvest`` had exactly one caller — the calibration
    ROUTE — so the settlements table filled only while a reader had the
    Settlement pane open. On the OCI gateway nobody does, and the recorded
    score series was 98 runs against a corpus nobody had harvested.

    A sibling of ``score_if_due`` on the same predicate, called before it.

    Returns whether anything was read. Idempotent on the table: settlements
    are de-duplicated on ticker by ``record_settlements``.
    """
    stamp = _calibration_due(store, now_ns)
    if stamp is None:
        return False
    result = await calibrate.harvest(client, store, tunables.SERIES_WATCHLIST)
    return bool(result.get("read"))


def score_if_due(store: CoherenceStore, now_ns: int | None = None) -> bool:
    """Take one settled score when the cadence says it is due. Returns whether it wrote.

    THE BOOK POLL IS NOT THE RIGHT CLOCK FOR THIS. Nothing settles in five
    minutes, so scoring on every poll would write three hundred near-identical
    rows a day and call it a series. `COHERENCE_CALIBRATION_EVERY_S` is its own
    cadence and is off unless set.

    IT COSTS NO EXCHANGE READ, and that is why it takes no client. `calibrate.score`
    is handed the store alone — no harvest — so it scores settlements the tape
    already holds. The read that fills the table moved next door, to
    ``harvest_if_due``, on the same cadence: a scoring pass that fetched would
    put a slow call inside a loop whose budget is spent on books, and a scoring
    pass that never fetched scored an empty corpus for a week.

    A REFUSAL IS STILL A ROW. On a cold tape nothing has settled and the report
    comes back with null figures and a reason; writing it is what makes "the
    recorder was running and the corpus was not ready" distinguishable from a
    gap in the record. The row also carries the horizon floor it was scored
    under, so the series can be read against the Scorecard's snapshot.
    """
    stamp = _calibration_due(store, now_ns)
    if stamp is None:
        return False
    calibration_store.record_calibration(
        store, calibrate.score(store, horizon_s=corpus.MIN_HORIZON_S), now_ns=stamp, horizon_s=corpus.MIN_HORIZON_S,
    )
    return True


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
    global _EPISODES
    if not tunables.watchlist_configured() or tunables.POLL_SECONDS <= 0:
        logger.info("coherence: recorder idle (set COHERENCE_SERIES and COHERENCE_POLL_S to record)")
        return

    store = get_store()
    client = KalshiClient(budget=get_read_budget())
    backoff = Backoff(base_s=BACKOFF_BASE_S, ceiling_s=BACKOFF_CEILING_S)
    _STATE.running = True
    target = f"{tunables.LIVE_FAMILY_LIMIT} live families" if tunables.LIVE_FAMILY_LIMIT else ",".join(tunables.SERIES_WATCHLIST)
    logger.info("coherence: recording %s every %ss", target, tunables.POLL_SECONDS)
    try:
        await _seed_budget(client)
        durable_state_ready = False
        while True:
            try:
                cycle_started = time.monotonic()
                if not durable_state_ready:
                    # Recovery must precede the first new observation.
                    _EPISODES = await asyncio.to_thread(
                        durable.initialise_durable_state, store, _STATE
                    )
                    durable_state_ready = True
                await asyncio.to_thread(maintain_storage, store, _STATE)
                written = await poll_once(client, store)
                _STATE.consecutive_failures = 0
                _STATE.last_error = None
                backoff = Backoff(base_s=BACKOFF_BASE_S, ceiling_s=BACKOFF_CEILING_S)
                logger.debug("coherence: wrote %d books", written)
                # Score after the books, never instead of them.
                if await harvest_if_due(client, store):
                    logger.debug("coherence: harvested settled markets")
                if await asyncio.to_thread(score_if_due, store):
                    logger.debug("coherence: recorded a settled score")
                interval = durable.active_poll_seconds(_STATE.campaign)
                await asyncio.sleep(durable.remaining_poll_delay_s(interval, cycle_started, time.monotonic()))
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
