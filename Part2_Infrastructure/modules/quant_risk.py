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


# --------------------------------------------------------------------------- #
# Historical VaR — the empirical twin of the parametric figure
#
# The parametric number assumes returns are normal. Crypto returns are not: the
# tail is fatter, so the normal figure understates the loss in exactly the
# conditions a risk manager cares about. Reporting both, side by side, makes
# that gap visible instead of a hidden modelling choice. Ported from
# `historicalVar` in web/lib/portfolio-risk.ts, same conventions.
# --------------------------------------------------------------------------- #

@dataclass
class HistoricalVaR:
    var95: float
    cvar95: float
    observations: int
    # The replayed per-day P&L behind the quantiles above. Default-valued so no
    # existing caller changes; it exists because the distribution is worth
    # showing and recomputing it elsewhere would risk a second, disagreeing
    # answer. Sorted ascending, i.e. worst first.
    daily_pnl: tuple[float, ...] = ()


def historical_var(
    positions: Sequence[Mapping[str, Any]],
    returns_by_symbol: Mapping[str, Sequence[float]],
    equity: float,
) -> HistoricalVaR | None:
    """Replay today's book through history and read the 5th-percentile day.

    No distribution is assumed: the book's *current* weights are applied to each
    past day's returns, and the loss that is worse than 95% of those days is the
    VaR. CVaR is the mean of the tail beyond it — the number that answers "and
    how bad is it when it is bad", which VaR alone never does.

    Requires at least 20 aligned observations; below that a percentile is a
    single data point wearing a statistic's name, and ``None`` is the honest
    answer.
    """
    usable = [
        p for p in positions
        if len(returns_by_symbol.get(str(p.get("symbol")), ())) >= 20
    ]
    if not usable or equity <= 0:
        return None

    window = min(len(returns_by_symbol[str(p.get("symbol"))]) for p in usable)
    if window < 20:
        return None

    daily_pnl: list[float] = []
    for t in range(window):
        total = 0.0
        for p in usable:
            symbol = str(p.get("symbol"))
            series = returns_by_symbol[symbol]
            direction = -1.0 if str(p.get("side")).upper() == "SHORT" else 1.0
            signed = direction * abs(float(p.get("notional") or 0.0))
            total += signed * series[len(series) - window + t]
        daily_pnl.append(total)

    daily_pnl.sort()
    k = max(1, math.ceil(0.05 * len(daily_pnl)))
    tail = daily_pnl[:k]
    return HistoricalVaR(
        # Reported positive-as-loss so it reads beside the parametric figure.
        var95=-daily_pnl[k - 1],
        cvar95=-_mean(tail),
        observations=window,
        daily_pnl=tuple(daily_pnl),
    )


# --------------------------------------------------------------------------- #
# VaR model validation
#
# A VaR number nobody has back-tested is an opinion. Regulators settled this
# argument decades ago: count how often the realised loss exceeded the forecast,
# and test that count against the model's own claim. At 95% confidence, roughly
# one day in twenty *should* breach — a model with zero exceptions is not
# conservative, it is wrong in the expensive direction, because it is holding
# capital against a risk it cannot measure.
# --------------------------------------------------------------------------- #

@dataclass
class VarBacktest:
    observations: int
    exceptions: int
    expected_exceptions: float
    exception_rate: float
    kupiec_statistic: float | None
    kupiec_p_value: float | None
    zone: str
    verdict: str


def _chi2_sf_1df(x: float) -> float:
    """Survival function of chi-squared with one degree of freedom.

    For 1 df this is exactly ``erfc(sqrt(x/2))`` — no series expansion, no
    dependency, and correct to machine precision.
    """
    if x <= 0:
        return 1.0
    return math.erfc(math.sqrt(x / 2.0))


def _kupiec(exceptions: int, observations: int, alpha: float) -> VarBacktest:
    """Kupiec proportion-of-failures test from an exception count.

    The likelihood-ratio statistic is chi-squared with one degree of freedom.
    The p-value is the probability of a count at least this extreme *if the
    model is correct*, so a low value rejects the model in either direction:
    too many exceptions means it understates risk; too few means it overstates
    it and the desk is holding capacity it never uses.
    """
    expected = alpha * observations
    rate = exceptions / observations

    # Guarded at the boundaries, where log(0) appears for a model with no
    # exceptions at all — the common case on a short, quiet window.
    if 0 < exceptions < observations:
        lr = -2.0 * (
            (observations - exceptions) * math.log(1 - alpha) + exceptions * math.log(alpha)
            - ((observations - exceptions) * math.log(1 - rate) + exceptions * math.log(rate))
        )
    elif exceptions == 0:
        lr = -2.0 * observations * math.log(1 - alpha)
    else:
        lr = -2.0 * observations * math.log(alpha)
    lr = max(0.0, lr)
    p_value = _chi2_sf_1df(lr)

    if p_value >= 0.05:
        zone = "green"
        verdict = "Model validated: the exception count is consistent with the forecast."
    elif exceptions > expected:
        zone = "red" if p_value < 0.01 else "yellow"
        verdict = f"Model understates risk: {exceptions} exceptions where {expected:.1f} were expected."
    else:
        zone = "yellow"
        verdict = (
            f"Model overstates risk: only {exceptions} exceptions where {expected:.1f} were expected — "
            "the desk is holding capacity it is not using."
        )

    return VarBacktest(
        observations=observations,
        exceptions=exceptions,
        expected_exceptions=round(expected, 2),
        exception_rate=round(rate, 4),
        kupiec_statistic=round(lr, 4),
        # Not rounded to 4dp: a p-value of 1.7e-05 would render as 0.0, which
        # reads as a certainty nothing here is entitled to claim.
        kupiec_p_value=float(f"{p_value:.4g}"),
        zone=zone,
        verdict=verdict,
    )


def var_backtest(
    pnl_series: Sequence[float],
    var_forecast: float,
    confidence: float = 0.95,
) -> VarBacktest | None:
    """Kupiec test of one fixed VaR forecast against a realised P&L series.

    ``var_forecast`` is the loss the model says will be exceeded on
    ``1 - confidence`` of days, expressed positive. Every day whose loss was
    worse is an exception.

    Below 20 observations this returns ``None``: an exception rate over a dozen
    days is not evidence about a 1-in-20 event.
    """
    losses = [-float(x) for x in pnl_series]  # positive = loss
    if len(losses) < 20 or var_forecast <= 0:
        return None
    exceptions = sum(1 for loss in losses if loss > var_forecast)
    return _kupiec(exceptions, len(losses), 1.0 - confidence)


def rolling_var_backtest(
    positions: Sequence[Mapping[str, Any]],
    returns_by_symbol: Mapping[str, Sequence[float]],
    equity: float,
    window: int = 60,
    confidence: float = 0.95,
) -> VarBacktest | None:
    """Back-test the parametric VaR the desk actually quotes.

    The forecast is re-estimated on a rolling window and scored against the
    *next* day's realised book P&L, so it is never judged on data it was fitted
    to. That distinction is the whole test: a VaR evaluated in-sample passes
    trivially and tells a risk manager nothing.

    The book is held fixed at today's weights. This measures the *model*, not
    the trading — asking whether the volatility estimate would have covered the
    losses this book would have taken, which is the question a limit depends on.
    """
    symbols = {str(p.get("symbol")) for p in positions}
    series = {s: list(returns_by_symbol.get(s, ())) for s in symbols}
    series = {s: v for s, v in series.items() if v}
    if not series or equity <= 0:
        return None

    length = min(len(v) for v in series.values())
    if length < window + 20:
        return None

    signed: dict[str, float] = {}
    for p in positions:
        symbol = str(p.get("symbol"))
        if symbol not in series:
            continue
        direction = -1.0 if str(p.get("side")).upper() == "SHORT" else 1.0
        signed[symbol] = signed.get(symbol, 0.0) + direction * abs(float(p.get("notional") or 0.0))

    book_returns = [
        sum(signed.get(s, 0.0) * series[s][len(series[s]) - length + t] for s in series)
        for t in range(length)
    ]

    exceptions = 0
    scored = 0
    for t in range(window, length):
        sigma = _stdev(book_returns[t - window:t])
        if sigma <= 0:
            continue
        scored += 1
        if -book_returns[t] > Z95 * sigma:
            exceptions += 1

    if scored < 20:
        return None
    return _kupiec(exceptions, scored, 1.0 - confidence)


def rolling_var_path(
    positions: Sequence[Mapping[str, Any]],
    returns_by_symbol: Mapping[str, Sequence[float]],
    equity: float,
    window: int = 60,
) -> tuple[list[float], list[float], list[bool]] | None:
    """The per-bar series behind :func:`rolling_var_backtest`, for a chart.

    Returns ``(pnl_usd, var_usd, breach)`` aligned bar-for-bar — the same
    rolling estimate the Kupiec test scores, exposed rather than reduced to a
    single count. ``var_usd`` is the positive-as-loss forecast (``Z95·σ`` of the
    trailing window's book P&L); a bar breaches when the realised loss exceeds
    it. Bars where the window has no dispersion are skipped so all three lists
    stay the same length.

    None below ``window + 20`` bars of shared history, or fewer than 20 scored
    bars — the same floors the back-test uses, because a path too short to score
    is a path too short to draw.
    """
    symbols = {str(p.get("symbol")) for p in positions}
    series = {s: list(returns_by_symbol.get(s, ())) for s in symbols}
    series = {s: v for s, v in series.items() if v}
    if not series or equity <= 0:
        return None

    length = min(len(v) for v in series.values())
    if length < window + 20:
        return None

    signed: dict[str, float] = {}
    for p in positions:
        symbol = str(p.get("symbol"))
        if symbol not in series:
            continue
        direction = -1.0 if str(p.get("side")).upper() == "SHORT" else 1.0
        signed[symbol] = signed.get(symbol, 0.0) + direction * abs(float(p.get("notional") or 0.0))

    book_returns = [
        sum(signed.get(s, 0.0) * series[s][len(series[s]) - length + t] for s in series)
        for t in range(length)
    ]

    pnl_usd: list[float] = []
    var_usd: list[float] = []
    breach: list[bool] = []
    for t in range(window, length):
        sigma = _stdev(book_returns[t - window:t])
        if sigma <= 0:
            continue
        forecast = Z95 * sigma
        pnl_usd.append(book_returns[t])
        var_usd.append(forecast)
        breach.append(-book_returns[t] > forecast)

    if len(pnl_usd) < 20:
        return None
    return pnl_usd, var_usd, breach


# --------------------------------------------------------------------------- #
# Scenario stress testing
#
# Ported from web/lib/portfolio-risk.ts so the Telegram companion and the web
# tab cannot disagree about what a shock does to the book. The propagation rule
# is the important part: an instrument with no explicit shock moves by
# `beta × reference shock`, and only when a beta could actually be measured.
# Defaulting an unmeasurable beta to 1.0 is the quiet way a stress test starts
# inventing exposure and reporting it as a measurement.
# --------------------------------------------------------------------------- #

@dataclass
class ScenarioLeg:
    symbol: str
    signed_notional: float
    applied_move: float
    via_beta: bool
    beta: float | None
    pnl: float
    #: How the move was decided — "explicit", "beta", "wildcard" or "unsupported".
    #: A wildcard leg is an *assumption* about an instrument whose co-movement
    #: could not be measured, and a reader must be able to tell it apart from a
    #: shock that was named directly.
    basis: str = "explicit"


@dataclass
class ScenarioResult:
    scenario_id: str
    label: str
    total_pnl: float
    total_return: float
    projected_equity: float
    legs: list[ScenarioLeg]
    used_beta: bool


SCENARIOS: dict[str, dict[str, Any]] = {
    "crypto_cascade": {
        "label": "Crypto liquidation cascade",
        "description": "A leveraged unwind: majors gap down together and correlation goes to one.",
        "shocks": {"BTCUSDT": -0.20, "*": -0.25},
    },
    "risk_off": {
        "label": "Broad risk-off",
        "description": "Macro shock. Everything correlated to the reference falls with it.",
        "shocks": {"BTCUSDT": -0.08},
    },
    "melt_up": {
        "label": "Melt-up",
        "description": "The upside case — worth running, because a short book fails here.",
        "shocks": {"BTCUSDT": 0.15},
    },
    "flat": {
        "label": "No shock",
        "description": "Baseline. Any non-zero P&L here would be a bug in the propagation.",
        "shocks": {"*": 0.0},
    },
}


def beta(symbol: str, reference: str, returns_by_symbol: Mapping[str, Sequence[float]]) -> float | None:
    """Beta of *symbol* against *reference*, measured from returns.

    Returns ``None`` rather than 1.0 when it cannot be estimated — see the
    module comment above for why that distinction matters.
    """
    a = list(returns_by_symbol.get(symbol, ()))
    b = list(returns_by_symbol.get(reference, ()))
    if not a or not b:
        return None
    n = min(len(a), len(b))
    if n < 20:
        return None
    x, y = b[-n:], a[-n:]
    mean_x, mean_y = _mean(x), _mean(y)
    var_x = sum((v - mean_x) ** 2 for v in x) / (n - 1)
    if var_x <= 0:
        return None
    cov_xy = sum((y[i] - mean_y) * (x[i] - mean_x) for i in range(n)) / (n - 1)
    return cov_xy / var_x


def apply_scenario(
    positions: Sequence[Mapping[str, Any]],
    equity: float,
    shocks: Mapping[str, float],
    returns_by_symbol: Mapping[str, Sequence[float]],
    reference_symbol: str = "BTCUSDT",
    scenario_id: str = "custom",
    label: str = "Custom shock",
) -> ScenarioResult:
    explicit = {s: m for s, m in shocks.items() if s != "*"}
    wildcard = shocks.get("*")
    reference = explicit.get(reference_symbol, wildcard if wildcard is not None else 0.0)

    used_beta = False
    legs: list[ScenarioLeg] = []
    for p in positions:
        symbol = str(p.get("symbol"))
        direction = -1.0 if str(p.get("side")).upper() == "SHORT" else 1.0
        signed = direction * abs(float(p.get("notional") or 0.0))

        if symbol in explicit:
            move, measured, via, basis = explicit[symbol], None, False, "explicit"
        else:
            measured = beta(symbol, reference_symbol, returns_by_symbol) if reference != 0 else None
            if measured is not None:
                used_beta = True
                move, via, basis = measured * reference, True, "beta"
            elif wildcard is not None:
                # A scenario that names a blanket move applies it — that is what
                # "everything falls 25%" means. But it is an assumption about an
                # instrument whose co-movement could not be measured, and a
                # stronger one than beta=1 would have been, so the leg says so.
                move, via, basis = wildcard, False, "wildcard"
            else:
                # No measured beta and no blanket move: left flat rather than
                # assumed to move with the market. Reported as unsupported, so
                # the total is understated rather than invented.
                move, via, basis = 0.0, False, "unsupported"

        legs.append(ScenarioLeg(
            symbol=symbol, signed_notional=signed, applied_move=move,
            via_beta=via, beta=measured, pnl=signed * move, basis=basis,
        ))

    total = sum(leg.pnl for leg in legs)
    return ScenarioResult(
        scenario_id=scenario_id,
        label=label,
        total_pnl=total,
        total_return=(total / equity) if equity > 0 else 0.0,
        projected_equity=equity + total,
        legs=legs,
        used_beta=used_beta,
    )


def run_scenarios(
    positions: Sequence[Mapping[str, Any]],
    equity: float,
    returns_by_symbol: Mapping[str, Sequence[float]],
    reference_symbol: str = "BTCUSDT",
) -> list[ScenarioResult]:
    """Every named scenario against the current book, worst first."""
    results = [
        apply_scenario(
            positions, equity, spec["shocks"], returns_by_symbol,
            reference_symbol, scenario_id=scenario_id, label=str(spec["label"]),
        )
        for scenario_id, spec in SCENARIOS.items()
    ]
    return sorted(results, key=lambda r: r.total_pnl)


# --------------------------------------------------------------------------- #
# Allocation
#
# The gap this fills: the platform could tell a PM what the book *is* — exposure,
# concentration, risk contributions — and nothing about what it should be. A
# proposal is not an instruction, and this one is deliberately naive about
# expected return: it allocates by risk, because forecasting covariance is hard
# and forecasting returns is harder, and a proposal that pretends otherwise is
# an opinion dressed as arithmetic.
# --------------------------------------------------------------------------- #

#: Every allocation method this engine solves, in the order the desk reads them:
#: the naive one first, then the three that price risk.
ALLOCATION_METHODS: tuple[str, ...] = ("equal_weight", "inverse_vol", "equal_risk", "min_variance")

#: Both iterative solvers run a fixed number of steps rather than testing for
#: convergence. A tolerance check lets two implementations stop on different
#: iterations and disagree by more than the cross-language fixture allows; a
#: fixed count cannot.
_SOLVER_ITERATIONS = 60


def portfolio_variance(cov: Covariance, weights: Mapping[str, float]) -> float:
    """wᵀΣw for a weight map keyed by symbol.

    Mirrors ``portfolioVariance`` in web/lib/portfolio-risk.ts. The summation is
    sequential in both, never ``math.fsum`` or ``numpy.dot``: pairwise summation
    rounds differently from JavaScript's left-to-right accumulation, and the
    parity fixture exists to catch exactly that class of drift.
    """
    size = len(cov.symbols)
    vector = [float(weights.get(s, 0.0)) for s in cov.symbols]
    return sum(
        vector[i] * sum(cov.matrix[i][j] * vector[j] for j in range(size))
        for i in range(size)
    )


@dataclass
class TargetWeight:
    symbol: str
    current_weight: float
    target_weight: float
    current_notional: float
    target_notional: float
    drift: float
    #: Which constraint, if any, held this weight below its unclipped value.
    clipped_by: str | None


@dataclass
class AllocationProposal:
    method: str
    targets: list[TargetWeight]
    gross_before: float
    gross_after: float
    #: Weights before clipping summed to one; after clipping they may not.
    clipped: bool
    note: str


def propose_allocation(
    positions: Sequence[Mapping[str, Any]],
    cov: Covariance,
    equity: float,
    method: str = "inverse_vol",
    max_symbol_notional: float | None = None,
    max_gross_notional: float | None = None,
) -> AllocationProposal | None:
    """Constraint-aware target weights for the current book.

    Four methods, in increasing order of what they claim to know:

    * ``equal_weight`` — 1/n. It knows nothing and says so, which makes it the
      honest baseline the other three have to beat.
    * ``inverse_vol`` — each position sized by the reciprocal of its own
      volatility, so a quiet instrument carries more notional than a violent one
      for the same risk. Ignores correlation.
    * ``equal_risk`` — equalises each position's *contribution* to book
      volatility, which accounts for correlation: two names that move together
      are collectively one bet and get sized as one.
    * ``min_variance`` — the long-only, fully-invested portfolio with the
      smallest variance the estimated covariance allows. The most concentrated
      of the four by construction, so it clips against a symbol cap most often.

    None of them forecasts a return. All four are then clipped by the same limits
    the risk gateway enforces, and each clipped weight names the constraint that
    bound it — a proposal that ignored the limits would be rejected order by
    order at the gate, which is a worse way to discover it.
    """
    index = {s: i for i, s in enumerate(cov.symbols)}
    live = [p for p in positions if str(p.get("symbol")) in index and float(p.get("notional") or 0.0)]
    if not live or equity <= 0:
        return None

    vols = {
        str(p.get("symbol")): math.sqrt(max(0.0, cov.matrix[index[str(p.get("symbol"))]][index[str(p.get("symbol"))]]))
        for p in live
    }
    if any(v <= 0 for v in vols.values()):
        return None

    # Normalised explicitly rather than by falling through an else: the returned
    # proposal names its own method, and a silent fallback would let it name one
    # thing while the caller asked for another.
    if method not in ALLOCATION_METHODS:
        method = "inverse_vol"

    if method == "equal_weight":
        # 1/n over *distinct* symbols, not len(live). Both engines key weights by
        # symbol but iterate the position list when building targets, so a
        # duplicated symbol would collect the same weight twice and silently
        # inflate gross. `vols` is already keyed by symbol, so its length is the
        # distinct count.
        count = len(vols)
        weights = {s: 1.0 / count for s in vols}
    elif method == "min_variance":
        # Minimum variance, long-only and fully invested. The KKT condition for
        # `min wᵀΣw s.t. Σw = 1, w >= 0` is that every marginal variance (Σw)ᵢ is
        # equal on the support, which gives a multiplicative update in the same
        # shape as the equal-risk solver below — one solver family in this file
        # rather than two, and no simplex projection or step size to tune.
        #
        # Seeded with inverse *variance*, which is already the exact answer when
        # the correlations are zero, so the iteration only has to undo the
        # correlation.
        weights = {s: 1.0 / (v * v) for s, v in vols.items()}
        total = sum(weights.values())
        weights = {s: w / total for s, w in weights.items()}
        # A multiplicative fixed point is not proven to decrease the objective on
        # every step. A method called "minimum variance" that returned something
        # more volatile than inverse-vol would be indefensible, so the best
        # iterate is kept rather than whichever one the loop happened to end on.
        best = weights
        best_variance = portfolio_variance(cov, weights)
        for _ in range(_SOLVER_ITERATIONS):
            vector = [weights.get(s, 0.0) for s in cov.symbols]
            marginal = [
                sum(cov.matrix[i][j] * vector[j] for j in range(len(cov.symbols)))
                for i in range(len(cov.symbols))
            ]
            variance = sum(vector[i] * marginal[i] for i in range(len(cov.symbols)))
            if variance <= 0:
                break
            updated = {}
            for symbol in weights:
                i = index[symbol]
                # A negative marginal variance is a hedge: the fixed point has no
                # update for it, and sqrt() of a negative would put a NaN into
                # every weight at the next renormalisation. Held flat, exactly as
                # equal_risk holds a non-positive contribution.
                if marginal[i] <= 0:
                    updated[symbol] = weights[symbol]
                    continue
                updated[symbol] = weights[symbol] * math.sqrt(variance / marginal[i])
            total = sum(updated.values()) or 1.0
            weights = {s: w / total for s, w in updated.items()}
            candidate = portfolio_variance(cov, weights)
            if candidate < best_variance:
                best_variance = candidate
                best = weights
        weights = best
    elif method == "equal_risk":
        # Fixed-point iteration toward equal risk contribution. Converges in a
        # handful of steps for the position counts this book carries; the
        # inverse-vol solution is the natural starting point because it is
        # already correct when correlations are zero.
        weights = {s: 1.0 / v for s, v in vols.items()}
        total = sum(weights.values())
        weights = {s: w / total for s, w in weights.items()}
        for _ in range(_SOLVER_ITERATIONS):
            vector = [weights.get(s, 0.0) for s in cov.symbols]
            marginal = [
                sum(cov.matrix[i][j] * vector[j] for j in range(len(cov.symbols)))
                for i in range(len(cov.symbols))
            ]
            variance = sum(vector[i] * marginal[i] for i in range(len(cov.symbols)))
            if variance <= 0:
                break
            target_rc = variance / len(weights)
            updated = {}
            for symbol in weights:
                i = index[symbol]
                contribution = vector[i] * marginal[i]
                if contribution <= 0 or marginal[i] <= 0:
                    updated[symbol] = weights[symbol]
                    continue
                updated[symbol] = weights[symbol] * math.sqrt(target_rc / contribution)
            total = sum(updated.values()) or 1.0
            weights = {s: w / total for s, w in updated.items()}
    else:
        raw = {s: 1.0 / v for s, v in vols.items()}
        total = sum(raw.values())
        weights = {s: w / total for s, w in raw.items()}

    gross_before = sum(abs(float(p.get("notional") or 0.0)) for p in live)
    budget = min(gross_before, max_gross_notional) if max_gross_notional else gross_before

    targets: list[TargetWeight] = []
    clipped = False
    for p in live:
        symbol = str(p.get("symbol"))
        current_notional = abs(float(p.get("notional") or 0.0))
        target_notional = weights[symbol] * budget
        clipped_by = None
        if max_symbol_notional and target_notional > max_symbol_notional:
            target_notional = max_symbol_notional
            clipped_by = "max_symbol_notional_usd"
            clipped = True
        targets.append(TargetWeight(
            symbol=symbol,
            current_weight=current_notional / gross_before if gross_before else 0.0,
            target_weight=target_notional / budget if budget else 0.0,
            current_notional=round(current_notional, 2),
            target_notional=round(target_notional, 2),
            drift=round((target_notional - current_notional) / gross_before, 5) if gross_before else 0.0,
            clipped_by=clipped_by,
        ))

    targets.sort(key=lambda t: -abs(t.drift))
    gross_after = sum(t.target_notional for t in targets)

    return AllocationProposal(
        method=method,
        targets=targets,
        gross_before=round(gross_before, 2),
        gross_after=round(gross_after, 2),
        clipped=clipped,
        note=(
            "Risk-based only: no expected return is forecast, so this answers "
            "'how should the risk be spread', never 'what should we own'."
        ),
    )


def rebalance_trades(
    proposal: AllocationProposal,
    positions: Sequence[Mapping[str, Any]],
    drift_band: float = 0.05,
) -> list[dict[str, Any]]:
    """Trades needed to reach the proposal, filtered by a drift band.

    The band is what stops a rebalance from being a fee-generating machine: a
    position 1% away from target costs more to correct than the correction is
    worth. Only positions outside it are traded, and the reason for each trade
    travels with it.
    """
    sides = {str(p.get("symbol")): str(p.get("side", "LONG")).upper() for p in positions}
    trades: list[dict[str, Any]] = []
    for target in proposal.targets:
        if abs(target.drift) < drift_band:
            continue
        delta = target.target_notional - target.current_notional
        long_position = sides.get(target.symbol, "LONG") != "SHORT"
        # Adding to a short means selling more of it; the direction depends on
        # which side the position is already on.
        side = ("BUY" if delta > 0 else "SELL") if long_position else ("SELL" if delta > 0 else "BUY")
        trades.append({
            "symbol": target.symbol,
            "side": side,
            "notional": round(abs(delta), 2),
            "reason": (
                f"{'over' if delta < 0 else 'under'}weight by {abs(target.drift):.1%} of gross"
                + (f" (target clipped by {target.clipped_by})" if target.clipped_by else "")
            ),
        })
    return trades
