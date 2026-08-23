"""``fees`` — the three-component cost, worked through so a reader can check it.

Not a calculator so much as a demonstration. The fee that matters on this
exchange is not the one in the schedule: it is the schedule's fee plus a
rounding component that is roughly fixed per FILL, which means the cost of a
position depends on how many pieces it fills in, and on small clips it can
exceed the notional outright.

That is the whole argument for a minimum clip size, and this module produces the
numbers behind it rather than asserting them.
"""

from __future__ import annotations

from decimal import Decimal

from modules.coherence.kernel.costs import (
    FeeSchedule,
    Fill,
    OrderFees,
    minimum_clip_hundredths,
    no_arbitrage_bound,
)
from modules.coherence.kernel.money import contracts, format_dollars
from modules.schemas_coherence import CoherenceFeeFill, CoherenceFees


def _fill_view(breakdown) -> CoherenceFeeFill:
    return CoherenceFeeFill(
        trade_fee=format_dollars(breakdown.trade_fee, 6),
        rounding_fee=format_dollars(breakdown.rounding_fee, 6),
        rebate=format_dollars(breakdown.rebate, 6),
        net=format_dollars(breakdown.net, 6),
        notional=format_dollars(breakdown.notional, 6),
    )


def worked_example(
    price: Decimal,
    size_hundredths: int,
    schedule: FeeSchedule,
    fills: int = 1,
    basket_prices: list[Decimal] | None = None,
) -> CoherenceFees:
    """Charge one position and show every component of what it cost."""
    order = OrderFees(schedule=schedule)
    per_piece = max(1, size_hundredths // max(1, fills))
    remaining = size_hundredths
    while remaining > 0:
        piece = min(per_piece, remaining)
        order.add(Fill(price=price, size_hundredths=piece))
        remaining -= piece

    total = order.total
    fraction = total.as_fraction_of_notional
    notes: list[str] = []
    if fraction is not None and fraction > 1:
        notes.append(
            "the net fee here exceeds the notional traded: at this size the rounding component "
            "alone is larger than the position"
        )
    if len(order.fills) > 1:
        notes.append(
            f"{len(order.fills)} fills each paid their own rounding; the rebate accumulator returned "
            f"{format_dollars(total.rebate, 6)} of it, which converges toward the single-fill cost without reaching it"
        )

    clip = minimum_clip_hundredths(price, Decimal("0.02"), schedule, expected_fills=fills)
    clip_note = (
        f"a two-cent edge per contract survives its fees from {contracts(clip)} contracts upward, at {fills} fill(s)"
        if clip
        else "no size makes a two-cent edge per contract worth trading at this price and fill count"
    )

    bound = no_arbitrage_bound(basket_prices, schedule, size_hundredths) if basket_prices else None

    return CoherenceFees(
        state="ok",
        price=format_dollars(price),
        contracts=str(contracts(size_hundredths)),
        fills=len(order.fills),
        multiplier=str(schedule.multiplier),
        balance_precision=format_dollars(schedule.balance_precision, 6),
        per_fill=[_fill_view(item) for item in order.fills],
        total=_fill_view(total),
        net_as_fraction_of_notional=None if fraction is None else f"{fraction:.4f}",
        minimum_clip=None if clip is None else str(contracts(clip)),
        minimum_clip_note=clip_note,
        naive_threshold="1.0000",
        fee_aware_threshold=None if bound is None else format_dollars(bound),
        notes=notes,
    )
