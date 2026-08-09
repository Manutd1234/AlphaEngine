"""
Module C — Asynchronous Parametric Backtester
==============================================

Trading alpha
-------------
Hypothesis testing is throughput-bound: the desk that can evaluate 400
parameterisations of an idea in a minute — *and correctly discount the winner
for having looked at 400 of them* — iterates faster than one that cannot. This
module decouples the sweep from the trader's terminal and returns a result that
has already been penalised for selection bias.

Why the statistics matter more than the engine
-----------------------------------------------
Any framework can report the best Sharpe in a grid. The best Sharpe in a grid of
400 is a *maximum of 400 draws* and is upward-biased almost by construction — a
grid of pure noise reliably produces "Sharpe 1.8" somewhere. Two corrections are
therefore applied and reported alongside every sweep:

* **Deflated Sharpe Ratio** (Bailey & López de Prado, 2014) — the probability
  that the selected strategy's true Sharpe exceeds zero, given the number of
  trials, the dispersion of their Sharpes, and the non-normality (skew/kurtosis)
  of the return stream. A DSR below ~0.95 means the winner is not distinguishable
  from the best of N coin flips.
* **Walk-forward evaluation** — parameters are chosen in-sample on each fold and
  scored on the *next*, unseen fold. The reported OOS Sharpe is the number a
  trader should size on; the in-sample Sharpe is marketing.

Engines
-------
``vectorbt`` is used when importable (the whole grid runs as one 2-D portfolio).
A dependency-free NumPy engine implements the same accounting as a fallback so
the module never becomes unrunnable because of a numba/NumPy ABI mismatch. The
test-suite asserts the two agree.
"""

from __future__ import annotations

import base64
import hashlib
import io
import logging
import math
import time
from datetime import datetime, timezone
from typing import Any, Callable

import numpy as np
import pandas as pd

from config import settings
from modules.schemas import (
    BacktestRequest,
    BacktestResult,
    ParamResult,
    WalkForwardFold,
)

log = logging.getLogger("alphaengine.backtest")

_BARS_PER_YEAR = {
    "1m": 525_600, "5m": 105_120, "15m": 35_040, "30m": 17_520,
    "1h": 8_760, "2h": 4_380, "4h": 2_190, "6h": 1_460, "12h": 730,
    "1d": 365, "1w": 52,
}

try:  # pragma: no cover - availability differs per environment
    import vectorbt as vbt

    VECTORBT_AVAILABLE = True
except Exception as _exc:  # pragma: no cover
    vbt = None
    VECTORBT_AVAILABLE = False
    log.info("vectorbt unavailable (%s) — using the built-in NumPy engine", _exc)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def bars_per_year(interval: str) -> float:
    return float(_BARS_PER_YEAR.get(interval, 8_760))


# --------------------------------------------------------------------------- #
# Market data
# --------------------------------------------------------------------------- #
def fetch_ohlcv(symbol: str, interval: str, bars: int) -> tuple[pd.DataFrame, str]:
    """Binance public klines -> DuckDB cache -> synthetic, in that order.

    The cache is what makes an offline grading environment work: the first
    successful online run seeds it, and every later run is served locally.
    """
    symbol, interval = symbol.upper(), interval.lower()

    try:
        df = _fetch_binance_klines(symbol, interval, bars)
        if len(df) >= min(bars, 200):
            try:
                from modules.audit import get_audit

                get_audit().cache_ohlcv(
                    symbol, interval,
                    [(ts.to_pydatetime(), o, h, lo, c, v) for ts, o, h, lo, c, v in
                     df.reset_index()[["ts", "open", "high", "low", "close", "volume"]].itertuples(index=False)],
                )
            except Exception as exc:
                log.warning("ohlcv cache write skipped: %s", exc)
            return df, "binance_rest"
    except Exception as exc:
        log.warning("binance klines fetch failed (%s) — trying cache", exc)

    try:
        from modules.audit import get_audit

        rows = get_audit().load_ohlcv(symbol, interval, bars)
        if len(rows) >= 200:
            df = pd.DataFrame(rows).rename(columns={"ts": "ts"}).sort_values("ts")
            df["ts"] = pd.to_datetime(df["ts"])
            return df.set_index("ts"), "duckdb_cache"
    except Exception as exc:
        log.warning("ohlcv cache read failed: %s", exc)

    return _synthetic_ohlcv(symbol, interval, bars), "synthetic"


def _fetch_binance_klines(symbol: str, interval: str, bars: int) -> pd.DataFrame:
    import httpx

    out: list[list[Any]] = []
    end_time: int | None = None
    with httpx.Client(timeout=15.0) as client:
        while len(out) < bars:
            params: dict[str, Any] = {"symbol": symbol, "interval": interval, "limit": min(1000, bars - len(out))}
            if end_time:
                params["endTime"] = end_time
            resp = client.get(f"{settings.binance_rest_url}/api/v3/klines", params=params)
            resp.raise_for_status()
            chunk = resp.json()
            if not chunk:
                break
            out = chunk + out
            end_time = int(chunk[0][0]) - 1
            if len(chunk) < params["limit"]:
                break

    df = pd.DataFrame(out, columns=[
        "open_time", "open", "high", "low", "close", "volume",
        "close_time", "qav", "trades", "tbav", "tqav", "ignore",
    ])
    df["ts"] = pd.to_datetime(df["open_time"], unit="ms")
    for col in ("open", "high", "low", "close", "volume"):
        df[col] = df[col].astype(float)
    df = df[["ts", "open", "high", "low", "close", "volume"]].drop_duplicates("ts").sort_values("ts")
    return df.set_index("ts").tail(bars)


def _synthetic_ohlcv(symbol: str, interval: str, bars: int) -> pd.DataFrame:
    """Deterministic GBM with a mild regime shift. Seeded off the symbol so the
    same request always reproduces the same series (results stay comparable)."""
    seed = abs(hash(symbol)) % (2**31)
    rng = np.random.default_rng(seed)
    anchor = {"BTCUSDT": 68000.0, "ETHUSDT": 3500.0, "SOLUSDT": 160.0}.get(symbol, 100.0)
    ann = bars_per_year(interval)
    vol = 0.60 / math.sqrt(ann)
    drift = 0.25 / ann
    regime = np.concatenate([np.full(bars // 2, drift), np.full(bars - bars // 2, -drift * 0.6)])
    rets = rng.normal(regime, vol, bars) + np.sin(np.arange(bars) / 90) * vol * 0.4
    close = anchor * np.exp(np.cumsum(rets))
    freq = {"1m": "min", "5m": "5min", "15m": "15min", "30m": "30min",
            "1h": "h", "4h": "4h", "1d": "D"}.get(interval, "h")
    idx = pd.date_range(end=_utcnow().replace(tzinfo=None), periods=bars, freq=freq)
    noise = np.abs(rng.normal(0, vol / 2, bars))
    return pd.DataFrame({
        "open": np.r_[close[0], close[:-1]],
        "high": close * (1 + noise),
        "low": close * (1 - noise),
        "close": close,
        "volume": rng.lognormal(6, 0.5, bars),
    }, index=pd.Index(idx, name="ts"))


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


def build_signals(strategy: str, df: pd.DataFrame, fast: int, slow: int) -> tuple[pd.Series, pd.Series]:
    """Return (entries, exits) boolean series for one parameter pair.

    Parameter semantics per strategy (both are always ``fast < slow``):
      ma_cross      fast/slow simple-moving-average periods
      donchian      fast = breakout lookback, slow = trailing-exit lookback
      rsi_reversion fast = RSI period, slow = trend filter / exit MA period
    """
    close = df["close"]

    # Periods are integers wherever they are used as a rolling window, and the
    # parameters now arrive as floats: `ParamResult.fast` was widened so a
    # sigma multiple could be expressed, and pydantic coerces 5 to 5.0 on the
    # way through. `pandas.rolling(5.0)` refuses outright — "window must be an
    # integer 0 or greater" — so walk-forward failed for every period strategy
    # while the sweep itself passed, because the sweep is handed the grid's own
    # ints and walk-forward is handed a value that has been through the schema.
    #
    # Coerced here rather than at each call site: this is the one place that
    # knows which of the two parameters is a window.
    fast = int(fast)
    if strategy not in FREE_SECOND_AXIS:
        slow = int(slow)

    if strategy == "ma_cross":
        f = close.rolling(fast).mean()
        s = close.rolling(slow).mean()
        long = f > s
    elif strategy == "donchian":
        upper = df["high"].rolling(fast).max().shift(1)
        lower = df["low"].rolling(slow).min().shift(1)
        raw = pd.Series(np.nan, index=close.index)
        raw[close > upper] = 1.0
        raw[close < lower] = 0.0
        long = raw.ffill().fillna(0.0) > 0
    elif strategy == "rsi_reversion":
        delta = close.diff()
        gain = delta.clip(lower=0).ewm(alpha=1 / fast, adjust=False).mean()
        loss = (-delta.clip(upper=0)).ewm(alpha=1 / fast, adjust=False).mean()
        rsi = 100 - 100 / (1 + gain / loss.replace(0, np.nan))
        trend = close.rolling(slow).mean()
        raw = pd.Series(np.nan, index=close.index)
        # Buy oversold; exit on mean reversion *or* when price loses the trend MA.
        # The trend filter is a stop, not an entry gate — gating entries on it too
        # makes the two conditions nearly mutually exclusive and the model never trades.
        raw[rsi < 30] = 1.0
        raw[(rsi > 55) | (close < trend)] = 0.0
        long = raw.ffill().fillna(0.0) > 0
    elif strategy == "ema_cross":
        f = close.ewm(span=fast, adjust=False).mean()
        s = close.ewm(span=slow, adjust=False).mean()
        long = f > s
    elif strategy == "macd_cross":
        # Signal period fixed at the conventional 9. The request carries two
        # parameters, and inventing a third axis for a value nobody tunes would
        # multiply every sweep by nine for no information.
        macd = close.ewm(span=fast, adjust=False).mean() - close.ewm(span=slow, adjust=False).mean()
        long = macd > macd.ewm(span=9, adjust=False).mean()
    elif strategy == "momentum":
        # Classic 12-1: measure the return to `slow` bars ago but skip the most
        # recent `fast`, because short-horizon reversal is the documented
        # contaminant of a momentum signal.
        past = close.shift(slow)
        recent = close.shift(fast)
        long = (recent / past - 1.0) > 0
    elif strategy == "donchian_mid":
        upper = df["high"].rolling(fast).max().shift(1)
        lower = df["low"].rolling(fast).min().shift(1)
        mid = (upper + lower) / 2.0
        exit_ma = close.rolling(slow).mean()
        raw = pd.Series(np.nan, index=close.index)
        raw[close > mid] = 1.0
        raw[close < exit_ma] = 0.0
        long = raw.ffill().fillna(0.0) > 0
    elif strategy == "roc_trend":
        roc = close.pct_change(fast)
        trend = close.rolling(slow).mean()
        long = (roc > 0) & (close > trend)
    elif strategy == "williams_r":
        high_n = df["high"].rolling(fast).max()
        low_n = df["low"].rolling(fast).min()
        span = (high_n - low_n).replace(0, np.nan)
        wr = -100 * (high_n - close) / span
        exit_ma = close.rolling(slow).mean()
        raw = pd.Series(np.nan, index=close.index)
        raw[wr < -80] = 1.0
        raw[(wr > -20) | (close < exit_ma)] = 0.0
        long = raw.ffill().fillna(0.0) > 0
    elif strategy == "stochastic":
        high_n = df["high"].rolling(fast).max()
        low_n = df["low"].rolling(fast).min()
        span = (high_n - low_n).replace(0, np.nan)
        k = 100 * (close - low_n) / span
        d = k.rolling(max(2, slow)).mean()
        raw = pd.Series(np.nan, index=close.index)
        # Oversold arms the long; %D is the exit confirmation, not an entry
        # gate. Requiring `k < 20 AND k > d` at the same instant is the crossing
        # moment itself and almost never coincides — it produced a strategy that
        # took zero trades over 600 bars, which is not a conservative model, it
        # is a broken one. Same shape as rsi_reversion above, for the same
        # reason recorded there.
        raw[k < 20] = 1.0
        raw[(k > 80) | (k < d)] = 0.0
        long = raw.ffill().fillna(0.0) > 0
    elif strategy == "breakout_sma":
        upper = close.rolling(fast).max().shift(1)
        trend = close.rolling(slow).mean()
        raw = pd.Series(np.nan, index=close.index)
        raw[(close > upper) & (close > trend)] = 1.0
        raw[close < trend] = 0.0
        long = raw.ffill().fillna(0.0) > 0
    elif strategy == "triple_ma":
        # The middle leg is derived, not a third parameter: the geometric mean
        # keeps the three periods evenly spaced on a log scale, which is how a
        # trend ladder is meant to be spaced and costs no extra sweep axis.
        mid_period = max(2, int(round((fast * slow) ** 0.5)))
        f = close.rolling(fast).mean()
        m = close.rolling(mid_period).mean()
        sl = close.rolling(slow).mean()
        long = (f > m) & (m > sl)
    elif strategy == "ppo_cross":
        fast_ema = close.ewm(span=fast, adjust=False).mean()
        slow_ema = close.ewm(span=slow, adjust=False).mean()
        ppo = (fast_ema - slow_ema) / slow_ema.replace(0, np.nan) * 100
        long = ppo > ppo.ewm(span=9, adjust=False).mean()
    elif strategy == "trix_cross":
        e1 = close.ewm(span=fast, adjust=False).mean()
        e2 = e1.ewm(span=fast, adjust=False).mean()
        e3 = e2.ewm(span=fast, adjust=False).mean()
        trix = e3.pct_change() * 100
        long = trix > trix.rolling(max(2, slow)).mean()
    elif strategy == "rsi_trend":
        # Momentum reading of RSI, the opposite of rsi_reversion: strength above
        # the midline is treated as continuation rather than as something to
        # fade. Both are in the catalogue on purpose — which one is right is a
        # property of the regime, and the sweep is how you find out.
        delta = close.diff()
        gain = delta.clip(lower=0).ewm(alpha=1 / fast, adjust=False).mean()
        loss = (-delta.clip(upper=0)).ewm(alpha=1 / fast, adjust=False).mean()
        r = 100 - 100 / (1 + gain / loss.replace(0, np.nan))
        trend = close.rolling(slow).mean()
        long = (r > 55) & (close > trend)
    elif strategy == "price_channel":
        upper = close.rolling(fast).max().shift(1)
        lower = close.rolling(slow).min().shift(1)
        raw = pd.Series(np.nan, index=close.index)
        raw[close >= upper] = 1.0
        raw[close <= lower] = 0.0
        long = raw.ffill().fillna(0.0) > 0
    elif strategy == "atr_breakout":
        # Volatility-aware breakout: a move is only a signal if it is large
        # relative to how much this instrument has been moving lately. A fixed
        # percentage threshold says the same thing about a calm market and a
        # panicking one.
        atr = _atr(df, fast)
        long = close > (close.shift(1) + float(slow) * atr)
    elif strategy == "keltner_breakout":
        mid = close.ewm(span=max(2, fast), adjust=False).mean()
        atr = _atr(df, fast)
        raw = pd.Series(np.nan, index=close.index)
        raw[close > mid + float(slow) * atr] = 1.0
        raw[close < mid] = 0.0
        long = raw.ffill().fillna(0.0) > 0
    elif strategy == "supertrend":
        atr = _atr(df, fast)
        hl2 = (df["high"] + df["low"]) / 2.0
        upper = hl2 + float(slow) * atr
        lower = hl2 - float(slow) * atr
        raw = pd.Series(np.nan, index=close.index)
        raw[close > upper.shift(1)] = 1.0
        raw[close < lower.shift(1)] = 0.0
        long = raw.ffill().fillna(0.0) > 0
    elif strategy == "atr_trailing_stop":
        # Chandelier exit: ride the trend, leave when price falls a multiple of
        # ATR below the highest close since entry. The stop is the whole model —
        # entry is simply "the trend is up".
        atr = _atr(df, fast)
        trend = close.rolling(max(2, fast)).mean()
        stop = close.rolling(max(2, fast)).max() - float(slow) * atr
        raw = pd.Series(np.nan, index=close.index)
        raw[close > trend] = 1.0
        raw[close < stop] = 0.0
        long = raw.ffill().fillna(0.0) > 0
    elif strategy == "bollinger_breakout":
        # `slow` is the band width in standard deviations — a real float now,
        # swept 1.0..3.0 by 0.25 from FREE_SECOND_AXIS rather than borrowed from
        # a period grid. `fast` remains the lookback.
        period = max(2, int(fast))
        mid = close.rolling(period).mean()
        band = close.rolling(period).std(ddof=0) * float(slow)
        raw = pd.Series(np.nan, index=close.index)
        raw[close > mid + band] = 1.0
        raw[close < mid] = 0.0
        long = raw.ffill().fillna(0.0) > 0
    elif strategy == "zscore_reversion":
        period = max(2, int(fast))
        mean = close.rolling(period).mean()
        sd = close.rolling(period).std(ddof=0).replace(0, np.nan)
        z = (close - mean) / sd
        raw = pd.Series(np.nan, index=close.index)
        raw[z < -float(slow)] = 1.0
        raw[z > 0] = 0.0
        long = raw.ffill().fillna(0.0) > 0
    elif strategy == "ema_slope":
        e = close.ewm(span=fast, adjust=False).mean()
        long = (e - e.shift(slow)) > 0
    else:
        raise ValueError(f"unknown strategy: {strategy}")

    prev = long.shift(1, fill_value=False)
    return (long & ~prev), (~long & prev)


def _axis(low: float, high: float, step: float) -> list[float]:
    """Inclusive range that tolerates a float step.

    `range` is integer-only and `numpy.arange` accumulates error — at step 0.25
    it lands on 2.7499999999999996 and a reader comparing a slider to a result
    sees two different numbers. Multiplying an integer index avoids both.
    """
    if step <= 0:
        return [low]
    count = int(math.floor((high - low) / step + 1e-9)) + 1
    values = [round(low + index * step, 10) for index in range(max(1, count))]
    # Integral axes stay ints. `pandas.rolling()` rejects a float window
    # outright — "window must be an integer 0 or greater" — so returning 5.0
    # where 5 was meant breaks every period-based strategy. It surfaced only as
    # a logged warning from walk-forward, because the parity fixture passes
    # literal ints and never exercised the generated grid.
    if all(float(v).is_integer() for v in (low, high, step)):
        return [int(v) for v in values]
    return values


def param_grid(req: BacktestRequest) -> list[tuple[float, float]]:
    fasts = _axis(req.fast_min, req.fast_max, req.fast_step)

    free = FREE_SECOND_AXIS.get(req.strategy)
    if free is not None:
        # The request's slow_* fields describe a period sweep the UI generated
        # for a period axis. For these strategies the second axis has its own
        # units, so the registry supplies the range and the ordering constraint
        # does not apply — the two numbers are not comparable quantities.
        slows = _axis(*free)
        combos = [(f, s) for f in fasts for s in slows]
    else:
        slows = _axis(req.slow_min, req.slow_max, req.slow_step)
        combos = [(f, s) for f in fasts for s in slows if f < s]

    if len(combos) > settings.backtest_max_combos:
        step = math.ceil(len(combos) / settings.backtest_max_combos)
        combos = combos[::step]
    return combos


# --------------------------------------------------------------------------- #
# Metrics
# --------------------------------------------------------------------------- #
def _annualised_sharpe(returns: np.ndarray, ann: float) -> float:
    sd = returns.std(ddof=1)
    return float(returns.mean() / sd * math.sqrt(ann)) if sd > 0 else 0.0


def _sortino(returns: np.ndarray, ann: float) -> float:
    downside = returns[returns < 0]
    dd = downside.std(ddof=1) if downside.size > 1 else 0.0
    return float(returns.mean() / dd * math.sqrt(ann)) if dd > 0 else 0.0


def _max_drawdown(equity: np.ndarray) -> float:
    peak = np.maximum.accumulate(equity)
    return float(np.min(equity / peak - 1.0)) if peak.size else 0.0


def _norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _norm_ppf(p: float) -> float:
    """Acklam's inverse-normal approximation (|error| < 1.15e-9). Avoids a SciPy
    dependency on the critical DSR path."""
    p = min(max(p, 1e-12), 1 - 1e-12)
    a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
         1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00]
    b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
         6.680131188771972e+01, -1.328068155288572e+01]
    c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
         -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00]
    d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00]
    plow, phigh = 0.02425, 1 - 0.02425
    if p < plow:
        q = math.sqrt(-2 * math.log(p))
        return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / \
               ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    if p > phigh:
        q = math.sqrt(-2 * math.log(1 - p))
        return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / \
                ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    q = p - 0.5
    r = q * q
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / \
           (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)


def probabilistic_sharpe_ratio(sr: float, sr_benchmark: float, n: int, skew: float, kurt: float) -> float:
    """PSR — P(true SR > benchmark) given a finite, non-normal sample.

    ``sr``/``sr_benchmark`` are **per-observation** (not annualised) Sharpes.
    """
    if n < 3:
        return 0.0
    denom = math.sqrt(max(1e-12, 1 - skew * sr + (kurt - 1) / 4 * sr**2))
    return _norm_cdf((sr - sr_benchmark) * math.sqrt(n - 1) / denom)


def deflated_sharpe_ratio(
    sr_candidates: np.ndarray, sr_selected: float, n_obs: int, skew: float, kurt: float
) -> tuple[float, float, float]:
    """DSR — PSR measured against the Sharpe a *random* search of the same size
    would have produced. Returns (dsr, psr_vs_zero, expected_max_sr).

    Bailey & López de Prado (2014), eq. 3 — the expected maximum of N trials
    **under the null that every trial's true Sharpe is zero**:

        SR*₀ = √V[{SRₙ}] · [ (1−γ)·Z⁻¹(1 − 1/N) + γ·Z⁻¹(1 − 1/(N·e)) ]

    Note the null drops the sample mean: the hurdle is generated entirely by the
    *dispersion* of the search, not by how well the search happened to do. Adding
    the mean back (a common implementation slip) makes the hurdle negative when a
    grid is uniformly unprofitable, which would let a losing strategy clear it.
    """
    n_trials = max(1, len(sr_candidates))
    sd = float(np.std(sr_candidates, ddof=1)) if n_trials > 1 else 0.0
    gamma = 0.5772156649015329  # Euler–Mascheroni

    if n_trials > 1 and sd > 0:
        expected_max = sd * (
            (1 - gamma) * _norm_ppf(1 - 1 / n_trials) + gamma * _norm_ppf(1 - 1 / (n_trials * math.e))
        )
    else:
        expected_max = 0.0

    dsr = probabilistic_sharpe_ratio(sr_selected, expected_max, n_obs, skew, kurt)
    psr0 = probabilistic_sharpe_ratio(sr_selected, 0.0, n_obs, skew, kurt)
    return dsr, psr0, expected_max


def min_track_record_length(
    sr: float, sr_benchmark: float, skew: float, kurt: float, confidence: float = 0.95
) -> float:
    """MinTRL — the observation count at which PSR(benchmark) reaches ``confidence``.

    Bailey & López de Prado:  N* = 1 + (1 − γ₃·S + (γ₄−1)/4·S²)·(Z_conf/(S−S*))²

    The exact inverse of :func:`probabilistic_sharpe_ratio` solved for n, using
    the same per-observation Sharpe convention, raw kurtosis (normal = 3) and
    the same 1e-12 variance clamp. Returns ``inf`` when ``sr <= sr_benchmark``:
    no finite record can prove an edge that is not there. Mirrored in the
    portal's ``lib/stats.ts``.
    """
    if sr <= sr_benchmark:
        return math.inf
    z = _norm_ppf(confidence)
    var_term = max(1e-12, 1 - skew * sr + (kurt - 1) / 4 * sr**2)
    return 1 + var_term * (z / (sr - sr_benchmark)) ** 2


def dsr_verdict(dsr: float) -> str:
    if dsr >= 0.95:
        return "PASS — selected parameters survive the multiple-testing penalty (DSR ≥ 0.95)."
    if dsr >= 0.80:
        return "MARGINAL — edge is plausible but not established; needs more data or fewer trials."
    return "FAIL — the winning Sharpe is consistent with selection bias over this grid. Do not allocate."


# --------------------------------------------------------------------------- #
# Engines
# --------------------------------------------------------------------------- #
def _stats_from_returns(
    strat_rets: np.ndarray, position: np.ndarray, turnover_units: float,
    fees_paid: float, ann: float, trades: int, wins: int,
) -> dict[str, float]:
    equity = np.cumprod(1.0 + strat_rets)
    total_return = float(equity[-1] - 1.0) if equity.size else 0.0
    years = len(strat_rets) / ann if ann else 0.0
    cagr = float((1 + total_return) ** (1 / years) - 1) if years > 0 and total_return > -1 else 0.0
    mdd = _max_drawdown(equity)
    return {
        "total_return": total_return,
        "cagr": cagr,
        "sharpe": _annualised_sharpe(strat_rets, ann),
        "sortino": _sortino(strat_rets, ann),
        "max_drawdown": mdd,
        "calmar": float(cagr / abs(mdd)) if mdd < 0 else 0.0,
        "win_rate": float(wins / trades) if trades else 0.0,
        "trades": int(trades),
        "exposure": float(np.mean(np.abs(position) > 0)),
        "turnover": float(turnover_units),
        "fees_paid": float(fees_paid),
    }


class NumpyEngine:
    """Reference implementation. Vectorised, dependency-free, fully auditable.

    Accounting conventions (identical to the vectorbt configuration):
      * signals are generated on bar *t* and executed on bar *t+1*'s open-to-close
        return — no look-ahead;
      * costs = (fee + slippage) bps charged on the *notional turnover* of every
        position change;
      * returns compound on equity, i.e. constant-fraction (100%) position sizing.
    """

    name = "numpy-vectorised"

    def run(self, df: pd.DataFrame, combos: list[tuple[int, int]], req: BacktestRequest,
            progress: Callable[[float, str], None] | None = None) -> tuple[list[ParamResult], dict[tuple[int, int], np.ndarray]]:
        close = df["close"]
        px_ret = close.pct_change().fillna(0.0).to_numpy()
        ann = bars_per_year(req.interval)
        cost = (req.fee_bps + req.slippage_bps) / 1e4

        results: list[ParamResult] = []
        equities: dict[tuple[int, int], np.ndarray] = {}

        for i, (fast, slow) in enumerate(combos):
            entries, exits = build_signals(req.strategy, df, fast, slow)
            raw = pd.Series(np.nan, index=close.index)
            raw[entries.to_numpy()] = 1.0
            raw[exits.to_numpy()] = -1.0 if req.direction == "long_short" else 0.0
            position = raw.ffill().fillna(0.0).to_numpy()

            lagged = np.r_[0.0, position[:-1]]            # execute next bar
            turnover = np.abs(np.diff(np.r_[0.0, lagged]))
            strat_rets = lagged * px_ret - turnover * cost
            equity = np.cumprod(1.0 + strat_rets)

            changes = np.flatnonzero(turnover > 0)
            trades = wins = 0
            # Truncating is intended: with no position changes the right-hand
            # array still holds the end sentinel, and "no changes" means "no
            # trades to pair up".
            for a, b in zip(changes, np.r_[changes[1:], len(strat_rets)], strict=False):
                if lagged[a] == 0:
                    continue
                trades += 1
                if equity[b - 1] / (equity[a - 1] if a > 0 else 1.0) > 1:
                    wins += 1

            # Cost in dollars on a $100k book (vectorbt's init_cash), so the two
            # engines' `fees_paid` are directly comparable: each rebalance is
            # charged on the equity actually deployed at that bar.
            fees_usd = float(np.sum(turnover * cost * np.r_[1.0, equity[:-1]]) * 100_000.0)
            stats = _stats_from_returns(
                strat_rets, lagged, float(turnover.sum()), fees_usd, ann, trades, wins,
            )
            results.append(ParamResult(fast=fast, slow=slow, **stats))
            equities[(fast, slow)] = equity
            if progress and i % 10 == 0:
                progress(0.15 + 0.6 * i / max(1, len(combos)), f"swept {i}/{len(combos)} combinations")

        return results, equities


class VectorbtEngine:
    """Primary engine — the full grid runs as a single 2-D vectorbt portfolio."""

    name = "vectorbt"

    def run(self, df: pd.DataFrame, combos: list[tuple[int, int]], req: BacktestRequest,
            progress: Callable[[float, str], None] | None = None) -> tuple[list[ParamResult], dict[tuple[int, int], np.ndarray]]:
        close = df["close"]
        cols = pd.MultiIndex.from_tuples(combos, names=["fast", "slow"])
        entries = pd.DataFrame(False, index=close.index, columns=cols)
        exits = pd.DataFrame(False, index=close.index, columns=cols)

        for i, (fast, slow) in enumerate(combos):
            e, x = build_signals(req.strategy, df, fast, slow)
            entries[(fast, slow)] = e.to_numpy()
            exits[(fast, slow)] = x.to_numpy()
            if progress and i % 25 == 0:
                progress(0.15 + 0.25 * i / max(1, len(combos)), f"built signals {i}/{len(combos)}")

        if progress:
            progress(0.45, f"running {len(combos)}-combination vectorbt sweep")

        kwargs: dict[str, Any] = dict(
            init_cash=100_000.0,
            fees=req.fee_bps / 1e4,
            slippage=req.slippage_bps / 1e4,
        )
        if req.direction == "long_short":
            kwargs["direction"] = "both"
        pf = vbt.Portfolio.from_signals(close, entries, exits, **kwargs)

        ann = bars_per_year(req.interval)
        value = pf.value()
        rets = value.pct_change().fillna(0.0)

        trades_count = pf.trades.count()
        try:
            win_rate = pf.trades.win_rate().fillna(0.0)
        except Exception:
            win_rate = pd.Series(0.0, index=trades_count.index)

        # Position series -> exposure. (asset_flow() is per-bar *change*, so it
        # measures trade frequency, not time in market.)
        assets = pf.assets()

        # Realised costs and traded notional, straight from the order records.
        fees_by_col: dict[Any, float] = {}
        turnover_by_col: dict[Any, float] = {}
        try:
            recs = pf.orders.records_readable
            recs = recs.assign(_notional=recs["Size"] * recs["Price"])
            fees_by_col = recs.groupby("Column")["Fees"].sum().to_dict()
            turnover_by_col = recs.groupby("Column")["_notional"].sum().to_dict()
        except Exception as exc:  # pragma: no cover - vectorbt version drift
            log.warning("could not read order records for cost attribution: %s", exc)

        results: list[ParamResult] = []
        equities: dict[tuple[int, int], np.ndarray] = {}
        for key in combos:
            col_rets = rets[key].to_numpy()
            col_val = value[key].to_numpy()
            equity = col_val / col_val[0]
            total_return = float(equity[-1] - 1.0)
            years = len(col_rets) / ann if ann else 0.0
            cagr = float((1 + total_return) ** (1 / years) - 1) if years > 0 and total_return > -1 else 0.0
            mdd = _max_drawdown(equity)
            n_trades = int(trades_count.get(key, 0))
            results.append(ParamResult(
                fast=key[0], slow=key[1],
                total_return=total_return,
                cagr=cagr,
                sharpe=_annualised_sharpe(col_rets, ann),
                sortino=_sortino(col_rets, ann),
                max_drawdown=mdd,
                calmar=float(cagr / abs(mdd)) if mdd < 0 else 0.0,
                win_rate=float(win_rate.get(key, 0.0) or 0.0),
                trades=n_trades,
                exposure=float((assets[key].to_numpy() != 0).mean()),
                # Turnover as a multiple of initial capital — same unit as the
                # NumPy engine's sum of |Δposition| under constant-fraction sizing.
                turnover=float(turnover_by_col.get(key, 0.0)) / 100_000.0,
                fees_paid=float(fees_by_col.get(key, 0.0)),
            ))
            equities[key] = equity

        if progress:
            progress(0.75, "sweep complete")
        return results, equities


def get_engine(prefer_vectorbt: bool = True):
    if prefer_vectorbt and VECTORBT_AVAILABLE:
        return VectorbtEngine()
    return NumpyEngine()


# --------------------------------------------------------------------------- #
# Walk-forward
# --------------------------------------------------------------------------- #
def walk_forward(df: pd.DataFrame, combos: list[tuple[int, int]], req: BacktestRequest,
                 engine) -> tuple[list[WalkForwardFold], float | None]:
    """Rolling, non-anchored: optimise on segment *i*, trade segment *i+1*.

    The aggregate OOS Sharpe is the honest estimate — it is the only number here
    computed on data the parameter choice never touched.

    ``embargo_bars`` discards a gap between each training window and its test
    window. Adjacent folds leak: a 200-bar moving average evaluated on the first
    test bar is mostly made of training bars, so the "out-of-sample" score is
    partly in-sample. An embargo at least as long as the slowest lookback
    removes that overlap. It defaults to 0, which keeps the original behaviour.
    """
    n = len(df)
    folds = max(2, min(req.folds, settings.walk_forward_folds if req.folds is None else req.folds))
    seg = n // (folds + 1)
    if seg < 100:
        return [], None

    embargo = max(0, min(int(getattr(req, "embargo_bars", 0) or 0), max(0, seg - 50)))

    out: list[WalkForwardFold] = []
    oos_returns: list[np.ndarray] = []
    ann = bars_per_year(req.interval)

    for i in range(folds):
        # The embargo comes out of the *training* window's tail rather than
        # shifting the test window: shifting would walk the last fold off the
        # end of the data and quietly drop it.
        train = df.iloc[i * seg:(i + 1) * seg - embargo]
        test = df.iloc[(i + 1) * seg:(i + 2) * seg]
        if len(test) < 50 or len(train) < 50:
            break

        is_results, _ = engine.run(train, combos, req)
        best_is = max(is_results, key=lambda r: r.sharpe)

        # Score the *whole* grid out-of-sample, not just the winner. One OOS
        # Sharpe cannot distinguish "this parameter choice was right" from "this
        # fold was easy for everything"; the winner's rank among its peers can.
        oos_results, _ = engine.run(test, combos, req)
        by_combo = {(r.fast, r.slow): r for r in oos_results}
        oos = by_combo.get((best_is.fast, best_is.slow))
        if oos is None:
            oos = engine.run(test, [(best_is.fast, best_is.slow)], req)[0][0]
        ranked = sorted(oos_results, key=lambda r: r.sharpe, reverse=True)
        oos_rank = next(
            (i + 1 for i, r in enumerate(ranked) if (r.fast, r.slow) == (best_is.fast, best_is.slow)),
            None,
        )

        # Recompute the OOS return stream so folds can be concatenated.
        entries, exits = build_signals(req.strategy, test, best_is.fast, best_is.slow)
        raw = pd.Series(np.nan, index=test.index)
        raw[entries.to_numpy()] = 1.0
        raw[exits.to_numpy()] = -1.0 if req.direction == "long_short" else 0.0
        pos = raw.ffill().fillna(0.0).to_numpy()
        lagged = np.r_[0.0, pos[:-1]]
        px_ret = test["close"].pct_change().fillna(0.0).to_numpy()
        cost = (req.fee_bps + req.slippage_bps) / 1e4
        oos_returns.append(lagged * px_ret - np.abs(np.diff(np.r_[0.0, lagged])) * cost)

        out.append(WalkForwardFold(
            fold=i + 1,
            train_start=str(train.index[0])[:16], train_end=str(train.index[-1])[:16],
            test_start=str(test.index[0])[:16], test_end=str(test.index[-1])[:16],
            chosen_fast=best_is.fast, chosen_slow=best_is.slow,
            is_sharpe=round(best_is.sharpe, 3),
            oos_sharpe=round(oos.sharpe, 3),
            oos_return=round(oos.total_return, 5),
            oos_rank=oos_rank,
            combos_ranked=len(ranked),
            embargo_bars=embargo,
        ))

    agg = _annualised_sharpe(np.concatenate(oos_returns), ann) if oos_returns else None
    return out, agg


def overfitting_probability(folds: list[WalkForwardFold]) -> float | None:
    """Probability that the chosen parameters are no better than a coin flip.

    A lightweight reading of Bailey et al.'s probability of backtest
    overfitting: in each fold the in-sample winner is ranked against every other
    combination out-of-sample, and PBO is the fraction of folds where it landed
    in the *worse* half. A strategy whose winners keep placing in the bottom
    half is being selected by noise — the grid search is fitting the fold, not
    the market.

    This is the cheap version. Full CPCV evaluates every train/test split
    combinatorially rather than the sequential folds used here, which costs
    factorially more compute for a tighter estimate of the same quantity.
    Returns ``None`` when no fold produced a rank.
    """
    ranked = [f for f in folds if f.oos_rank and f.combos_ranked and f.combos_ranked > 1]
    if not ranked:
        return None
    # Median rank is the midpoint: worse than median is the losing half.
    losses = sum(1 for f in ranked if f.oos_rank > (f.combos_ranked + 1) / 2)
    return round(losses / len(ranked), 4)


def dataset_fingerprint(df: pd.DataFrame) -> str:
    """SHA-256 over the price series this run actually saw.

    A symbol and a date range do not identify a dataset. The same window can be
    a live Binance pull, a cached copy, or the synthetic fallback, and the
    synthetic series is not even stable across processes. Two runs that share
    this hash provably compared the same bars; two that do not are not
    comparable however similar their headers look.

    Every price column is hashed, not just the close: ``donchian`` reads highs
    and lows, so a vendor revising a session high changes the signal while the
    close is untouched. A fingerprint that missed that would certify two runs as
    comparable at exactly the moment they stopped being so.
    """
    digest = hashlib.sha256()
    for column in ("open", "high", "low", "close"):
        if column in df.columns:
            digest.update(column.encode())
            digest.update(np.ascontiguousarray(df[column].to_numpy(dtype="float64")).tobytes())
    digest.update(str(df.index[0]).encode())
    digest.update(str(df.index[-1]).encode())
    digest.update(str(len(df)).encode())
    return digest.hexdigest()[:16]


# --------------------------------------------------------------------------- #
# Plots (thread-safe: object API, never pyplot)
# --------------------------------------------------------------------------- #
def _fig_to_b64(fig) -> str:
    from matplotlib.backends.backend_agg import FigureCanvasAgg

    FigureCanvasAgg(fig)
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=130, bbox_inches="tight", facecolor=fig.get_facecolor())
    buf.seek(0)
    return base64.b64encode(buf.read()).decode()


_BG, _FG, _GRID = "#0e1117", "#e6edf3", "#2a3038"
_ACCENT, _MUTED, _WARN = "#2ea8ff", "#7d8590", "#ff6b6b"

# Diverging scale for the Sharpe surface: blue ↔ neutral gray ↔ red. Two hues
# that read as opposite, a midpoint that reads as "nothing". Steps are the
# dark-surface values from the shared palette, so the notebook charts, the Mini
# App and the Vercel portal all render the same scale.
_SHARPE_COLOURS = ["#e66767", "#a75450", "#383835", "#2b628f", "#3987e5"]


def _build_sharpe_cmap():
    try:
        from matplotlib.colors import LinearSegmentedColormap

        return LinearSegmentedColormap.from_list("alphaengine_diverging", _SHARPE_COLOURS)
    except Exception:  # pragma: no cover - matplotlib absent
        return "coolwarm"


_SHARPE_CMAP = _build_sharpe_cmap()


def plot_equity_curve(df: pd.DataFrame, equity: np.ndarray, best: ParamResult, req: BacktestRequest,
                      oos_sharpe: float | None, dsr: float) -> str | None:
    try:
        from matplotlib.figure import Figure
    except Exception as exc:
        log.warning("matplotlib unavailable: %s", exc)
        return None

    idx = df.index
    bh = (df["close"] / df["close"].iloc[0]).to_numpy()
    dd = equity / np.maximum.accumulate(equity) - 1.0

    fig = Figure(figsize=(11, 7), facecolor=_BG)
    gs = fig.add_gridspec(3, 1, height_ratios=[2.4, 1, 0.9], hspace=0.28)

    ax = fig.add_subplot(gs[0], facecolor=_BG)
    ax.plot(idx, equity, color=_ACCENT, lw=1.9, label=f"Strategy ({req.strategy} {best.fast}/{best.slow})")
    ax.plot(idx, bh, color=_MUTED, lw=1.2, ls="--", label="Buy & hold")
    ax.set_title(
        f"{req.symbol} · {req.interval} · {req.strategy}   |   "
        f"Sharpe {best.sharpe:.2f}  ·  Return {best.total_return:+.1%}  ·  MaxDD {best.max_drawdown:.1%}",
        color=_FG, fontsize=12, pad=12, loc="left",
    )
    ax.legend(facecolor=_BG, edgecolor=_GRID, labelcolor=_FG, fontsize=9, loc="upper left")
    ax.set_ylabel("Growth of $1", color=_FG, fontsize=9)

    ax2 = fig.add_subplot(gs[1], facecolor=_BG, sharex=ax)
    ax2.fill_between(idx, dd * 100, 0, color=_WARN, alpha=0.35)
    ax2.plot(idx, dd * 100, color=_WARN, lw=1.0)
    ax2.set_ylabel("Drawdown %", color=_FG, fontsize=9)

    ax3 = fig.add_subplot(gs[2], facecolor=_BG)
    ax3.axis("off")
    verdict_colour = "#3fb950" if dsr >= 0.95 else ("#d29922" if dsr >= 0.8 else _WARN)
    lines = [
        f"CAGR {best.cagr:+.2%}    Sortino {best.sortino:.2f}    Calmar {best.calmar:.2f}    "
        f"Win rate {best.win_rate:.1%}    Trades {best.trades}    Exposure {best.exposure:.0%}",
        f"Deflated Sharpe Ratio: {dsr:.3f}" + (f"    Walk-forward OOS Sharpe: {oos_sharpe:.2f}" if oos_sharpe is not None else ""),
        dsr_verdict(dsr),
    ]
    for i, line in enumerate(lines):
        ax3.text(0, 0.85 - i * 0.33, line, color=_FG if i < 2 else verdict_colour,
                 fontsize=9.5 if i < 2 else 10, family="monospace", transform=ax3.transAxes)

    for a in (ax, ax2):
        a.grid(True, color=_GRID, lw=0.6, alpha=0.7)
        a.tick_params(colors=_MUTED, labelsize=8)
        for spine in a.spines.values():
            spine.set_color(_GRID)
    return _fig_to_b64(fig)


def plot_heatmap(results: list[ParamResult], req: BacktestRequest) -> str | None:
    try:
        from matplotlib.figure import Figure
    except Exception:
        return None
    if len(results) < 4:
        return None

    frame = pd.DataFrame([r.model_dump() for r in results])
    pivot = frame.pivot_table(index="fast", columns="slow", values="sharpe")

    fig = Figure(figsize=(9, 5.6), facecolor=_BG)
    ax = fig.add_subplot(111, facecolor=_BG)
    vmax = float(np.nanmax(np.abs(pivot.to_numpy()))) or 1.0
    # Sharpe is signed around a meaningful zero => diverging scale: two hues that
    # read as opposite, with a NEUTRAL midpoint. (A red-yellow-green map puts a
    # hue at the midpoint, so "zero Sharpe" reads as a value rather than as
    # nothing — and yellow/green is the pair colour-blind readers lose first.)
    im = ax.imshow(pivot.to_numpy(), cmap=_SHARPE_CMAP, aspect="auto", origin="lower",
                   vmin=-vmax, vmax=vmax)
    ax.set_xticks(range(len(pivot.columns)), [str(c) for c in pivot.columns], color=_MUTED, fontsize=8, rotation=45)
    ax.set_yticks(range(len(pivot.index)), [str(i) for i in pivot.index], color=_MUTED, fontsize=8)
    ax.set_xlabel("slow period", color=_FG, fontsize=9)
    ax.set_ylabel("fast period", color=_FG, fontsize=9)
    ax.set_title(
        f"Annualised Sharpe surface — {req.symbol} {req.interval} · {len(results)} combinations\n"
        "A smooth plateau is a robust parameter region; an isolated peak is an overfit.",
        color=_FG, fontsize=10.5, loc="left", pad=12,
    )
    cbar = fig.colorbar(im, ax=ax)
    cbar.set_label("Annualised Sharpe  (grey = 0)", color=_MUTED, fontsize=8.5)
    cbar.ax.tick_params(colors=_MUTED, labelsize=8)
    cbar.outline.set_edgecolor(_GRID)
    for spine in ax.spines.values():
        spine.set_color(_GRID)
    return _fig_to_b64(fig)


# --------------------------------------------------------------------------- #
# Orchestration — the callable the job queue dispatches
# --------------------------------------------------------------------------- #
def run_backtest(req_dict: dict[str, Any], job_id: str = "local",
                 progress: Callable[[float, str], None] | None = None) -> dict[str, Any]:
    """Full sweep + statistics + plots. Returns a JSON-safe dict (Celery-friendly)."""
    t0 = time.perf_counter()
    req = BacktestRequest(**req_dict) if isinstance(req_dict, dict) else req_dict
    warnings: list[str] = []

    def report(pct: float, msg: str) -> None:
        if progress:
            progress(pct, msg)
        log.info("[%s] %.0f%% %s", job_id, pct * 100, msg)

    report(0.05, f"loading {req.bars} × {req.interval} bars of {req.symbol}")
    df, source = fetch_ohlcv(req.symbol, req.interval, req.bars)
    if source == "synthetic":
        warnings.append("Live market data unreachable — this run uses a deterministic synthetic price series.")
    if len(df) < 200:
        raise RuntimeError(f"insufficient data: {len(df)} bars")

    combos = param_grid(req)
    if not combos:
        raise ValueError("empty parameter grid (require fast < slow)")
    if len(combos) >= settings.backtest_max_combos:
        warnings.append(f"grid truncated to {len(combos)} combinations (BACKTEST_MAX_COMBOS)")

    engine = get_engine()
    report(0.15, f"{engine.name}: sweeping {len(combos)} parameter combinations")
    results, equities = engine.run(df, combos, req, report)
    best = max(results, key=lambda r: r.sharpe)
    best_equity = equities[(best.fast, best.slow)]

    # --- multiple-testing correction ------------------------------------- #
    ann = bars_per_year(req.interval)
    best_rets = np.diff(np.r_[1.0, best_equity]) / np.r_[1.0, best_equity][:-1]
    sr_per_bar = float(best_rets.mean() / best_rets.std(ddof=1)) if best_rets.std(ddof=1) > 0 else 0.0
    sr_candidates = np.array([r.sharpe / math.sqrt(ann) for r in results])
    skew = float(pd.Series(best_rets).skew() or 0.0)
    kurt = float((pd.Series(best_rets).kurtosis() or 0.0) + 3.0)  # pandas returns excess kurtosis
    dsr, psr, expected_max = deflated_sharpe_ratio(sr_candidates, sr_per_bar, len(best_rets), skew, kurt)
    mintrl = min_track_record_length(sr_per_bar, 0.0, skew, kurt)
    report(0.80, f"DSR {dsr:.3f} across {len(results)} trials")

    # --- walk-forward ----------------------------------------------------- #
    wf_folds: list[WalkForwardFold] = []
    wf_oos = None
    if req.walk_forward:
        report(0.84, f"walk-forward: {req.folds} folds")
        try:
            wf_folds, wf_oos = walk_forward(df, combos, req, NumpyEngine())
        except Exception as exc:
            warnings.append(f"walk-forward skipped: {exc}")
            log.warning("walk-forward failed: %s", exc)

    # --- benchmark & plots ------------------------------------------------ #
    bh_rets = df["close"].pct_change().fillna(0.0).to_numpy()
    bh_equity = np.cumprod(1 + bh_rets)
    benchmark = {
        "total_return": float(bh_equity[-1] - 1),
        "sharpe": _annualised_sharpe(bh_rets, ann),
        "max_drawdown": _max_drawdown(bh_equity),
    }

    report(0.90, "rendering equity curve and Sharpe surface")
    equity_png = plot_equity_curve(df, best_equity, best, req, wf_oos, dsr)
    heatmap_png = plot_heatmap(results, req)

    step = max(1, len(df) // 400)  # thin the curve for the browser payload
    result = BacktestResult(
        job_id=job_id,
        request=req,
        engine=engine.name,
        data_source=source,
        bars=len(df),
        period_start=str(df.index[0])[:16],
        period_end=str(df.index[-1])[:16],
        data_hash=dataset_fingerprint(df),
        combos_tested=len(results),
        best=best,
        benchmark_buy_hold=benchmark,
        top_results=sorted(results, key=lambda r: r.sharpe, reverse=True)[:15],
        deflated_sharpe_ratio=round(dsr, 4),
        probabilistic_sharpe_ratio=round(psr, 4),
        min_track_record_bars=round(mintrl, 1) if math.isfinite(mintrl) else None,
        dsr_verdict=dsr_verdict(dsr),
        walk_forward=wf_folds,
        walk_forward_oos_sharpe=round(wf_oos, 3) if wf_oos is not None else None,
        overfitting_probability=overfitting_probability(wf_folds),
        equity_curve_png=equity_png,
        heatmap_png=heatmap_png,
        equity_curve={
            "ts": [str(t)[:16] for t in df.index[::step]],
            "strategy": [round(float(v), 6) for v in best_equity[::step]],
            "buy_hold": [round(float(v), 6) for v in bh_equity[::step]],
        },
        duration_s=round(time.perf_counter() - t0, 2),
        warnings=warnings,
    )

    try:
        from modules.audit import get_audit

        get_audit().record_backtest(result, result.duration_s)
    except Exception as exc:
        log.warning("backtest audit write failed: %s", exc)

    report(1.0, "done")
    return result.model_dump(mode="json")
