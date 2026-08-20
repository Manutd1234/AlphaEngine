"""Entry/exit series to a position series, and the batched two-state rules."""

from __future__ import annotations

import logging

import numpy as np
import pandas as pd

from modules.backtester.moving_averages import _bars_since_max, _bars_since_min, _dema, _ema, _hma, _tema, _zlema

log = logging.getLogger("alphaengine.backtest")

def _state_machine(entry: np.ndarray, exit_: np.ndarray) -> np.ndarray:
    """Latch entries, and let an exit win on a bar where both fire.

    The convention every strategy in this module shares, factored out here
    because nineteen hand-written loops is nineteen chances to write the two
    assignments in the wrong order — which turns RSI reversion from 2 trades
    into 70 and looks like a better strategy.
    """
    out = np.zeros(len(entry), dtype=bool)
    state = False
    for i in range(len(entry)):
        if entry[i]:
            state = True
        if exit_[i]:
            state = False
        out[i] = state
    return out


def _batch_two_state(
    strategy: str, df: pd.DataFrame, close: pd.Series, fast: float, slow: float
) -> pd.Series:
    high, low, volume = df["high"], df["low"], df["volume"]
    idx = close.index

    if strategy in ("dema_cross", "tema_cross", "zlema_cross"):
        fn = {"dema_cross": _dema, "tema_cross": _tema, "zlema_cross": _zlema}[strategy]
        return fn(close, fast) > fn(close, slow)

    if strategy == "hull_trend":
        h = _hma(close, fast)
        return (h > h.shift(int(slow))).fillna(False)

    if strategy == "vwap_trend":
        typical = (high + low + close) / 3.0
        period = max(1, int(round(fast)))
        vwap = (typical * volume).rolling(period).sum() / volume.rolling(period).sum()
        exit_ma = close.rolling(int(slow)).mean()
        return pd.Series(
            _state_machine((close > vwap).to_numpy(), (close < exit_ma).to_numpy()), index=idx
        )

    if strategy == "cci_reversion":
        period = max(1, int(round(fast)))
        typical = (high + low + close) / 3.0
        mean_tp = typical.rolling(period).mean()
        deviation = typical.rolling(period).apply(
            lambda w: float(np.abs(w - w.mean()).mean()), raw=True
        )
        cci = (typical - mean_tp) / (0.015 * deviation.replace(0.0, np.nan))
        exit_ma = close.rolling(50).mean()
        return pd.Series(
            _state_machine((cci < -slow).to_numpy(), ((cci > 0) | (close < exit_ma)).to_numpy()),
            index=idx,
        )

    if strategy == "awesome_cross":
        median = (high + low) / 2.0
        return median.rolling(int(fast)).mean() > median.rolling(int(slow)).mean()

    if strategy == "cmo_trend":
        period = max(1, int(round(fast)))
        delta = close.diff()
        gain = delta.clip(lower=0).fillna(0.0)
        loss = (-delta.clip(upper=0)).fillna(0.0)
        gain_sum = gain.rolling(period).sum()
        loss_sum = loss.rolling(period).sum()
        total = gain_sum + loss_sum
        cmo = 100.0 * (gain_sum - loss_sum) / total.replace(0.0, np.nan)
        return pd.Series(
            _state_machine((cmo > slow).to_numpy(), (cmo < -slow).to_numpy()), index=idx
        )

    if strategy == "stoch_rsi_x":
        period, window = max(1, int(round(fast))), max(1, int(round(slow)))
        delta = close.diff()
        gain = delta.clip(lower=0).ewm(alpha=1 / period, adjust=False).mean()
        loss = (-delta.clip(upper=0)).ewm(alpha=1 / period, adjust=False).mean()
        rsi = 100 - 100 / (1 + gain / loss.replace(0, np.nan))
        hi, lo = rsi.rolling(window).max(), rsi.rolling(window).min()
        k = (rsi - lo) / (hi - lo).replace(0.0, np.nan)
        return pd.Series(_state_machine((k < 0.2).to_numpy(), (k > 0.8).to_numpy()), index=idx)

    if strategy == "dpo_reversion":
        period = max(1, int(round(fast)))
        shift_by = period // 2 + 1
        base = close.rolling(period).mean().shift(shift_by)
        sd = close.rolling(period).std(ddof=0)
        dpo = (close - base) / sd.replace(0.0, np.nan)
        return pd.Series(_state_machine((dpo < -slow).to_numpy(), (dpo > 0).to_numpy()), index=idx)

    if strategy == "bollinger_pctb":
        period = max(1, int(round(fast)))
        mid = close.rolling(period).mean()
        sd = close.rolling(period).std(ddof=0)
        pct_b = (close - (mid - 2 * sd)) / (4 * sd).replace(0.0, np.nan)
        return pd.Series(
            _state_machine((pct_b < slow).to_numpy(), (pct_b > 0.5).to_numpy()), index=idx
        )

    if strategy == "stddev_channel":
        period = max(1, int(round(fast)))
        mid = close.rolling(period).mean()
        sd = close.rolling(period).std(ddof=0)
        return pd.Series(
            _state_machine((close > mid + slow * sd).to_numpy(), (close < mid).to_numpy()), index=idx
        )

    if strategy == "chaikin_volatility":
        smoothed = _ema(high - low, fast)
        past = smoothed.shift(int(round(slow)))
        change = smoothed / past.replace(0.0, np.nan) - 1.0
        trend = close.rolling(50).mean()
        return pd.Series(
            _state_machine(((change > 0) & (close > trend)).to_numpy(), (close < trend).to_numpy()),
            index=idx,
        )

    if strategy == "ulcer_filter":
        period = max(1, int(round(fast)))
        peak = close.rolling(period).max()
        drawdown = 100.0 * (close - peak) / peak.replace(0.0, np.nan)
        ulcer = np.sqrt((drawdown ** 2).rolling(period).mean())
        trend = close.rolling(50).mean()
        return pd.Series(
            _state_machine(
                ((ulcer < slow) & (close > trend)).to_numpy(),
                ((ulcer > slow * 2) | (close < trend)).to_numpy(),
            ),
            index=idx,
        )

    if strategy == "cmf_trend":
        period = max(1, int(round(fast)))
        span = (high - low).replace(0.0, np.nan)
        mfv = (((close - low) - (high - close)) / span * volume).fillna(0.0)
        cmf = mfv.rolling(period).sum() / volume.rolling(period).sum().replace(0.0, np.nan)
        return pd.Series(_state_machine((cmf > slow).to_numpy(), (cmf < 0).to_numpy()), index=idx)

    if strategy == "force_index":
        force = (close.diff() * volume).fillna(0.0)
        smoothed = _ema(force, fast)
        trend = close.rolling(int(slow)).mean()
        return pd.Series(
            _state_machine(
                ((smoothed > 0) & (close > trend)).to_numpy(),
                ((smoothed < 0) | (close < trend)).to_numpy(),
            ),
            index=idx,
        )

    if strategy == "eom_trend":
        mid_move = ((high + low) / 2.0).diff()
        span = (high - low).replace(0.0, np.nan)
        raw = (mid_move / (volume / 1e6 / span)).fillna(0.0)
        raw.iloc[0] = 0.0
        smoothed = raw.rolling(max(1, int(round(fast)))).mean()
        trend = close.rolling(int(slow)).mean()
        return pd.Series(
            _state_machine(
                ((smoothed > 0) & (close > trend)).to_numpy(),
                ((smoothed < 0) | (close < trend)).to_numpy(),
            ),
            index=idx,
        )

    if strategy == "aroon_cross":
        period = max(1, int(round(fast)))
        up = 100.0 * (period - _bars_since_max(high, period)) / period
        down = 100.0 * (period - _bars_since_min(low, period)) / period
        return pd.Series(
            _state_machine(
                ((up > slow) & (up > down)).to_numpy(),
                ((down > slow) & (down > up)).to_numpy(),
            ),
            index=idx,
        )

    # vortex_cross
    period = max(1, int(round(fast)))
    vm_plus = (high - low.shift(1)).abs().fillna(0.0)
    vm_minus = (low - high.shift(1)).abs().fillna(0.0)
    prev_close = close.shift(1)
    true_range = pd.concat(
        [high - low, (high - prev_close).abs(), (low - prev_close).abs()], axis=1
    ).max(axis=1).fillna(0.0)
    vm_plus.iloc[0] = 0.0
    vm_minus.iloc[0] = 0.0
    true_range.iloc[0] = 0.0
    tr_sum = true_range.rolling(period).sum().replace(0.0, np.nan)
    vi_plus = vm_plus.rolling(period).sum() / tr_sum
    vi_minus = vm_minus.rolling(period).sum() / tr_sum
    exit_ma = close.rolling(int(slow)).mean()
    return pd.Series(
        _state_machine(
            (vi_plus > vi_minus).to_numpy(),
            ((vi_plus < vi_minus) | (close < exit_ma)).to_numpy(),
        ),
        index=idx,
    )
