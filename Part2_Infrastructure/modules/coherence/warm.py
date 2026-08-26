"""Answers computed before they are asked, so a read never waits on the venue.

WHY THIS EXISTS. Every read on the Proofs tab called Kalshi live on every poll
and nothing was cached, so the same question cost the same seconds every time it
was asked. Measured on 2026-08-25, before any of it was fixed:

    universe 6,732ms   certify 4,359ms   combos 3,356ms   status 1,535ms

Connection pooling and a fee-document cache took certify to about 520ms, which
is close to the floor a LIVE certificate has: `observe_event` makes two Kalshi
calls that are necessarily serial — `/events/{ticker}` returns the markets, and
`/markets/orderbooks` needs those tickers as its parameters — so no amount of
concurrency removes them. Sub-100ms is not reachable by making the call faster.
It is reachable by having already made it.

THE SHAPE FALLS OUT OF THE SYSCALLS. `certify` and `event_view` are pure
functions of an `Observation`; nothing about them touches the network. So ONE
`observe_series` pass per watchlist series produces every input both of them
need, and the universe a reader sees and the certificate they open are derived
from the SAME observation rather than from two reads seconds apart. That is a
correctness improvement as well as a speed one: the two could disagree before.

WHAT IT IS NOT. This is not a response cache in front of the routes. A route
asks for a snapshot and falls through to the live path when there is none — an
off-watchlist family, a cold process, a deployment with the refresher off. The
miss is slow and correct, never an error.

FRESHNESS IS A FIELD, NOT A GUESS. Every warmed payload carries `observed_at`,
the moment the venue was actually read, so the desk's age pill can say how old
the answer is rather than how recently it arrived. Without that this module
would make the desk faster and its freshness stamp a lie, which is a worse trade
than the latency it fixes. An entry older than `WARM_MAX_AGE_S` is not returned
at all: a dead refresher must not keep serving a ten-minute-old ladder as though
it were current.

OFF BY DEFAULT, for the reason the recorder is (`recorder.py:16-18`): a process
that starts reaching for an exchange the moment it boots is not something to
enable by accident.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from modules.coherence import fee_meta, tunables
from modules.coherence.drivers.kalshi_rest import KalshiClient, KalshiUnavailable
from modules.coherence.syscalls.certify import certify
from modules.coherence.syscalls.observe import Observation, observe_series
from modules.coherence.views import event_view

logger = logging.getLogger(__name__)

_MAX_CONTRACTS = 1000

# HOW MANY EVENTS A WARMED UNIVERSE HOLDS, spelled once.
#
# The refresher stores its universe under this number and a route serves a
# snapshot only when the request asks for the same one — which is right, because
# a universe of two events is a different answer from a universe of six, not a
# staler one. The hazard is that the desk's own default is written in
# `web/lib/coherence/routes.ts` and this is written here: if either moves, the
# refresher fills a cache nobody reads, every request goes to the venue, the
# latency comes back and every test stays green. `test_coherence_warm.py` pins
# the two together so that cannot happen quietly.
WARM_MAX_EVENTS = 2

# The parlay count the desk asks for, spelled once, for the same reason.
WARM_COMBOS_LIMIT = 6


@dataclass(frozen=True, slots=True)
class Snapshot:
    """One precomputed answer, and when the venue was read for it."""

    value: Any
    taken_at_ns: int

    def age_s(self, now_ns: int | None = None) -> float:
        stamp = time.time_ns() if now_ns is None else now_ns
        return max(0.0, (stamp - self.taken_at_ns) / 1_000_000_000)


@dataclass
class RefresherState:
    """What the refresher has managed, shaped like `RecorderState` so the
    status route can render it without new vocabulary."""

    running: bool = False
    passes: int = 0
    entries: int = 0
    last_pass_ns: int | None = None
    last_error: str | None = None
    consecutive_failures: int = 0
    _notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "running": self.running,
            "configured": tunables.WARM_SECONDS > 0 and bool(tunables.SERIES_WATCHLIST),
            "cadence_s": tunables.WARM_SECONDS or None,
            "passes": self.passes,
            "entries": self.entries,
            "seconds_since_last_pass": (
                None if self.last_pass_ns is None
                else round((time.time_ns() - self.last_pass_ns) / 1_000_000_000, 1)
            ),
            "last_error": self.last_error,
            "consecutive_failures": self.consecutive_failures,
        }


_CACHE: dict[tuple[str, ...], Snapshot] = {}
_STATE = RefresherState()


def warm_state() -> RefresherState:
    return _STATE


def max_age_s() -> int:
    """Three cadences unless told otherwise — derived, not a magic number.

    Long enough that one missed pass does not send every read back to the
    venue, short enough that a refresher which died an hour ago stops
    answering. Read at call time so a test can move it.
    """
    explicit = tunables.WARM_MAX_AGE_S
    if explicit > 0:
        return explicit
    return max(1, tunables.WARM_SECONDS * 3)


def snapshot_key(route: str, **params: Any) -> tuple[str, ...]:
    """The one place a key is built, for the refresher and the route alike.

    Two spellings of a key are two things to keep in agreement, and the first
    time they drift the refresher fills a cache nobody reads: every request goes
    to the venue, the latency comes back, and every test stays green.
    """
    return (route, *(f"{name}={params[name]}" for name in sorted(params)))


def snapshot_for(route: str, **params: Any) -> Snapshot | None:
    """The precomputed answer, or None when the route must read it live."""
    if tunables.WARM_SECONDS <= 0:
        return None
    held = _CACHE.get(snapshot_key(route, **params))
    if held is None:
        return None
    if held.age_s() > max_age_s():
        return None
    return held


def _store(route: str, value: Any, taken_at_ns: int, **params: Any) -> None:
    _CACHE[snapshot_key(route, **params)] = Snapshot(value=value, taken_at_ns=taken_at_ns)


async def refresh_once(client: KalshiClient) -> int:
    """One pass over the watchlist. Returns how many answers it stored.

    Every certificate here is derived from the observation the universe entry
    was built from, so the two cannot disagree, and the venue is read once for
    both rather than once each.
    """
    from modules.schemas import CoherenceCertificate, CoherenceUniverse

    watchlist = list(tunables.SERIES_WATCHLIST)
    if not watchlist:
        return 0

    observed_at = time.time_ns()
    events: list[Any] = []
    notes: list[str] = []
    observations: list[Observation] = []

    async def read(series_ticker: str) -> None:
        try:
            for observation in await observe_series(client, series_ticker, max_events=WARM_MAX_EVENTS):
                observations.append(observation)
        except KalshiUnavailable as exc:
            notes.append(f"{series_ticker} could not be read: {exc.reason}")

    await asyncio.gather(*(read(ticker) for ticker in watchlist))

    stored = 0
    for observation in observations:
        events.append(event_view(observation))
        notes.extend(observation.notes)
        try:
            schedule = await fee_meta.schedule_for_event(
                observation.event.series_ticker, observation.event.event_ticker,
            )
            certificate = certify(observation, schedule, max_contracts=Decimal(_MAX_CONTRACTS))
            payload = certificate.to_dict()
            payload["proof"] = certificate.render_text()
            _store(
                "certify", CoherenceCertificate(**payload), observed_at,
                event_ticker=observation.event.event_ticker, max_contracts=_MAX_CONTRACTS,
            )
            stored += 1
        except (KalshiUnavailable, ValueError) as exc:
            # A family that would not certify leaves NO entry rather than a bad
            # one: the route falls through and answers live, which is the
            # honest outcome and the one the reader would have had anyway.
            logger.info("coherence warm: %s did not certify (%s)", observation.event.event_ticker, exc)

    if events or notes:
        _store(
            "universe",
            CoherenceUniverse(
                state="ok" if events else ("unavailable" if notes else "empty"),
                events=events, watchlist=watchlist, categories={},
                notes=list(dict.fromkeys(notes)),
            ),
            observed_at,
            max_events=WARM_MAX_EVENTS,
        )
        stored += 1

    # COMBOS, because it is the slowest route on the tab and warming the other
    # two left the reader's worst page untouched: measured p95 6,252ms against
    # certify's 4,133ms. It needs its own venue call — a parlay is a listing the
    # exchange publishes rather than something derivable from the observations
    # above — so it is done here rather than skipped.
    try:
        # IMPORTED HERE, not at the top, and the reason is layering rather than
        # cycles: `combos_view` lives in the API layer because it builds a
        # response model, and this module is under `coherence/`. A deferred
        # import keeps the dependency at the one line that needs it instead of
        # making every importer of this module pull in FastAPI's view layer.
        from modules.api import coherence_lab_views as lab_views
        from modules.coherence.syscalls import combos as combos_syscall

        # THE LISTING IS STORED TOO, AND FETCHED ONCE FOR BOTH. It is the
        # expensive half of a combo read — a thousand open parlays, described —
        # and it is the half a NAMED read cannot avoid, because that is where a
        # parlay and its legs are described. Held here, `?ticker=` costs one
        # venue call instead of two and the answer is unchanged: the books are
        # still read for that request.
        listing = await combos_syscall.fetch_listing(client)
        _store("combos-listing", listing, observed_at)
        reading = await combos_syscall.observe_combos(
            client, limit=WARM_COMBOS_LIMIT, listing=listing,
        )
        _store("combos", lab_views.combos_view(reading), observed_at, limit=WARM_COMBOS_LIMIT)
        stored += 2
    except (KalshiUnavailable, ValueError) as exc:
        logger.info("coherence warm: combos did not read (%s)", exc)

    return stored


async def warm_loop() -> None:
    """Refresh on a cadence, or return immediately when unconfigured."""
    cadence = tunables.WARM_SECONDS
    if cadence <= 0 or not tunables.SERIES_WATCHLIST:
        logger.info("coherence warm: idle (COHERENCE_WARM_S=%s)", cadence)
        return

    client = KalshiClient()
    _STATE.running = True
    logger.info("coherence warm: refreshing every %ss", cadence)
    try:
        while True:
            try:
                _STATE.entries = await refresh_once(client)
                _STATE.passes += 1
                _STATE.last_pass_ns = time.time_ns()
                _STATE.last_error = None
                _STATE.consecutive_failures = 0
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 — a pass must never end the loop
                # The previous entries STAY. A snapshot from forty seconds ago
                # plus a named failure beats nothing at all, and `max_age_s()`
                # is what stops it being served for ever.
                _STATE.last_error = f"{type(exc).__name__}: {exc}"
                _STATE.consecutive_failures += 1
                logger.warning("coherence warm: pass failed (%s)", _STATE.last_error)
            await asyncio.sleep(cadence)
    finally:
        _STATE.running = False


def forget_snapshots() -> None:
    """Drop every entry. For tests; one suite must not seed the next."""
    _CACHE.clear()
