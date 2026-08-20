"""ATR, the sweep axes, and the small linear solver the forecast rules stand on."""

from __future__ import annotations

import logging
import math

import numpy as np
import pandas as pd

log = logging.getLogger("alphaengine.backtest")

# --------------------------------------------------------------------------- #
# Signals
# --------------------------------------------------------------------------- #
#: Strategies whose SECOND parameter is not a lookback period.
#:
#: The grid used to filter every pair with `fast < slow`, which is right when
#: both axes are periods and nonsense otherwise. A Bollinger band width of 2.0
#: sigma against a 20-bar mean fails `20 < 2.0`, so every combination was
#: discarded and the strategy silently took zero trades — it looked like a bad
#: model rather than an unsatisfiable constraint.
#:
#: Each entry is (minimum, maximum, step) for the second axis, in its own real
#: units. Floats, because a sigma multiple of 1.5 is a sigma multiple of 1.5 and
#: encoding it as the integer 15 makes a slider that lies.
FREE_SECOND_AXIS: dict[str, tuple[float, float, float]] = {
    "bollinger_breakout": (1.0, 3.0, 0.25),   # band width in standard deviations
    "zscore_reversion": (1.0, 3.0, 0.25),     # entry threshold in standard deviations
    "atr_breakout": (0.5, 3.0, 0.25),         # breakout size in ATRs
    "keltner_breakout": (0.5, 3.0, 0.25),     # channel width in ATRs
    "supertrend": (1.0, 4.0, 0.5),            # band distance in ATRs
    "atr_trailing_stop": (1.0, 4.0, 0.5),     # stop distance in ATRs
    # Entry threshold as a multiple of the fit's OWN residual standard error.
    # 0 means "any positive forecast"; 1.0 means the forecast must beat the
    # noise the fit could not explain. Stepped at 0.2 rather than 0.1 because
    # this strategy costs ~15 ms per combination against ~0.4 ms for the
    # parametric ones — it refits a regression 100 times per pass — and a
    # 77-combination grid would take a second where every other sweep takes
    # forty milliseconds. Six thresholds is enough to see the shape.
    "linreg_forecast": (0.0, 1.0, 0.2),

    # Second batch. Each reads its second parameter as a LEVEL rather than a
    # lookback — an oscillator threshold, a sigma multiple, a %B position, an
    # ulcer index. Sweeping them over the request's 20..200 period axis would
    # ask for a 200-sigma band, and every combination would be discarded.
    "cci_reversion": (50.0, 200.0, 25.0),
    "cmo_trend": (20.0, 60.0, 10.0),
    "dpo_reversion": (0.5, 2.5, 0.25),
    "bollinger_pctb": (0.0, 0.4, 0.05),
    "stddev_channel": (1.0, 3.0, 0.25),
    "ulcer_filter": (2.0, 12.0, 2.0),
    "cmf_trend": (0.0, 0.2, 0.025),
    "aroon_cross": (50.0, 90.0, 10.0),
}

#: Strategies whose FIRST axis is not the request's period sweep either.
#:
#: The symmetric partner of FREE_SECOND_AXIS, and it exists for the same reason:
#: the UI's default fast sweep is 5-40 bars, which is a sensible moving-average
#: period and an unusable training window for a four-parameter regression.
#: Sweeping it there would fit four coefficients to five observations and report
#: the result as a strategy. Must match FREE_FIRST_AXIS in web/lib/engine.ts.
FREE_FIRST_AXIS: dict[str, tuple[float, float, float]] = {
    "linreg_forecast": (60, 240, 30),         # training window, in bars
}


def _atr(df: pd.DataFrame, period: int) -> pd.Series:
    """Average true range, Wilder-smoothed.

    True range takes the widest of the three spans rather than the bar's own
    high-low, because a gap through the previous close is real movement the
    bar's own range cannot see. Wilder's `ewm(alpha=1/n)` rather than a simple
    mean is what every published ATR means, and the TypeScript side uses the
    same recursion so the two agree.
    """
    prev_close = df["close"].shift(1)
    true_range = pd.concat([
        df["high"] - df["low"],
        (df["high"] - prev_close).abs(),
        (df["low"] - prev_close).abs(),
    ], axis=1).max(axis=1)
    return true_range.ewm(alpha=1 / max(1, period), adjust=False).mean()




# --------------------------------------------------------------------------- #
# Fitted strategy: OLS on features the bar already knows
# --------------------------------------------------------------------------- #
#: Refit cadence, in bars. Fixed rather than swept — a third axis for it would
#: multiply every grid without telling anyone anything they could act on, the
#: same reasoning that fixes MACD's signal span at 9. And a coefficient set that
#: changes every bar is fitting the last observation rather than estimating.
LINREG_REFIT_EVERY = 20
#: Intercept plus three features.
LINREG_COLS = 4
#: Below this many usable rows the fit is memorising, not estimating.
LINREG_MIN_ROWS = 30
#: First bar at which all three features have a value.
LINREG_WARMUP = 20


def _solve_small(a: list[list[float]], b: list[float]) -> list[float] | None:
    """Gaussian elimination with partial pivoting on a small dense system.

    Written out rather than handed to ``numpy.linalg.solve`` because
    ``web/lib/engine.ts`` runs the identical loop in the identical order. LAPACK
    on one side and a hand-rolled solve on the other agree to about eight
    digits, and eight digits is enough for the two engines to disagree about
    whether a forecast cleared its threshold — a different trade count, and a
    parity failure that reads like a modelling bug.

    Returns None on a singular system: the honest answer for a degenerate
    feature set, and it leaves the strategy flat rather than trading on a
    fabricated coefficient.
    """
    n = len(b)
    for col in range(n):
        pivot = col
        for row in range(col + 1, n):
            if abs(a[row][col]) > abs(a[pivot][col]):
                pivot = row
        if not abs(a[pivot][col]) > 1e-12:
            return None
        if pivot != col:
            a[pivot], a[col] = a[col], a[pivot]
            b[pivot], b[col] = b[col], b[pivot]
        for row in range(col + 1, n):
            factor = a[row][col] / a[col][col]
            if factor == 0:
                continue
            for k in range(col, n):
                a[row][k] -= factor * a[col][k]
            b[row] -= factor * b[col]
    x = [0.0] * n
    for row in range(n - 1, -1, -1):
        total = b[row]
        for k in range(row + 1, n):
            total -= a[row][k] * x[k]
        x[row] = total / a[row][row]
    return x if all(math.isfinite(v) for v in x) else None


def _linreg_forecast(close: np.ndarray, window: float, threshold_sd: float) -> np.ndarray:
    """Rolling OLS forecast of the next bar's return. Mirrors ``linregForecast``.

    NO LOOK-AHEAD, and the index arithmetic is the proof. Row ``j``'s target is
    the return from bar ``j`` to ``j+1``, so the row only exists once bar ``j+1``
    has closed. The refit at bar ``i`` uses rows ``j <= i-1``, whose targets need
    closes up to bar ``i`` — all of which have happened. The prediction at bar
    ``i`` uses bar ``i``'s features and the engine executes it at ``i+1``, like
    every other signal in this file.
    """
    n = len(close)
    out = np.zeros(n, dtype=np.int8)
    train_rows = max(LINREG_MIN_ROWS, int(round(window)))

    nan = float("nan")
    feat = [[1.0] * n, [nan] * n, [nan] * n, [nan] * n]
    mean20 = pd.Series(close).rolling(LINREG_WARMUP).mean().to_numpy()
    for i in range(n):
        if i >= 1 and close[i - 1] != 0:
            feat[1][i] = close[i] / close[i - 1] - 1.0
        if i >= 5 and close[i - 5] != 0:
            feat[2][i] = close[i] / close[i - 5] - 1.0
        if mean20[i] > 0:
            feat[3][i] = (close[i] - mean20[i]) / mean20[i]

    target = [nan] * n
    for i in range(n):
        if i + 1 < n and close[i] != 0:
            target[i] = close[i + 1] / close[i] - 1.0

    def usable(j: int) -> bool:
        return (
            math.isfinite(feat[1][j]) and math.isfinite(feat[2][j])
            and math.isfinite(feat[3][j]) and math.isfinite(target[j])
        )

    coef: list[float] | None = None
    resid_sd = 0.0
    state = 0

    for i in range(n):
        since_warmup = i - LINREG_WARMUP
        if since_warmup >= 0 and since_warmup % LINREG_REFIT_EVERY == 0:
            first = max(0, i - train_rows)
            xtx = [[0.0] * LINREG_COLS for _ in range(LINREG_COLS)]
            xty = [0.0] * LINREG_COLS
            yy = 0.0
            rows = 0
            # Ascending, one row at a time. The TypeScript port walks the same
            # indices in the same direction so the float sums agree bit for bit.
            for j in range(first, i):
                if not usable(j):
                    continue
                rows += 1
                y = target[j]
                yy += y * y
                for r in range(LINREG_COLS):
                    fr = feat[r][j]
                    xty[r] += fr * y
                    for c in range(r, LINREG_COLS):
                        xtx[r][c] += fr * feat[c][j]
            if rows >= LINREG_MIN_ROWS:
                for r in range(LINREG_COLS):
                    for c in range(r):
                        xtx[r][c] = xtx[c][r]
                solved = _solve_small([row[:] for row in xtx], xty[:])
                if solved is not None:
                    explained = 0.0
                    for r in range(LINREG_COLS):
                        explained += solved[r] * xty[r]
                    dof = max(1, rows - LINREG_COLS)
                    coef = solved
                    resid_sd = math.sqrt(max(0.0, yy - explained) / dof)

        if coef is not None and math.isfinite(feat[1][i]) and math.isfinite(feat[2][i]) \
                and math.isfinite(feat[3][i]):
            pred = 0.0
            for r in range(LINREG_COLS):
                pred += coef[r] * feat[r][i]
            if pred > threshold_sd * resid_sd:
                state = 1
            if pred < 0:
                state = 0  # exit overrides, as everywhere else in this module
        out[i] = state
    return out
