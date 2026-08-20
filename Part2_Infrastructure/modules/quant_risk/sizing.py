"""Kelly sizing, quartered and capped."""

from __future__ import annotations

from dataclasses import dataclass

# --------------------------------------------------------------------------- #
# Position sizing
# --------------------------------------------------------------------------- #

@dataclass
class KellySizing:
    full_kelly: float
    fraction_used: float
    recommended_fraction: float
    recommended_notional: float
    win_rate: float
    payoff_ratio: float
    edge_per_trade: float
    capped_by: str | None
    note: str


def kelly_fraction(
    win_rate: float,
    payoff_ratio: float,
    equity: float,
    *,
    fraction: float = 0.25,
    max_fraction: float = 0.20,
) -> KellySizing:
    """
    Kelly sizing, deliberately fractional and capped.

    ``f* = W − (1 − W) / R`` — the growth-optimal fraction for a bet that wins
    ``W`` of the time at a payoff ratio ``R``.

    Full Kelly is almost always the wrong number to trade, for a reason worth
    stating rather than assuming: ``f*`` is optimal *given that W and R are
    known exactly*. They never are — they are estimates from a backtest, and
    over-estimating the edge makes Kelly over-bet super-linearly while the
    penalty for under-betting is merely slower growth. Half-Kelly gives ~75% of
    the growth at ~half the volatility; quarter-Kelly is the default here
    because the inputs come from a parameter search that has already been
    optimised once.

    A negative ``f*`` is a strategy with no edge at these odds. It returns zero,
    not a short — the arithmetic would happily suggest inverting the signal, and
    an edge that only exists when you flip it is a fitting artefact.
    """
    win_rate = min(max(win_rate, 0.0), 1.0)
    payoff_ratio = max(payoff_ratio, 0.0)

    if payoff_ratio <= 0:
        full = 0.0
    else:
        full = win_rate - (1.0 - win_rate) / payoff_ratio

    edge = win_rate * payoff_ratio - (1.0 - win_rate)
    scaled = max(0.0, full) * fraction

    capped_by = None
    recommended = scaled
    if full <= 0:
        capped_by = "no_edge"
        recommended = 0.0
    elif scaled > max_fraction:
        capped_by = "max_fraction"
        recommended = max_fraction

    if full <= 0:
        note = "Negative Kelly at these odds — the strategy has no edge to size. Not inverted: an edge that only appears when flipped is a fitting artefact."
    elif capped_by == "max_fraction":
        note = f"Quarter-Kelly would allocate {scaled:.1%}; capped at the {max_fraction:.0%} single-strategy ceiling."
    else:
        note = f"Quarter of full Kelly ({full:.1%}). Full Kelly assumes the win rate and payoff are known exactly; they are estimates from a search."

    return KellySizing(
        full_kelly=full,
        fraction_used=fraction,
        recommended_fraction=recommended,
        recommended_notional=recommended * max(0.0, equity),
        win_rate=win_rate,
        payoff_ratio=payoff_ratio,
        edge_per_trade=edge,
        capped_by=capped_by,
        note=note,
    )
