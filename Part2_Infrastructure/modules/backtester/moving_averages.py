"""The smoothing family the crossover rules are built from."""

from __future__ import annotations

import logging
import math

import numpy as np
import pandas as pd

log = logging.getLogger("alphaengine.backtest")

# --------------------------------------------------------------------------- #
# Shared primitives for the second strategy batch
# --------------------------------------------------------------------------- #
def _wma(values: pd.Series, window: int) -> pd.Series:
    """Linearly weighted moving average — weight ``i+1`` on the i-th window bar.

    `pandas` has no `rolling().wma()`, so this walks the window in the same
    direction and accumulates in the same order as `wma` in `web/lib/indicators.ts`.
    Written once because the weight vector is the part that gets reversed, and
    three call sites would be three chances to weight the oldest bar most.
    """
    period = max(1, int(round(window)))
    weights = np.arange(1, period + 1, dtype=float)
    denominator = weights.sum()
    return values.rolling(period).apply(
        lambda w: float(np.dot(w, weights) / denominator), raw=True
    )


def _bars_since_max(values: pd.Series, window: int) -> pd.Series:
    """Bars since the window's highest value; ties resolve to the MOST RECENT.

    That tie rule is Aroon's definition and the opposite of ``argmax``. On a flat
    series every bar ties and the two conventions differ by the whole window.
    """
    period = max(1, int(round(window)))
    return values.rolling(period).apply(
        lambda w: float(len(w) - 1 - int(np.max(np.flatnonzero(w == np.max(w))))), raw=True
    )


def _bars_since_min(values: pd.Series, window: int) -> pd.Series:
    period = max(1, int(round(window)))
    return values.rolling(period).apply(
        lambda w: float(len(w) - 1 - int(np.max(np.flatnonzero(w == np.min(w))))), raw=True
    )


def _ema(values: pd.Series, span: float) -> pd.Series:
    """`adjust=False`, matching `ema` in the TypeScript engine bar for bar."""
    return values.ewm(span=max(1, int(round(span))), adjust=False).mean()


def _dema(values: pd.Series, span: float) -> pd.Series:
    one = _ema(values, span)
    return 2 * one - _ema(one, span)


def _tema(values: pd.Series, span: float) -> pd.Series:
    one = _ema(values, span)
    two = _ema(one, span)
    return 3 * one - 3 * two + _ema(two, span)


def _zlema(values: pd.Series, span: float) -> pd.Series:
    """De-lagged EMA. The adjustment extrapolates, so it overshoots at a turn."""
    period = max(1, int(round(span)))
    lag = (period - 1) // 2
    adjusted = 2 * values - values.shift(lag)
    adjusted.iloc[:lag] = values.iloc[:lag]
    return _ema(adjusted, period)


def _hma(values: pd.Series, window: float) -> pd.Series:
    """Hull MA. Both sub-periods FLOOR rather than round.

    A cross-language decision, not a stylistic one. ``round(2.5)`` is 2 in
    Python (banker's rounding) and 3 in JavaScript, so an odd ``n`` gave the two
    engines different half-periods and a different indicator under the same
    name. It surfaced as exactly one failing parity combination out of 193 — at
    n=5, the only point in the swept range where the halving lands on a .5.
    """
    period = max(2, int(window))
    half = _wma(values, max(1, period // 2))
    full = _wma(values, period)
    return _wma(2 * half - full, max(1, int(math.sqrt(period))))




#: The second strategy batch, dispatched together because each is a self
#: contained state machine rather than a mask over the whole series. Written as
#: explicit loops in the same order as `longState` in web/lib/engine.ts — the
#: two engines are compared combination by combination, and a vectorised
#: shortcut here that rounds differently is a parity failure that reads like a
#: modelling disagreement.
_BATCH_TWO = {
    "dema_cross", "tema_cross", "zlema_cross", "hull_trend", "vwap_trend",
    "cci_reversion", "awesome_cross", "cmo_trend", "stoch_rsi_x", "dpo_reversion",
    "bollinger_pctb", "stddev_channel", "chaikin_volatility", "ulcer_filter",
    "cmf_trend", "force_index", "eom_trend", "aroon_cross", "vortex_cross",
}
