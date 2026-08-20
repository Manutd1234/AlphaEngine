"""Kupiec scoring of a VaR forecast against what was realised."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from modules.quant_risk._common import (
    Z95,
    _stdev,
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
