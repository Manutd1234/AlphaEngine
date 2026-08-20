"""Strategy name to entry/exit series. One dispatch, forty-six rules."""

from __future__ import annotations

import logging

import numpy as np
import pandas as pd

from modules.backtester.indicators import FREE_FIRST_AXIS, FREE_SECOND_AXIS, _atr, _linreg_forecast
from modules.backtester.moving_averages import (
    _BATCH_TWO,
)
from modules.backtester.state import _batch_two_state

log = logging.getLogger("alphaengine.backtest")

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
    if strategy not in FREE_FIRST_AXIS:
        fast = int(fast)
    if strategy not in FREE_SECOND_AXIS:
        slow = int(slow)

    if strategy in _BATCH_TWO:
        long = _batch_two_state(strategy, df, close, float(fast), float(slow))
        prev = long.shift(1, fill_value=False)
        return (long & ~prev), (~long & prev)

    if strategy == "linreg_forecast":
        long = pd.Series(_linreg_forecast(close.to_numpy(), fast, slow) > 0, index=close.index)
        prev = long.shift(1, fill_value=False)
        return (long & ~prev), (~long & prev)

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
    elif strategy == "obv_trend":
        # On-balance volume: cumulative volume signed by the day's direction.
        # It answers whether a price move carried participation behind it, which
        # a price-only trend model cannot see.
        direction = np.sign(close.diff().fillna(0.0))
        obv = (direction * df["volume"]).cumsum()
        long = obv > obv.rolling(max(2, fast)).mean()
    elif strategy == "volume_breakout":
        # A breakout only counts if volume confirms it. Breakouts on thin
        # participation are the ones that fail, and this is the cheapest
        # available filter for that.
        upper = close.rolling(fast).max().shift(1)
        vol_ma = df["volume"].rolling(max(2, slow)).mean()
        raw = pd.Series(np.nan, index=close.index)
        raw[(close > upper) & (df["volume"] > vol_ma)] = 1.0
        raw[close < close.rolling(fast).mean()] = 0.0
        long = raw.ffill().fillna(0.0) > 0
    elif strategy == "mfi_reversion":
        # Money-flow index: RSI weighted by dollar volume, so a move on heavy
        # participation counts for more than the same move on none.
        typical = (df["high"] + df["low"] + close) / 3.0
        flow = typical * df["volume"]
        delta = typical.diff()
        positive = flow.where(delta > 0, 0.0).rolling(max(2, fast)).sum()
        negative = flow.where(delta < 0, 0.0).rolling(max(2, fast)).sum()
        mfi = 100 - 100 / (1 + positive / negative.replace(0, np.nan))
        exit_ma = close.rolling(slow).mean()
        raw = pd.Series(np.nan, index=close.index)
        raw[mfi < 20] = 1.0
        raw[(mfi > 80) | (close < exit_ma)] = 0.0
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
