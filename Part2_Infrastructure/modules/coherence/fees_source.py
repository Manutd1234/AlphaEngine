"""Which fee schedule a market trades under, from the exchange's own feeds.

Three sources, in the order they override one another:

1. ``GET /series`` carries ``fee_type`` and ``fee_multiplier`` per series. This
   is the base, and the multiplier MULTIPLIES the published rate rather than
   replacing it — live it is 1 on almost every series and 0.5 or 0 on a few, so
   reading it as the rate prices every fee seven cents on the dollar too low.
2. ``GET /series/fee_changes`` schedules a change to a whole series.
3. ``GET /events/fee_changes`` overrides one event, and this is the mechanism
   Kalshi uses to flip fees at event time — a sports series sitting at half rate
   until first pitch, then full.

Overrides are applied by ``scheduled_ts``: a change dated in the future has not
happened yet, and a null override means the override was cleared and the series
value applies again.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Sequence

from modules.coherence import tunables
from modules.coherence.kernel.costs import FeeSchedule


def _decimal(value: Any, default: Decimal) -> Decimal:
    if value is None:
        return default
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return default


def _timestamp(value: Any) -> datetime | None:
    if not value:
        return None
    text = str(value).replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


@dataclass(frozen=True, slots=True)
class FeeSource:
    """Where a schedule came from, so a certificate can cite it."""

    schedule: FeeSchedule
    basis: str


def schedule_for(
    series_payload: dict[str, Any] | None,
    series_changes: Sequence[dict[str, Any]] | None = None,
    event_changes: Sequence[dict[str, Any]] | None = None,
    event_ticker: str = "",
    now: datetime | None = None,
) -> FeeSource:
    """The effective schedule for one event, and one sentence saying why.

    ``now`` is a parameter rather than a call to the clock: this decides which
    scheduled changes have taken effect, and a function that reads the clock
    itself cannot be replayed against a recorded tape.
    """
    moment = now or datetime.now(timezone.utc)
    multiplier = Decimal(1)
    basis = "the published general rate, with no series multiplier found"

    series = (series_payload or {}).get("series", series_payload) or {}
    if series:
        multiplier = _decimal(series.get("fee_multiplier"), Decimal(1))
        basis = f"series {series.get('ticker', '')} carries a fee multiplier of {multiplier}"

    for change in sorted(series_changes or [], key=lambda row: str(row.get("scheduled_ts", ""))):
        scheduled = _timestamp(change.get("scheduled_ts"))
        if scheduled is None or scheduled > moment:
            continue
        multiplier = _decimal(change.get("fee_multiplier"), multiplier)
        basis = f"a scheduled series fee change took effect at {scheduled:%Y-%m-%d %H:%M} UTC"

    for change in sorted(event_changes or [], key=lambda row: str(row.get("scheduled_ts", ""))):
        if event_ticker and str(change.get("event_ticker", "")) != event_ticker:
            continue
        scheduled = _timestamp(change.get("scheduled_ts"))
        if scheduled is None or scheduled > moment:
            continue
        override = change.get("fee_multiplier_override")
        if override is None:
            # Cleared: the series value applies again. Not "zero".
            basis = f"an event override was cleared at {scheduled:%Y-%m-%d %H:%M} UTC, so the series rate applies"
            continue
        multiplier = _decimal(override, multiplier)
        basis = f"an event fee override of {multiplier} took effect at {scheduled:%Y-%m-%d %H:%M} UTC"

    return FeeSource(
        schedule=FeeSchedule(
            multiplier=multiplier,
            taker_rate=tunables.TAKER_RATE,
            maker_ratio=tunables.MAKER_RATIO,
            balance_precision=tunables.BALANCE_PRECISION,
        ),
        basis=basis,
    )
