"""
Portfolio risk, position sizing and regime — the gateway's own copy.
====================================================================

The web workspace computes VaR, correlation and risk contributions in
``web/lib/portfolio-risk.ts`` (a sibling of this package). The Telegram companion cannot reach that code: it
is a Python process talking to this gateway, and routing a chat command through
a Vercel deployment to answer a question about the gateway's own book would make
the bot's answers depend on a service that has nothing to do with the book.

So the maths lives here too, deliberately, the same way ``backtester.py`` and
``engine.ts`` are two implementations of one accounting. The conventions below
are copied from the TypeScript so a number quoted in Telegram and the same
number on the web tab cannot disagree:

* returns are simple (not log) per-bar,
* covariance is sample covariance with ``ddof=1``,
* VaR is parametric-normal at 95%: ``1.645 · σ · equity``,
* CVaR uses the normal expected-shortfall multiplier ``φ(z)/(1−α) = 2.063``,
* annualisation is ``√(bars per year)``.

Two things here have no TypeScript counterpart yet and are new to both stacks:
``kelly_fraction`` and ``volatility_regime``.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping, Sequence

# 95% one-tailed normal quantile.
Z95 = 1.6448536269514722

# E[X | X < -z] for the standard normal at 95%: φ(1.645) / 0.05.
ES95_MULTIPLIER = 2.0627128027825736

BARS_PER_YEAR: dict[str, float] = {
    "15m": 35_040, "1h": 8_760, "4h": 2_190, "1d": 365,
}


def _mean(xs: Sequence[float]) -> float:
    return sum(xs) / len(xs) if xs else 0.0


def _stdev(xs: Sequence[float], ddof: int = 1) -> float:
    n = len(xs)
    if n - ddof <= 0:
        return 0.0
    m = _mean(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (n - ddof))


def returns_from_closes(closes: Sequence[float]) -> list[float]:
    """Simple per-bar returns. A zero previous close yields 0, never a divide."""
    out: list[float] = []
    for i in range(1, len(closes)):
        prev = closes[i - 1]
        out.append((closes[i] / prev - 1.0) if prev else 0.0)
    return out


@dataclass
class Covariance:
    symbols: list[str]
    matrix: list[list[float]]
    observations: int
    annualisation: float
    correlation: list[list[float]] = field(default_factory=list)


def build_covariance(
    returns_by_symbol: Mapping[str, Sequence[float]],
    interval: str = "1d",
) -> Covariance | None:
    """
    Sample covariance over the window every symbol shares.

    Truncating to the shortest series rather than padding is the whole point: a
    symbol with a shorter history would otherwise have its missing bars treated
    as zero-return days, which understates its variance and — because the zeros
    line up across symbols — inflates every correlation toward one.
    """
    symbols = sorted(s for s, r in returns_by_symbol.items() if len(r) >= 2)
    if len(symbols) < 1:
        return None

    window = min(len(returns_by_symbol[s]) for s in symbols)
    if window < 2:
        return None
    aligned = {s: list(returns_by_symbol[s])[-window:] for s in symbols}
    means = {s: _mean(aligned[s]) for s in symbols}

    n = len(symbols)
    matrix = [[0.0] * n for _ in range(n)]
    for i, a in enumerate(symbols):
        for j in range(i, n):
            b = symbols[j]
            cov = sum(
                (aligned[a][k] - means[a]) * (aligned[b][k] - means[b])
                for k in range(window)
            ) / (window - 1)
            matrix[i][j] = cov
            matrix[j][i] = cov

    correlation = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            denom = math.sqrt(matrix[i][i] * matrix[j][j])
            correlation[i][j] = (matrix[i][j] / denom) if denom > 0 else 0.0

    return Covariance(
        symbols=symbols,
        matrix=matrix,
        observations=window,
        annualisation=math.sqrt(BARS_PER_YEAR.get(interval, 365)),
        correlation=correlation,
    )


@dataclass
class RiskContribution:
    symbol: str
    notional: float
    share_of_gross: float
    standalone_vol: float
    marginal: float
    contribution: float
    contribution_share: float


@dataclass
class PortfolioRisk:
    volatility: float
    annualised_volatility: float
    var95: float
    cvar95: float
    observations: int
    contributions: list[RiskContribution]
    diversification_ratio: float | None


def portfolio_risk(
    positions: Sequence[Mapping[str, Any]],
    cov: Covariance,
    equity: float,
) -> PortfolioRisk | None:
    """
    Book volatility and each position's *contribution* to it.

    Share of notional is not share of risk, and the gap is the reason this
    exists. A 13% sleeve in a volatile name can carry more risk than a 42% one
    in a quiet name, and a short that hedges the book contributes a **negative**
    amount — a number a notional-weighted view cannot produce at all.

    Weights are signed and scaled by equity, so a short enters the quadratic
    form with a negative weight and its covariance with the longs subtracts.
    """
    index = {s: i for i, s in enumerate(cov.symbols)}
    weights = [0.0] * len(cov.symbols)
    for p in positions:
        i = index.get(str(p.get("symbol")))
        if i is None or equity <= 0:
            continue
        direction = -1.0 if str(p.get("side")).upper() == "SHORT" else 1.0
        weights[i] += direction * float(p.get("notional") or 0.0) / equity

    n = len(cov.symbols)
    # Marginal contribution: (Σw)_i — the derivative of variance in weight i.
    marginal = [sum(cov.matrix[i][j] * weights[j] for j in range(n)) for i in range(n)]
    variance = sum(weights[i] * marginal[i] for i in range(n))
    if variance <= 0:
        return None
    vol = math.sqrt(variance)

    gross = sum(abs(float(p.get("notional") or 0.0)) for p in positions) or 1.0
    contributions: list[RiskContribution] = []
    for p in positions:
        symbol = str(p.get("symbol"))
        i = index.get(symbol)
        if i is None:
            continue
        notional = float(p.get("notional") or 0.0)
        contribution = weights[i] * marginal[i]
        contributions.append(
            RiskContribution(
                symbol=symbol,
                notional=notional,
                share_of_gross=abs(notional) / gross,
                standalone_vol=math.sqrt(max(0.0, cov.matrix[i][i])) * cov.annualisation,
                marginal=marginal[i],
                contribution=contribution,
                contribution_share=contribution / variance,
            )
        )
    contributions.sort(key=lambda c: c.contribution_share, reverse=True)

    # Diversification ratio: weighted standalone vol over realised book vol.
    weighted_standalone = sum(
        abs(weights[i]) * math.sqrt(max(0.0, cov.matrix[i][i])) for i in range(n)
    )

    return PortfolioRisk(
        volatility=vol,
        annualised_volatility=vol * cov.annualisation,
        var95=Z95 * vol * equity,
        cvar95=ES95_MULTIPLIER * vol * equity,
        observations=cov.observations,
        contributions=contributions,
        diversification_ratio=(weighted_standalone / vol) if vol > 0 else None,
    )


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
        regime, note = "ELEVATED", "Above its usual range but not extreme. Stress scenarios sized on the long-run average will understate the move."
    elif percentile <= 0.15:
        regime, note = "COMPRESSED", "Volatility is in the bottom 15%. Quiet regimes end abruptly, and sizing set here is the sizing you carry into the next expansion."
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
