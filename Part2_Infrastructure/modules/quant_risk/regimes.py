"""Volatility regime classification, and order-book dislocation."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Iterable, Mapping, Sequence

from modules.quant_risk._common import (
    BARS_PER_YEAR,
    _mean,
    _stdev,
)

# --------------------------------------------------------------------------- #
# Volatility regime
# --------------------------------------------------------------------------- #

@dataclass
class VolatilityRegime:
    regime: str
    current_vol: float
    baseline_vol: float
    ratio: float
    percentile: float
    observations: int
    note: str


def volatility_regime(
    returns: Sequence[float],
    *,
    window: int = 20,
    interval: str = "1d",
) -> VolatilityRegime | None:
    """
    Where current realised volatility sits against its own recent history.

    A regime is a *relative* statement. "3% daily vol" means nothing without
    knowing whether this instrument usually runs at 1% or at 6%, so the answer
    is a percentile of the trailing-window volatility against every earlier
    window in the series — not an absolute threshold, which would classify every
    crypto pair as permanently "high" and every FX pair as permanently "low".

    The percentile is computed against *earlier* windows only, so the label is
    the one that would have been available in real time.
    """
    if len(returns) < window * 2:
        return None

    rolling = [
        _stdev(list(returns[i - window:i]))
        for i in range(window, len(returns) + 1)
    ]
    if len(rolling) < 2:
        return None

    current = rolling[-1]
    history = rolling[:-1]
    baseline = _mean(history)

    # Mid-rank, not `<=`. Counting ties as "below" sends a series whose
    # volatility never changes to the 100th percentile, which labelled a
    # perfectly calm instrument STRESSED — the exact inversion of what this
    # function is for. Averaging the strict and non-strict ranks puts a
    # constant series at 0.5, which is the honest answer: it is exactly as
    # volatile as it always is.
    strictly_below = sum(1 for v in history if v < current)
    at_or_below = sum(1 for v in history if v <= current)
    percentile = (strictly_below + at_or_below) / (2 * len(history))
    ratio = (current / baseline) if baseline > 0 else 1.0

    if percentile >= 0.85:
        regime, note = "STRESSED", "Volatility is in the top 15% of its own recent range — position sizes calibrated in calmer conditions are carrying more risk than they were sized for."
    elif percentile >= 0.6:
        regime, note = "ELEVATED", "Above its usual range but not extreme. Scenarios here are sized on the long-run average, so they understate what this market is currently delivering."
    elif percentile <= 0.15:
        regime, note = "COMPRESSED", "Volatility is in the bottom 15%. Quiet regimes end abruptly, and the sizing set here is the sizing you carry into the next expansion."
    else:
        regime, note = "NORMAL", "Volatility is within its usual range for this instrument."

    ann = math.sqrt(BARS_PER_YEAR.get(interval, 365))
    return VolatilityRegime(
        regime=regime,
        current_vol=current * ann,
        baseline_vol=baseline * ann,
        ratio=ratio,
        percentile=percentile,
        observations=len(rolling),
        note=note,
    )


# --------------------------------------------------------------------------- #
# Cross-venue dislocation
# --------------------------------------------------------------------------- #

@dataclass
class Dislocation:
    symbol: str
    crossed: bool
    buy_venue: str | None
    sell_venue: str | None
    edge_bps: float
    edge_usd_per_unit: float
    executable_size: float
    executable_notional: float
    note: str


def find_dislocation(books: Iterable[Mapping[str, Any]], symbol: str) -> Dislocation | None:
    """
    A crossed market across venues, sized to what is actually resting.

    The headline number in most "arbitrage scanners" is ``best_bid − best_ask``
    across venues, which is nearly useless: it says an edge exists but not
    whether it exists for more than a handful of units. So the edge here is
    reported alongside the size available at those two prices, and the notional
    that implies. A 12bps dislocation on 0.004 BTC is not an opportunity, and
    the pair of numbers makes that obvious where one number does not.

    This is a *detector*, not a strategy. Fees, latency and the fact that both
    legs must fill are not modelled — which is why the note says so rather than
    letting a green number imply free money.
    """
    live = [
        b for b in books
        if b.get("ok") and b.get("best_bid") and b.get("best_ask")
    ]
    if len(live) < 2:
        return None

    best_bid = max(live, key=lambda b: float(b["best_bid"]))
    best_ask = min(live, key=lambda b: float(b["best_ask"]))

    bid = float(best_bid["best_bid"])
    ask = float(best_ask["best_ask"])
    mid = (bid + ask) / 2
    edge = bid - ask

    # A cross requires two *different* venues. When one venue holds both the
    # best bid and the best ask you are looking at that venue's own spread,
    # which is not an opportunity — returning None here instead reported
    # "no data" for the ordinary, healthy case and hid it from the caller.
    same_venue = best_bid.get("venue") == best_ask.get("venue")
    crossed = edge > 0 and not same_venue

    size = 0.0
    if crossed:
        bid_size = _top_size(best_bid.get("bids"))
        ask_size = _top_size(best_ask.get("asks"))
        # Both legs must fill, so the tradeable size is the smaller side.
        size = min(bid_size, ask_size)

    return Dislocation(
        symbol=symbol,
        crossed=crossed,
        buy_venue=str(best_ask.get("venue")) if crossed else None,
        sell_venue=str(best_bid.get("venue")) if crossed else None,
        edge_bps=(edge / mid * 1e4) if mid > 0 else 0.0,
        edge_usd_per_unit=edge,
        executable_size=size,
        executable_notional=size * mid,
        note=(
            "Gross of fees, latency and execution risk — both legs must fill for the edge to be real."
            if crossed
            else "One venue holds both sides of the touch — that is its own spread, not a cross."
            if same_venue
            else "Books are not crossed: the best bid is at or below the best ask across venues, which is the normal state."
        ),
    )


def _top_size(levels: Any) -> float:
    if not levels:
        return 0.0
    first = levels[0]
    try:
        return float(first[1])
    except (TypeError, IndexError, ValueError):
        return 0.0
