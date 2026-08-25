"""The fee documents, cached, because certify was paying for them every time.

`schedule_for_event` in `modules/api/coherence.py` read three documents from the
venue, in series, on every certificate: the series (for its `fee_multiplier`),
the exchange's published fee-change list, and the per-event override. Measured
on 2026-08-25 that was **2.0 to 2.2 seconds of a 4.4-second certify** — about
fifty-five per cent of the read, spent re-reading documents that change on a
schedule measured in days.

Two of the three were already avoidable and nobody had noticed:

- `client.series(ticker)` is fetched a few files away by
  `series_meta.categories_for`, which caches it and argues at length that doing
  so is safe. The fee path fetched the same document again, uncached.
- `client.series_fee_changes()` takes NO ARGUMENT. It is one global list for the
  whole exchange, re-fetched once per certificate.

WHY A TTL AND NOT `series_meta`'S FOREVER. That file caches a series' CATEGORY,
which is a fact about what the series is. This one caches what it COSTS, and a
fee schedule is a thing the venue changes. `fees_source.schedule_for` compares
each `scheduled_ts` against the clock, so caching the LIST is safe — the verdict
is still computed fresh every time — but a change published inside the window is
applied late, by up to `FEE_META_TTL_S`. That is the trade, and it is stated
here rather than left for someone to discover from a fee that moved a day ago.

NEVER CACHES A REFUSAL. A series the venue would not answer for is simply not
stored, so the next caller tries again. Caching the absence would turn one bad
minute into an hour of the published default, and the published default is what
this engine reports when it cannot read — a real answer, not a placeholder.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from modules.coherence import tunables
from modules.coherence.drivers.kalshi_rest import KalshiClient, KalshiUnavailable
from modules.coherence.fees_source import schedule_for
from modules.coherence.kernel.costs import FeeSchedule

logger = logging.getLogger(__name__)

# value, stored_at_monotonic
_SERIES: dict[str, tuple[dict[str, Any], float]] = {}
_SERIES_CHANGES: tuple[list[dict[str, Any]], float] | None = None
_EVENT_CHANGES: dict[str, tuple[list[dict[str, Any]], float]] = {}


def _fresh(stored_at: float) -> bool:
    """Read the TTL at call time, so a test can move it without a restart."""
    ttl = tunables.FEE_META_TTL_S
    if ttl <= 0:
        return False
    return (time.monotonic() - stored_at) < ttl


async def series_payload(client: KalshiClient, ticker: str) -> dict[str, Any] | None:
    """The series document, or None if the venue would not answer for it."""
    hit = _SERIES.get(ticker)
    if hit is not None and _fresh(hit[1]):
        return hit[0]
    try:
        payload = (await client.series(ticker)).payload
    except KalshiUnavailable as exc:
        logger.info("coherence: no series document for %s (%s)", ticker, exc.reason)
        return None
    _SERIES[ticker] = (payload, time.monotonic())
    return payload


async def series_fee_changes(client: KalshiClient) -> list[dict[str, Any]]:
    """The exchange-wide fee-change list. One document for every series."""
    global _SERIES_CHANGES
    if _SERIES_CHANGES is not None and _fresh(_SERIES_CHANGES[1]):
        return _SERIES_CHANGES[0]
    try:
        payload = (await client.series_fee_changes()).payload
    except KalshiUnavailable as exc:
        logger.info("coherence: no series fee changes (%s)", exc.reason)
        return _SERIES_CHANGES[0] if _SERIES_CHANGES is not None else []
    rows = payload.get("series_fee_change_arr") or []
    _SERIES_CHANGES = (rows, time.monotonic())
    return rows


async def event_fee_changes(client: KalshiClient, event_ticker: str) -> list[dict[str, Any]]:
    """Per-event fee overrides, or an empty list when there are none."""
    hit = _EVENT_CHANGES.get(event_ticker)
    if hit is not None and _fresh(hit[1]):
        return hit[0]
    try:
        payload = (await client.event_fee_changes(event_ticker)).payload
    except KalshiUnavailable as exc:
        logger.info("coherence: no event fee changes for %s (%s)", event_ticker, exc.reason)
        return []
    rows = payload.get("event_fee_changes") or []
    _EVENT_CHANGES[event_ticker] = (rows, time.monotonic())
    return rows


async def documents_for(
    client: KalshiClient, series_ticker: str, event_ticker: str | None,
) -> tuple[dict[str, Any] | None, list[dict[str, Any]], list[dict[str, Any]]]:
    """All three documents, concurrently.

    They were read in series and nothing about them requires it — no argument of
    one is a result of another. On a cold cache this is one round trip instead
    of three; on a warm one it is no round trip at all.
    """
    series, changes, event = await asyncio.gather(
        series_payload(client, series_ticker),
        series_fee_changes(client),
        event_fee_changes(client, event_ticker) if event_ticker else _none_list(),
    )
    return series, changes, event


async def _none_list() -> list[dict[str, Any]]:
    return []


def forget_fee_meta() -> None:
    """Drop every cached document. For tests; one suite must not seed the next."""
    global _SERIES_CHANGES
    _SERIES.clear()
    _EVENT_CHANGES.clear()
    _SERIES_CHANGES = None


async def schedule_for_event(series_ticker: str, event_ticker: str) -> FeeSchedule:
    """The live fee schedule, falling back to the published rate on a refusal.

    A fee we could not read is reported as the published default rather than
    as zero: zero fees would make every basket look tradable, which is the one
    direction an error here must never take.
    """
    if not series_ticker:
        return FeeSchedule(
            taker_rate=tunables.TAKER_RATE, maker_ratio=tunables.MAKER_RATIO,
            balance_precision=tunables.BALANCE_PRECISION,
        )
    # THREE READS IN SERIES, ON EVERY CERTIFICATE, until 2026-08-25 — measured
    # at 2.0 to 2.2 seconds of a 4.4-second certify, or about fifty-five per
    # cent of it. All three fetch documents that move on a schedule of days,
    # one of them takes no argument at all, and one was already being fetched
    # and cached by `series_meta` a few files away. `fee_meta` holds them and
    # runs whatever is still cold concurrently; `schedule_for` still computes
    # the verdict fresh against the clock, which is the part that must not be
    # cached. Refusals are not cached, so a bad minute does not become an hour
    # of the published default.
    series_payload, series_changes, event_changes = await documents_for(
        KalshiClient(), series_ticker, event_ticker,
    )
    return schedule_for(series_payload, series_changes, event_changes, event_ticker).schedule
