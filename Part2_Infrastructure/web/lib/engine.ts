/**
 * Vectorised backtest engine (TypeScript).
 * ========================================
 *
 * A faithful port of `NumpyEngine` in `Part2_Infrastructure/modules/backtester.py`,
 * so a sweep run in the browser-facing Vercel portal and one run by the Python
 * gateway produce the same numbers.
 *
 * Accounting conventions (identical in both implementations):
 *   • signals are formed on bar t and executed on bar t+1 — no look-ahead;
 *   • cost = (fee + slippage) bps charged on the notional turnover of every
 *     position change;
 *   • returns compound on equity, i.e. constant-fraction (100%) sizing.
 */

import { compareToBenchmark } from "./benchmark";
import {
  atr, barsSinceMax, barsSinceMin, dema, ema, hma, pctChange, rollingMax, rollingMin,
  rollingStd, rollingSum, rsi, shift1, sma, tema, zlema,
} from "./indicators";
import { mcSeedFor, monteCarloBands } from "./montecarlo";
import { regimeReport } from "./regimes";
import {
  type CostModel,
  averageDailyVolume,
  buildFactors,
  holdingCost,
  parameterStability,
  promotionGate,
  regress,
  tailReport,
  turnoverCost,
  walkForwardReport,
  FACTOR_LOOKBACK,
} from "./quant";
import {
  deflatedSharpe,
  kurtosis,
  mean,
  minTrackRecordLength,
  skewness,
  stdev,
  verdictFor,
} from "./stats";
import {
  BARS_PER_YEAR,
  Bar,
  type DataSource,
  Direction,
  MAX_COMBOS,
  ParamResult,
  SeriesPoint,
  Strategy,
  SweepRequest,
  SweepResponse,
  WalkForwardFold,
} from "./types";

export const barsPerYear = (interval: string) => BARS_PER_YEAR[interval] ?? 8760;

/**
 * A stable fingerprint of the bars a sweep ran on.
 *
 * Not a cryptographic hash — this runs in a serverless function on every sweep
 * and its only job is to answer "were these the same bars?". FNV-1a over the
 * closes plus the window bounds collides far too rarely to matter for a
 * comparison the researcher can also verify by eye, and costs one pass.
 *
 * Deliberately NOT expected to equal the Python `data_hash`: the two engines
 * fingerprint their own inputs, which arrive over different transports with
 * different float formatting. What each guarantees is internal consistency —
 * two runs *in the same engine* on the same bars agree.
 */
export function datasetFingerprint(bars: Bar[]): string {
  let hash = 0x811c9dc5;
  const mix = (value: number) => {
    hash ^= value >>> 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };
  for (const bar of bars) {
    // Six decimals: enough to separate real revisions, coarse enough that a
    // float round-trip through JSON does not change the answer.
    mix(Math.round(bar.c * 1e6));
  }
  mix(bars.length);
  mix(bars[0]?.t ?? 0);
  mix(bars[bars.length - 1]?.t ?? 0);
  return hash.toString(16).padStart(8, "0");
}

// --------------------------------------------------------------------------- //
// Signals
// --------------------------------------------------------------------------- //
/**
 * The strategy's "should I be long?" state, bar by bar.
 *
 * Mirrors `build_signals` in the Python reference, including two details that
 * are easy to get wrong and that the parity suite pins:
 *
 *  1. **Exit dominates entry.** The reference assigns the entry mask and then
 *     the exit mask, so a bar where both fire ends up flat. Written as an
 *     if/else-if chain the entry wins instead — which turns RSI reversion from
 *     2 trades into 70, because oversold and below-trend nearly always coincide.
 *  2. **NaN comparisons are false.** Before an indicator's lookback is filled it
 *     has no opinion, and "no opinion" is not "exit".
 */
function longState(
  strategy: Strategy,
  close: Float64Array,
  high: Float64Array,
  low: Float64Array,
  volume: Float64Array,
  fast: number,
  slow: number,
): Uint8Array {
  const n = close.length;
  const out = new Uint8Array(n);

  if (strategy === "ma_cross") {
    const f = sma(close, fast);
    const s = sma(close, slow);
    for (let i = 0; i < n; i++) {
      out[i] = !Number.isNaN(f[i]) && !Number.isNaN(s[i]) && f[i] > s[i] ? 1 : 0;
    }
    return out;
  }

  if (strategy === "donchian") {
    const upper = shift1(rollingMax(high, fast));
    const lower = shift1(rollingMin(low, slow));
    let state = 0;
    for (let i = 0; i < n; i++) {
      if (!Number.isNaN(upper[i]) && close[i] > upper[i]) state = 1;
      if (!Number.isNaN(lower[i]) && close[i] < lower[i]) state = 0; // exit overrides
      out[i] = state;
    }
    return out;
  }

  if (strategy === "ema_cross") {
    const f = ema(close, fast);
    const s = ema(close, slow);
    for (let i = 0; i < n; i++) out[i] = f[i] > s[i] ? 1 : 0;
    return out;
  }

  if (strategy === "macd_cross") {
    // Signal fixed at the conventional 9: the request carries two parameters,
    // and a third axis for a value nobody tunes multiplies every sweep by nine.
    const macd = new Float64Array(n);
    const f = ema(close, fast);
    const s = ema(close, slow);
    for (let i = 0; i < n; i++) macd[i] = f[i] - s[i];
    const signal = ema(macd, 9);
    for (let i = 0; i < n; i++) out[i] = macd[i] > signal[i] ? 1 : 0;
    return out;
  }

  if (strategy === "momentum") {
    // 12-1: return to `slow` bars ago, skipping the most recent `fast`, because
    // short-horizon reversal is the documented contaminant of momentum.
    for (let i = 0; i < n; i++) {
      if (i < slow) { out[i] = 0; continue; }
      const past = close[i - slow];
      const recent = close[i - fast];
      out[i] = past > 0 && recent / past - 1 > 0 ? 1 : 0;
    }
    return out;
  }

  if (strategy === "donchian_mid") {
    const upper = shift1(rollingMax(high, fast));
    const lower = shift1(rollingMin(low, fast));
    const exitMa = sma(close, slow);
    let state = 0;
    for (let i = 0; i < n; i++) {
      const mid = (upper[i] + lower[i]) / 2;
      if (!Number.isNaN(mid) && close[i] > mid) state = 1;
      if (!Number.isNaN(exitMa[i]) && close[i] < exitMa[i]) state = 0; // exit overrides
      out[i] = state;
    }
    return out;
  }

  if (strategy === "roc_trend") {
    const trend = sma(close, slow);
    for (let i = 0; i < n; i++) {
      if (i < fast || Number.isNaN(trend[i])) { out[i] = 0; continue; }
      const roc = close[i - fast] > 0 ? close[i] / close[i - fast] - 1 : NaN;
      out[i] = roc > 0 && close[i] > trend[i] ? 1 : 0;
    }
    return out;
  }

  if (strategy === "williams_r") {
    const highN = rollingMax(high, fast);
    const lowN = rollingMin(low, fast);
    const exitMa = sma(close, slow);
    let state = 0;
    for (let i = 0; i < n; i++) {
      const span = highN[i] - lowN[i];
      const wr = span > 0 ? (-100 * (highN[i] - close[i])) / span : NaN;
      if (!Number.isNaN(wr) && wr < -80) state = 1;
      if ((!Number.isNaN(wr) && wr > -20) || (!Number.isNaN(exitMa[i]) && close[i] < exitMa[i])) {
        state = 0; // exit overrides
      }
      out[i] = state;
    }
    return out;
  }

  if (strategy === "stochastic") {
    const highN = rollingMax(high, fast);
    const lowN = rollingMin(low, fast);
    const k = new Float64Array(n).fill(NaN);
    for (let i = 0; i < n; i++) {
      const span = highN[i] - lowN[i];
      if (span > 0) k[i] = (100 * (close[i] - lowN[i])) / span;
    }
    const d = sma(k, Math.max(2, slow));
    let state = 0;
    for (let i = 0; i < n; i++) {
      // Oversold arms the long; %D is the exit confirmation, not an entry gate.
      // `k < 20 && k > d` is the crossing instant and almost never coincides —
      // it took zero trades over 600 bars.
      if (!Number.isNaN(k[i]) && k[i] < 20) state = 1;
      if ((!Number.isNaN(k[i]) && k[i] > 80) || (!Number.isNaN(d[i]) && k[i] < d[i])) state = 0;
      out[i] = state;
    }
    return out;
  }

  if (strategy === "breakout_sma") {
    const upper = shift1(rollingMax(close, fast));
    const trend = sma(close, slow);
    let state = 0;
    for (let i = 0; i < n; i++) {
      if (!Number.isNaN(upper[i]) && !Number.isNaN(trend[i]) && close[i] > upper[i] && close[i] > trend[i]) {
        state = 1;
      }
      if (!Number.isNaN(trend[i]) && close[i] < trend[i]) state = 0; // exit overrides
      out[i] = state;
    }
    return out;
  }

  if (strategy === "triple_ma") {
    // Middle leg derived, not a third parameter: the geometric mean keeps the
    // three periods evenly spaced on a log scale at no extra sweep axis.
    const midPeriod = Math.max(2, Math.round(Math.sqrt(fast * slow)));
    const f = sma(close, fast);
    const m = sma(close, midPeriod);
    const sl = sma(close, slow);
    for (let i = 0; i < n; i++) out[i] = f[i] > m[i] && m[i] > sl[i] ? 1 : 0;
    return out;
  }

  if (strategy === "ppo_cross") {
    const fastEma = ema(close, fast);
    const slowEma = ema(close, slow);
    const ppo = new Float64Array(n).fill(NaN);
    for (let i = 0; i < n; i++) {
      if (slowEma[i] !== 0) ppo[i] = ((fastEma[i] - slowEma[i]) / slowEma[i]) * 100;
    }
    const signal = ema(ppo, 9);
    for (let i = 0; i < n; i++) out[i] = ppo[i] > signal[i] ? 1 : 0;
    return out;
  }

  if (strategy === "trix_cross") {
    const e3 = ema(ema(ema(close, fast), fast), fast);
    const trix = new Float64Array(n).fill(NaN);
    for (let i = 1; i < n; i++) {
      if (e3[i - 1] !== 0) trix[i] = (e3[i] / e3[i - 1] - 1) * 100;
    }
    const sig = sma(trix, Math.max(2, slow));
    for (let i = 0; i < n; i++) out[i] = trix[i] > sig[i] ? 1 : 0;
    return out;
  }

  if (strategy === "rsi_trend") {
    // Momentum reading of RSI — the opposite of rsi_reversion, deliberately
    // both in the catalogue: which is right is a property of the regime.
    const r = rsi(close, fast);
    const trend = sma(close, slow);
    for (let i = 0; i < n; i++) {
      out[i] = !Number.isNaN(r[i]) && r[i] > 55 && !Number.isNaN(trend[i]) && close[i] > trend[i] ? 1 : 0;
    }
    return out;
  }

  if (strategy === "price_channel") {
    const upper = shift1(rollingMax(close, fast));
    const lower = shift1(rollingMin(close, slow));
    let state = 0;
    for (let i = 0; i < n; i++) {
      if (!Number.isNaN(upper[i]) && close[i] >= upper[i]) state = 1;
      if (!Number.isNaN(lower[i]) && close[i] <= lower[i]) state = 0; // exit overrides
      out[i] = state;
    }
    return out;
  }

  if (strategy === "obv_trend") {
    // On-balance volume: cumulative volume signed by direction. It answers
    // whether a price move carried participation, which price alone cannot say.
    const obv = new Float64Array(n);
    let acc = 0;
    for (let i = 1; i < n; i++) {
      acc += Math.sign(close[i] - close[i - 1]) * volume[i];
      obv[i] = acc;
    }
    const obvMa = sma(obv, Math.max(2, fast));
    for (let i = 0; i < n; i++) out[i] = obv[i] > obvMa[i] ? 1 : 0;
    return out;
  }

  if (strategy === "volume_breakout") {
    // A breakout only counts if volume confirms it — breakouts on thin
    // participation are the ones that fail.
    const upper = shift1(rollingMax(close, fast));
    const volMa = sma(volume, Math.max(2, slow));
    const trend = sma(close, fast);
    let state = 0;
    for (let i = 0; i < n; i++) {
      if (!Number.isNaN(upper[i]) && !Number.isNaN(volMa[i]) && close[i] > upper[i] && volume[i] > volMa[i]) {
        state = 1;
      }
      if (!Number.isNaN(trend[i]) && close[i] < trend[i]) state = 0; // exit overrides
      out[i] = state;
    }
    return out;
  }

  if (strategy === "mfi_reversion") {
    // Money-flow index: RSI weighted by dollar volume, so a move on heavy
    // participation counts for more than the same move on none.
    const period = Math.max(2, fast);
    const typical = new Float64Array(n);
    for (let i = 0; i < n; i++) typical[i] = (high[i] + low[i] + close[i]) / 3;
    const pos = new Float64Array(n);
    const neg = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      const flow = typical[i] * volume[i];
      if (typical[i] > typical[i - 1]) pos[i] = flow;
      else if (typical[i] < typical[i - 1]) neg[i] = flow;
    }
    const exitMa = sma(close, slow);
    let state = 0;
    for (let i = 0; i < n; i++) {
      if (i < period) { out[i] = 0; continue; }
      let p = 0;
      let g = 0;
      for (let j = i - period + 1; j <= i; j++) { p += pos[j]; g += neg[j]; }
      const mfi = g > 0 ? 100 - 100 / (1 + p / g) : NaN;
      if (!Number.isNaN(mfi) && mfi < 20) state = 1;
      if ((!Number.isNaN(mfi) && mfi > 80) || (!Number.isNaN(exitMa[i]) && close[i] < exitMa[i])) {
        state = 0; // exit overrides
      }
      out[i] = state;
    }
    return out;
  }

  if (strategy === "atr_breakout") {
    // Volatility-aware: a move only signals if it is large relative to how much
    // this instrument has been moving. A fixed percentage says the same thing
    // about a calm market and a panicking one.
    const a = atr(high, low, close, fast);
    for (let i = 1; i < n; i++) out[i] = close[i] > close[i - 1] + slow * a[i] ? 1 : 0;
    return out;
  }

  if (strategy === "keltner_breakout") {
    const mid = ema(close, Math.max(2, fast));
    const a = atr(high, low, close, fast);
    let state = 0;
    for (let i = 0; i < n; i++) {
      if (!Number.isNaN(mid[i]) && close[i] > mid[i] + slow * a[i]) state = 1;
      if (!Number.isNaN(mid[i]) && close[i] < mid[i]) state = 0; // exit overrides
      out[i] = state;
    }
    return out;
  }

  if (strategy === "supertrend") {
    const a = atr(high, low, close, fast);
    let state = 0;
    for (let i = 1; i < n; i++) {
      const hl2 = (high[i - 1] + low[i - 1]) / 2;
      const upper = hl2 + slow * a[i - 1];
      const lower = hl2 - slow * a[i - 1];
      if (!Number.isNaN(upper) && close[i] > upper) state = 1;
      if (!Number.isNaN(lower) && close[i] < lower) state = 0; // exit overrides
      out[i] = state;
    }
    return out;
  }

  if (strategy === "atr_trailing_stop") {
    // Chandelier exit: the stop IS the model — entry is simply "trend is up".
    const a = atr(high, low, close, fast);
    const trend = sma(close, Math.max(2, fast));
    const peak = rollingMax(close, Math.max(2, fast));
    let state = 0;
    for (let i = 0; i < n; i++) {
      if (!Number.isNaN(trend[i]) && close[i] > trend[i]) state = 1;
      const stop = peak[i] - slow * a[i];
      if (!Number.isNaN(stop) && close[i] < stop) state = 0; // exit overrides
      out[i] = state;
    }
    return out;
  }

  if (strategy === "bollinger_breakout") {
    // `slow` is band width in standard deviations — a real float, swept
    // 1.0..3.0 by 0.25 from its own axis rather than borrowed from a period grid.
    const period = Math.max(2, Math.trunc(fast));
    const mid = sma(close, period);
    const sd = rollingStd(close, period);
    let state = 0;
    for (let i = 0; i < n; i++) {
      if (!Number.isNaN(mid[i]) && !Number.isNaN(sd[i]) && close[i] > mid[i] + sd[i] * slow) state = 1;
      if (!Number.isNaN(mid[i]) && close[i] < mid[i]) state = 0; // exit overrides
      out[i] = state;
    }
    return out;
  }

  if (strategy === "zscore_reversion") {
    const period = Math.max(2, Math.trunc(fast));
    const mean = sma(close, period);
    const sd = rollingStd(close, period);
    let state = 0;
    for (let i = 0; i < n; i++) {
      const z = sd[i] > 0 ? (close[i] - mean[i]) / sd[i] : NaN;
      if (!Number.isNaN(z) && z < -slow) state = 1;
      if (!Number.isNaN(z) && z > 0) state = 0; // exit overrides
      out[i] = state;
    }
    return out;
  }



  // ── Moving-average variants ─────────────────────────────────────────────
  // Each trades lag for overshoot differently. Running them against `ma_cross`
  // on the same symbol is the cheapest way to find out which end of that
  // trade-off the instrument rewards.

  if (strategy === "dema_cross") {
    const f = dema(close, fast);
    const s = dema(close, slow);
    for (let i = 0; i < n; i++) out[i] = f[i] > s[i] ? 1 : 0;
    return out;
  }

  if (strategy === "tema_cross") {
    const f = tema(close, fast);
    const s = tema(close, slow);
    for (let i = 0; i < n; i++) out[i] = f[i] > s[i] ? 1 : 0;
    return out;
  }

  if (strategy === "zlema_cross") {
    const f = zlema(close, fast);
    const s = zlema(close, slow);
    for (let i = 0; i < n; i++) out[i] = f[i] > s[i] ? 1 : 0;
    return out;
  }

  if (strategy === "hull_trend") {
    const h = hma(close, fast);
    for (let i = 0; i < n; i++) {
      out[i] = i >= slow && !Number.isNaN(h[i]) && !Number.isNaN(h[i - slow]) && h[i] > h[i - slow] ? 1 : 0;
    }
    return out;
  }

  if (strategy === "vwap_trend") {
    // Rolling VWAP, not session VWAP: a 24/7 instrument has no session, and a
    // session anchor on crypto is an arbitrary UTC boundary dressed as a level.
    const pv = new Float64Array(n);
    for (let i = 0; i < n; i++) pv[i] = ((high[i] + low[i] + close[i]) / 3) * volume[i];
    const pvSum = rollingSum(pv, fast);
    const vSum = rollingSum(volume, fast);
    const exitMa = sma(close, slow);
    let state = 0;
    for (let i = 0; i < n; i++) {
      const vwap = vSum[i] > 0 ? pvSum[i] / vSum[i] : NaN;
      if (!Number.isNaN(vwap) && close[i] > vwap) state = 1;
      if (!Number.isNaN(exitMa[i]) && close[i] < exitMa[i]) state = 0; // exit overrides
      out[i] = state;
    }
    return out;
  }

  // ── Oscillators ─────────────────────────────────────────────────────────

  if (strategy === "cci_reversion") {
    // Lambert's constant 0.015 scales CCI so roughly 70-80% of readings fall
    // within ±100. It is empirical, not derived, and it is written here rather
    // than folded into the threshold so the threshold keeps its usual units.
    const typical = new Float64Array(n);
    for (let i = 0; i < n; i++) typical[i] = (high[i] + low[i] + close[i]) / 3;
    const meanTp = sma(typical, fast);
    const exitMa = sma(close, 50);
    const period = Math.max(1, Math.round(fast));
    let state = 0;
    for (let i = 0; i < n; i++) {
      let cci = NaN;
      if (i >= period - 1 && !Number.isNaN(meanTp[i])) {
        let deviation = 0;
        for (let j = i - period + 1; j <= i; j++) deviation += Math.abs(typical[j] - meanTp[i]);
        deviation /= period;
        if (deviation > 0) cci = (typical[i] - meanTp[i]) / (0.015 * deviation);
      }
      if (!Number.isNaN(cci) && cci < -slow) state = 1;
      if ((!Number.isNaN(cci) && cci > 0) || (!Number.isNaN(exitMa[i]) && close[i] < exitMa[i])) {
        state = 0; // exit overrides
      }
      out[i] = state;
    }
    return out;
  }

  if (strategy === "awesome_cross") {
    // Median price, not close: the Awesome Oscillator is defined on (H+L)/2,
    // and substituting the close makes a different indicator with the same name.
    const median = new Float64Array(n);
    for (let i = 0; i < n; i++) median[i] = (high[i] + low[i]) / 2;
    const f = sma(median, fast);
    const s = sma(median, slow);
    for (let i = 0; i < n; i++) {
      out[i] = !Number.isNaN(f[i]) && !Number.isNaN(s[i]) && f[i] > s[i] ? 1 : 0;
    }
    return out;
  }

  if (strategy === "cmo_trend") {
    // Chande momentum: (up − down) / (up + down). Unlike RSI it is not smoothed,
    // so it swings the full −100..100 far more often — the thresholds that suit
    // RSI are much too tight here.
    const period = Math.max(1, Math.round(fast));
    const gain = new Float64Array(n);
    const loss = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      const delta = close[i] - close[i - 1];
      if (delta > 0) gain[i] = delta;
      else loss[i] = -delta;
    }
    const gainSum = rollingSum(gain, period);
    const lossSum = rollingSum(loss, period);
    let state = 0;
    for (let i = 0; i < n; i++) {
      const total = gainSum[i] + lossSum[i];
      const cmo = total > 0 ? (100 * (gainSum[i] - lossSum[i])) / total : NaN;
      if (!Number.isNaN(cmo) && cmo > slow) state = 1;
      if (!Number.isNaN(cmo) && cmo < -slow) state = 0; // exit overrides
      out[i] = state;
    }
    return out;
  }

  if (strategy === "stoch_rsi_x") {
    // RSI's own position within its recent range. Two lookbacks that mean
    // different things: `fast` is the RSI period, `slow` the window RSI is
    // ranked inside. It reaches its extremes far more often than RSI does,
    // which is the point and also why it needs the tighter exit below.
    const r = rsi(close, fast);
    const hi = rollingMax(r, slow);
    const lo = rollingMin(r, slow);
    let state = 0;
    for (let i = 0; i < n; i++) {
      const span = hi[i] - lo[i];
      const k = span > 0 ? (r[i] - lo[i]) / span : NaN;
      if (!Number.isNaN(k) && k < 0.2) state = 1;
      if (!Number.isNaN(k) && k > 0.8) state = 0; // exit overrides
      out[i] = state;
    }
    return out;
  }

  if (strategy === "dpo_reversion") {
    // Detrended price: close minus an SMA shifted back by half its period plus
    // one. The shift is what removes the trend rather than lagging it, and it
    // is also why DPO is NOT a real-time indicator in its textbook form — this
    // implementation shifts FORWARD only, so no future bar is read.
    const shiftBy = Math.floor(Math.max(1, Math.round(fast)) / 2) + 1;
    const trend = sma(close, fast);
    const sd = rollingStd(close, fast);
    let state = 0;
    for (let i = 0; i < n; i++) {
      const base = i >= shiftBy ? trend[i - shiftBy] : NaN;
      const dpo = !Number.isNaN(base) && sd[i] > 0 ? (close[i] - base) / sd[i] : NaN;
      if (!Number.isNaN(dpo) && dpo < -slow) state = 1;
      if (!Number.isNaN(dpo) && dpo > 0) state = 0; // exit overrides
      out[i] = state;
    }
    return out;
  }

  // ── Bands and volatility ────────────────────────────────────────────────

  if (strategy === "bollinger_pctb") {
    // %B is where the close sits between the bands: 0 at the lower, 1 at the
    // upper. Bounded like an oscillator, but built from the same bands the
    // breakout strategy trades — so running the two against each other says
    // which side of the band this instrument rewards.
    const mid = sma(close, fast);
    const sd = rollingStd(close, fast);
    let state = 0;
    for (let i = 0; i < n; i++) {
      const width = 4 * sd[i];
      const pctB = width > 0 ? (close[i] - (mid[i] - 2 * sd[i])) / width : NaN;
      if (!Number.isNaN(pctB) && pctB < slow) state = 1;
      if (!Number.isNaN(pctB) && pctB > 0.5) state = 0; // exit overrides
      out[i] = state;
    }
    return out;
  }

  if (strategy === "stddev_channel") {
    const mid = sma(close, fast);
    const sd = rollingStd(close, fast);
    let state = 0;
    for (let i = 0; i < n; i++) {
      const upper = mid[i] + slow * sd[i];
      if (!Number.isNaN(upper) && close[i] > upper) state = 1;
      if (!Number.isNaN(mid[i]) && close[i] < mid[i]) state = 0; // exit overrides
      out[i] = state;
    }
    return out;
  }

  if (strategy === "chaikin_volatility") {
    // Rate of change of the smoothed high-low spread. Rising volatility is
    // traded as a continuation signal here, which is the opposite of the
    // squeeze reading — both are defensible and the backtest is the argument.
    const spread = new Float64Array(n);
    for (let i = 0; i < n; i++) spread[i] = high[i] - low[i];
    const smoothed = ema(spread, fast);
    const trend = sma(close, 50);
    let state = 0;
    for (let i = 0; i < n; i++) {
      const past = i >= Math.round(slow) ? smoothed[i - Math.round(slow)] : NaN;
      const change = past > 0 ? smoothed[i] / past - 1 : NaN;
      if (!Number.isNaN(change) && change > 0 && !Number.isNaN(trend[i]) && close[i] > trend[i]) state = 1;
      if (!Number.isNaN(trend[i]) && close[i] < trend[i]) state = 0; // exit overrides
      out[i] = state;
    }
    return out;
  }

  if (strategy === "ulcer_filter") {
    // The Ulcer Index is the root-mean-square drawdown over the window — it
    // penalises depth AND duration, which a maximum drawdown cannot. Used here
    // as a regime filter: hold the trend only while the recent pain is low.
    const period = Math.max(1, Math.round(fast));
    const peak = rollingMax(close, period);
    const squared = new Float64Array(n).fill(NaN);
    for (let i = 0; i < n; i++) {
      if (!Number.isNaN(peak[i]) && peak[i] > 0) {
        const drawdown = (100 * (close[i] - peak[i])) / peak[i];
        squared[i] = drawdown * drawdown;
      }
    }
    const meanSquared = sma(squared, period);
    const trend = sma(close, 50);
    let state = 0;
    for (let i = 0; i < n; i++) {
      const ulcer = Number.isNaN(meanSquared[i]) ? NaN : Math.sqrt(meanSquared[i]);
      if (!Number.isNaN(ulcer) && ulcer < slow && !Number.isNaN(trend[i]) && close[i] > trend[i]) state = 1;
      if ((!Number.isNaN(ulcer) && ulcer > slow * 2) || (!Number.isNaN(trend[i]) && close[i] < trend[i])) {
        state = 0; // exit overrides
      }
      out[i] = state;
    }
    return out;
  }

  // ── Volume ──────────────────────────────────────────────────────────────

  if (strategy === "cmf_trend") {
    // Chaikin Money Flow: volume weighted by where the close landed inside the
    // bar. A close at the high on heavy volume counts fully positive; a close
    // at the midpoint counts zero however large the volume.
    const mfv = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const span = high[i] - low[i];
      mfv[i] = span > 0 ? (((close[i] - low[i]) - (high[i] - close[i])) / span) * volume[i] : 0;
    }
    const mfvSum = rollingSum(mfv, fast);
    const volSum = rollingSum(volume, fast);
    let state = 0;
    for (let i = 0; i < n; i++) {
      const cmf = volSum[i] > 0 ? mfvSum[i] / volSum[i] : NaN;
      if (!Number.isNaN(cmf) && cmf > slow) state = 1;
      if (!Number.isNaN(cmf) && cmf < 0) state = 0; // exit overrides
      out[i] = state;
    }
    return out;
  }

  if (strategy === "force_index") {
    // Price change multiplied by volume: direction and conviction in one
    // number. Unbounded and scale-dependent, so it is compared against zero
    // rather than a level — a threshold in force units means nothing across
    // instruments.
    const force = new Float64Array(n);
    for (let i = 1; i < n; i++) force[i] = (close[i] - close[i - 1]) * volume[i];
    const smoothed = ema(force, fast);
    const trend = sma(close, slow);
    let state = 0;
    for (let i = 0; i < n; i++) {
      if (smoothed[i] > 0 && !Number.isNaN(trend[i]) && close[i] > trend[i]) state = 1;
      if (smoothed[i] < 0 || (!Number.isNaN(trend[i]) && close[i] < trend[i])) state = 0; // exit overrides
      out[i] = state;
    }
    return out;
  }

  if (strategy === "eom_trend") {
    // Ease of Movement: how far the midpoint moved per unit of volume. High
    // when price travels on little volume, which is the definition of a market
    // nobody is defending.
    const raw = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      const midMove = (high[i] + low[i]) / 2 - (high[i - 1] + low[i - 1]) / 2;
      const span = high[i] - low[i];
      // Scaled by 1e6 for the same reason every published version does: the
      // ratio is otherwise a number with six leading zeros.
      raw[i] = volume[i] > 0 && span > 0 ? (midMove / (volume[i] / 1e6 / span)) : 0;
    }
    const smoothed = sma(raw, fast);
    const trend = sma(close, slow);
    let state = 0;
    for (let i = 0; i < n; i++) {
      if (!Number.isNaN(smoothed[i]) && smoothed[i] > 0 && !Number.isNaN(trend[i]) && close[i] > trend[i]) state = 1;
      if ((!Number.isNaN(smoothed[i]) && smoothed[i] < 0) || (!Number.isNaN(trend[i]) && close[i] < trend[i])) {
        state = 0; // exit overrides
      }
      out[i] = state;
    }
    return out;
  }

  // ── Directional ─────────────────────────────────────────────────────────

  if (strategy === "aroon_cross") {
    // How recently the window's high and low were set, as a percentage. It
    // measures TIME rather than price, which is why it can turn while price is
    // still flat — and why it is the one indicator here that says something
    // about a range that is about to end.
    const period = Math.max(1, Math.round(fast));
    const sinceHigh = barsSinceMax(high, period);
    const sinceLow = barsSinceMin(low, period);
    let state = 0;
    for (let i = 0; i < n; i++) {
      const up = Number.isNaN(sinceHigh[i]) ? NaN : (100 * (period - sinceHigh[i])) / period;
      const down = Number.isNaN(sinceLow[i]) ? NaN : (100 * (period - sinceLow[i])) / period;
      if (!Number.isNaN(up) && up > slow && up > down) state = 1;
      if (!Number.isNaN(down) && down > slow && down > up) state = 0; // exit overrides
      out[i] = state;
    }
    return out;
  }

  if (strategy === "vortex_cross") {
    // Two directed movements — this high against the previous low and vice
    // versa — each normalised by true range. Unlike a crossover of two averages
    // of the same series, the two lines here are built from different data, so
    // their crossing is not an artefact of smoothing.
    const period = Math.max(1, Math.round(fast));
    const vmPlus = new Float64Array(n);
    const vmMinus = new Float64Array(n);
    const trueRange = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      vmPlus[i] = Math.abs(high[i] - low[i - 1]);
      vmMinus[i] = Math.abs(low[i] - high[i - 1]);
      trueRange[i] = Math.max(
        high[i] - low[i],
        Math.abs(high[i] - close[i - 1]),
        Math.abs(low[i] - close[i - 1]),
      );
    }
    const plusSum = rollingSum(vmPlus, period);
    const minusSum = rollingSum(vmMinus, period);
    const trSum = rollingSum(trueRange, period);
    const exitMa = sma(close, slow);
    let state = 0;
    for (let i = 0; i < n; i++) {
      const viPlus = trSum[i] > 0 ? plusSum[i] / trSum[i] : NaN;
      const viMinus = trSum[i] > 0 ? minusSum[i] / trSum[i] : NaN;
      if (!Number.isNaN(viPlus) && !Number.isNaN(viMinus) && viPlus > viMinus) state = 1;
      if ((!Number.isNaN(viPlus) && !Number.isNaN(viMinus) && viPlus < viMinus)
        || (!Number.isNaN(exitMa[i]) && close[i] < exitMa[i])) {
        state = 0; // exit overrides
      }
      out[i] = state;
    }
    return out;
  }

  if (strategy === "linreg_forecast") {
    return linregForecast(close, fast, slow);
  }

  if (strategy === "ema_slope") {
    const e = ema(close, fast);
    for (let i = 0; i < n; i++) {
      out[i] = i >= slow && e[i] - e[i - slow] > 0 ? 1 : 0;
    }
    return out;
  }

  // rsi_reversion — buy oversold; the trend MA is a STOP, not an entry gate.
  const r = rsi(close, fast);
  const trend = sma(close, slow);
  let state = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(r[i]) && r[i] < 30) state = 1;
    if ((!Number.isNaN(r[i]) && r[i] > 55) || (!Number.isNaN(trend[i]) && close[i] < trend[i])) {
      state = 0; // exit overrides
    }
    out[i] = state;
  }
  return out;
}

/**
 * Target position per bar: 1 long, 0 flat, -1 short (long_short only).
 *
 * Driven by crossover *events*, not by the raw comparison: the book starts flat
 * and only takes a side once a signal has actually fired. Reading the comparison
 * directly would open a short the instant the warmup ends in long/short mode —
 * a position nobody asked for, on a signal that never happened.
 *
 * Parameter semantics (always fast < slow):
 *   ma_cross      fast/slow SMA periods
 *   donchian      fast = breakout lookback, slow = trailing-exit lookback
 *   rsi_reversion fast = RSI period, slow = trend-filter SMA period
 */
export function buildPosition(
  strategy: Strategy,
  bars: Bar[],
  close: Float64Array,
  high: Float64Array,
  low: Float64Array,
  volume: Float64Array,
  fast: number,
  slow: number,
  direction: Direction,
): Float64Array {
  const n = close.length;
  const pos = new Float64Array(n);
  const flat = direction === "long_short" ? -1 : 0;
  const isLong = longState(strategy, close, high, low, volume, fast, slow);

  let state = 0;
  let prevLong = 0;
  for (let i = 0; i < n; i++) {
    if (isLong[i] && !prevLong) state = 1;
    else if (!isLong[i] && prevLong) state = flat;
    pos[i] = state;
    prevLong = isLong[i];
  }
  return pos;
}

// --------------------------------------------------------------------------- //
// Metrics
// --------------------------------------------------------------------------- //
export function maxDrawdown(equity: Float64Array): number {
  let peak = -Infinity;
  let worst = 0;
  for (let i = 0; i < equity.length; i++) {
    if (equity[i] > peak) peak = equity[i];
    const dd = equity[i] / peak - 1;
    if (dd < worst) worst = dd;
  }
  return worst;
}

export function annualisedSharpe(returns: Float64Array, ann: number): number {
  const sd = stdev(returns, 1);
  return sd > 0 ? (mean(returns) / sd) * Math.sqrt(ann) : 0;
}

function sortino(returns: Float64Array, ann: number): number {
  const downside: number[] = [];
  for (let i = 0; i < returns.length; i++) if (returns[i] < 0) downside.push(returns[i]);
  const dd = downside.length > 1 ? stdev(downside, 1) : 0;
  return dd > 0 ? (mean(returns) / dd) * Math.sqrt(ann) : 0;
}

export interface ComboRun {
  result: ParamResult;
  equity: Float64Array;
  returns: Float64Array;
  position: Float64Array;
  /** Holding costs (funding + borrow) charged over the run, in fractional terms. */
  holdingDrag: number;
}

/**
 * The fields `runCombo` reads from a request.
 *
 * The friction group is `Partial` on purpose. The parity suite constructs this
 * object literally with the original five fields, and `turnoverCost` /
 * `holdingCost` both collapse to the flat model when the frictions are absent —
 * so an unconfigured run is not merely *close* to the Python reference, it
 * evaluates the identical expression.
 */
export type ComboRequest =
  Pick<SweepRequest, "strategy" | "direction" | "feeBps" | "slippageBps" | "interval">
  & Partial<Pick<SweepRequest, "impactCoefficient" | "orderNotional" | "fundingBpsPer8h" | "borrowBpsAnnual">>;

export function costModelFor(req: ComboRequest): CostModel {
  return {
    feeBps: req.feeBps,
    slippageBps: req.slippageBps,
    impactCoefficient: req.impactCoefficient ?? 0,
    orderNotional: req.orderNotional ?? 0,
    fundingBpsPer8h: req.fundingBpsPer8h ?? 0,
    borrowBpsAnnual: req.borrowBpsAnnual ?? 0,
  };
}

export function runCombo(
  bars: Bar[],
  close: Float64Array,
  high: Float64Array,
  low: Float64Array,
  volume: Float64Array,
  pxRet: Float64Array,
  req: ComboRequest,
  fast: number,
  slow: number,
  /** Average daily quote volume, for the square-root impact model. */
  adv = 0,
): ComboRun {
  const n = close.length;
  const model = costModelFor(req);
  const cost = turnoverCost(model, adv);
  // Skipped entirely when both rates are zero, so the hot loop is byte-identical
  // to the pre-friction version on a default request.
  const chargesHolding = model.fundingBpsPer8h !== 0 || model.borrowBpsAnnual !== 0;
  const ann = barsPerYear(req.interval);

  const pos = buildPosition(req.strategy, bars, close, high, low, volume, fast, slow, req.direction);

  const returns = new Float64Array(n);
  const equity = new Float64Array(n);
  let eq = 1;
  let prevLagged = 0;
  let turnoverTotal = 0;
  let feesUsd = 0;
  let trades = 0;
  let wins = 0;
  let tradeEntryEquity = 1;
  let inTrade = false;
  let holdingDrag = 0;

  // Win *rate* alone cannot size a position: 40% winners paying 3:1 and 40%
  // winners paying 0.5:1 are the same number and opposite decisions. Kelly needs
  // the payoff ratio, and the payoff ratio cannot be recovered from the
  // aggregates afterwards — two unknowns, one equation — so the magnitudes are
  // accumulated here, where each trade's P&L is actually known.
  let winReturn = 0;
  let lossReturn = 0;

  for (let i = 0; i < n; i++) {
    const lagged = i > 0 ? pos[i - 1] : 0; // execute next bar
    const turnover = Math.abs(lagged - prevLagged);

    if (turnover > 0) {
      turnoverTotal += turnover;
      feesUsd += turnover * cost * eq * 100_000;
      if (inTrade) {
        trades += 1;
        const pnl = eq / tradeEntryEquity - 1;
        if (eq > tradeEntryEquity) {
          wins += 1;
          winReturn += pnl;
        } else {
          lossReturn -= pnl; // carried as a positive magnitude
        }
        inTrade = false;
      }
      if (lagged !== 0) {
        inTrade = true;
        tradeEntryEquity = eq;
      }
    }

    // Charged on the position actually held this bar, not on the signal —
    // funding accrues to whoever is carrying the exposure, and the exposure is
    // the lagged position for exactly the reason the returns use it.
    const holding = chargesHolding ? holdingCost(model, lagged, req.interval) : 0;
    holdingDrag += holding;
    if (holding > 0) feesUsd += holding * eq * 100_000;

    const r = lagged * pxRet[i] - turnover * cost - holding;
    returns[i] = r;
    eq *= 1 + r;
    equity[i] = eq;
    prevLagged = lagged;
  }
  if (inTrade) {
    trades += 1;
    const pnl = eq / tradeEntryEquity - 1;
    if (eq > tradeEntryEquity) {
      wins += 1;
      winReturn += pnl;
    } else {
      lossReturn -= pnl;
    }
  }

  const totalReturn = equity[n - 1] - 1;
  const years = n / ann;
  const cagr =
    years > 0 && totalReturn > -1 ? Math.pow(1 + totalReturn, 1 / years) - 1 : 0;
  const mdd = maxDrawdown(equity);

  // Exposure is measured on the *lagged* (executed) position, not the signal —
  // the bar a signal appears on is not a bar you were in the market.
  let barsInPosition = 0;
  for (let i = 1; i < n; i++) if (pos[i - 1] !== 0) barsInPosition++;

  return {
    result: {
      fast,
      slow,
      totalReturn,
      cagr,
      sharpe: annualisedSharpe(returns, ann),
      sortino: sortino(returns, ann),
      maxDrawdown: mdd,
      calmar: mdd < 0 ? cagr / Math.abs(mdd) : 0,
      winRate: trades ? wins / trades : 0,
      trades,
      avgWin: wins ? winReturn / wins : 0,
      avgLoss: trades - wins ? lossReturn / (trades - wins) : 0,
      exposure: barsInPosition / n,
      turnover: turnoverTotal,
      feesPaid: feesUsd,
    },
    equity,
    returns,
    position: pos,
    holdingDrag,
  };
}


// --------------------------------------------------------------------------- //
// Fitted strategy: ordinary least squares on features the bar already knows
// --------------------------------------------------------------------------- //
/**
 * The one strategy in this catalogue whose parameters are not chosen by the
 * user.
 *
 * Every other model here is parametric: a lookback and a threshold, applied
 * unchanged to every bar. This one estimates its coefficients from the data,
 * which makes it different IN KIND rather than one more row in the same table —
 * and the difference is exactly where a reader is most likely to be misled, so
 * `fast` and `slow` still control the fit (window length, entry threshold)
 * while the coefficients themselves are never exposed as sliders.
 *
 * NO LOOK-AHEAD, AND THE PROOF IS IN THE INDEX ARITHMETIC
 *
 * The target for row j is the return from bar j to bar j+1, so a row is only
 * usable once bar j+1 has closed. The refit at bar i uses rows j <= i-1, whose
 * targets need closes up to bar i — all of which have happened. The prediction
 * at bar i then uses features from bar i, and the engine executes it at i+1
 * like every other signal. `tests/engine-linreg.test.ts` pins this by feeding a
 * series whose future is unknowable and asserting the fit cannot see it.
 *
 * WHY THE REFIT IS PERIODIC AND NOT PER-BAR
 *
 * A coefficient set that changes every bar is fitting the last observation.
 * Refitting every 20 bars keeps the estimate responsive to a regime change
 * within roughly a month of daily data while leaving each fit something to
 * average over. The cadence is fixed rather than swept because a third axis for
 * it would multiply every grid without telling anyone anything they could act
 * on — the same reasoning that fixes MACD's signal span at 9.
 */
const LINREG_REFIT_EVERY = 20;
/** Intercept + three features. Named so the degrees-of-freedom maths is legible. */
const LINREG_COLS = 4;
/** Below this many usable rows the fit is memorising, not estimating. */
const LINREG_MIN_ROWS = 30;
/** First bar at which all three features have a value. */
const LINREG_WARMUP = 20;

/**
 * Solve a small symmetric system by Gaussian elimination with partial pivoting.
 *
 * Written out rather than delegated because `modules/backtester.py` runs the
 * identical loop in the identical order. A library solve on either side — numpy
 * on one, a hand-rolled inverse on the other — would agree to about eight
 * digits, and eight digits is enough for the two engines to disagree about
 * whether a prediction cleared its threshold, which is a different trade count
 * and a failed parity test that looks like a modelling bug.
 *
 * Returns null on a singular system, which is the honest answer for a
 * degenerate feature set and leaves the strategy flat rather than trading on a
 * fabricated coefficient.
 */
function solveSmall(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (!(Math.abs(a[pivot][col]) > 1e-12)) return null;
    if (pivot !== col) {
      const swap = a[pivot]; a[pivot] = a[col]; a[col] = swap;
      const tmp = b[pivot]; b[pivot] = b[col]; b[col] = tmp;
    }
    for (let row = col + 1; row < n; row++) {
      const factor = a[row][col] / a[col][col];
      if (factor === 0) continue;
      for (let k = col; k < n; k++) a[row][k] -= factor * a[col][k];
      b[row] -= factor * b[col];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = b[row];
    for (let k = row + 1; k < n; k++) sum -= a[row][k] * x[k];
    x[row] = sum / a[row][row];
  }
  return x.every((v) => Number.isFinite(v)) ? x : null;
}

function linregForecast(close: Float64Array, window: number, thresholdSd: number): Uint8Array {
  const n = close.length;
  const out = new Uint8Array(n);
  const trainRows = Math.max(LINREG_MIN_ROWS, Math.round(window));

  // Features, all known at the bar they are indexed by.
  const feat: Float64Array[] = [
    new Float64Array(n), new Float64Array(n), new Float64Array(n), new Float64Array(n),
  ];
  const mean20 = sma(close, LINREG_WARMUP);
  for (let i = 0; i < n; i++) {
    feat[0][i] = 1;
    feat[1][i] = i >= 1 && close[i - 1] !== 0 ? close[i] / close[i - 1] - 1 : NaN;
    feat[2][i] = i >= 5 && close[i - 5] !== 0 ? close[i] / close[i - 5] - 1 : NaN;
    feat[3][i] = mean20[i] > 0 ? (close[i] - mean20[i]) / mean20[i] : NaN;
  }
  const target = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    target[i] = i + 1 < n && close[i] !== 0 ? close[i + 1] / close[i] - 1 : NaN;
  }

  const usable = (j: number) =>
    Number.isFinite(feat[1][j]) && Number.isFinite(feat[2][j])
    && Number.isFinite(feat[3][j]) && Number.isFinite(target[j]);

  let coef: number[] | null = null;
  let residSd = 0;
  let state = 0;

  for (let i = 0; i < n; i++) {
    const sinceWarmup = i - LINREG_WARMUP;
    if (sinceWarmup >= 0 && sinceWarmup % LINREG_REFIT_EVERY === 0) {
      // Rows j <= i-1 only: row j's target needs close[j+1], which is close[i]
      // at the newest usable row. Nothing here has not already happened.
      const first = Math.max(0, i - trainRows);
      const xtx: number[][] = [];
      for (let r = 0; r < LINREG_COLS; r++) xtx.push(new Array<number>(LINREG_COLS).fill(0));
      const xty = new Array<number>(LINREG_COLS).fill(0);
      let yy = 0;
      let rows = 0;
      // Ascending order, accumulated one row at a time. The Python reference
      // walks the same indices in the same direction so the float sums match.
      for (let j = first; j <= i - 1; j++) {
        if (!usable(j)) continue;
        rows++;
        const y = target[j];
        yy += y * y;
        for (let r = 0; r < LINREG_COLS; r++) {
          const fr = feat[r][j];
          xty[r] += fr * y;
          for (let c = r; c < LINREG_COLS; c++) xtx[r][c] += fr * feat[c][j];
        }
      }
      if (rows >= LINREG_MIN_ROWS) {
        for (let r = 0; r < LINREG_COLS; r++) for (let c = 0; c < r; c++) xtx[r][c] = xtx[c][r];
        const solved = solveSmall(xtx.map((row) => row.slice()), xty.slice());
        if (solved) {
          let explained = 0;
          for (let r = 0; r < LINREG_COLS; r++) explained += solved[r] * xty[r];
          const dof = Math.max(1, rows - LINREG_COLS);
          coef = solved;
          residSd = Math.sqrt(Math.max(0, yy - explained) / dof);
        }
      }
    }

    if (coef && Number.isFinite(feat[1][i]) && Number.isFinite(feat[2][i]) && Number.isFinite(feat[3][i])) {
      let pred = 0;
      for (let r = 0; r < LINREG_COLS; r++) pred += coef[r] * feat[r][i];
      if (pred > thresholdSd * residSd) state = 1;
      if (pred < 0) state = 0; // exit overrides, as everywhere else in this file
    }
    out[i] = state;
  }
  return out;
}

// --------------------------------------------------------------------------- //
// Grid
// --------------------------------------------------------------------------- //
/**
 * Strategies whose SECOND parameter is not a lookback period.
 *
 * Must match `FREE_SECOND_AXIS` in `modules/backtester.py` — the two engines
 * are compared combination by combination, so a grid that differs is not a
 * disagreement about the model, it is the two of them answering about
 * different parameters entirely.
 *
 * The `f < s` filter is right when both axes are periods and nonsense
 * otherwise: a band width of 2.0σ against a 20-bar mean fails `20 < 2.0`, so
 * every combination was discarded and the strategy silently took no trades.
 */
const FREE_SECOND_AXIS: Partial<Record<Strategy, [number, number, number]>> = {
  bollinger_breakout: [1.0, 3.0, 0.25],
  zscore_reversion: [1.0, 3.0, 0.25],
  atr_breakout: [0.5, 3.0, 0.25],
  keltner_breakout: [0.5, 3.0, 0.25],
  supertrend: [1.0, 4.0, 0.5],
  atr_trailing_stop: [1.0, 4.0, 0.5],
  // Entry threshold as a multiple of the fit's OWN residual standard error.
  // 0 means "any positive forecast"; 1.0 means the forecast must beat the noise
  // the fit could not explain. Stepped at 0.2 rather than 0.1 because this
  // strategy refits a regression 100 times per pass and costs ~15 ms per
  // combination against ~0.4 ms for the parametric ones — a 77-combination grid
  // would take a second where every other sweep takes forty milliseconds.
  linreg_forecast: [0.0, 1.0, 0.2],

  // Added with the second strategy batch. Each of these reads its second
  // parameter as a LEVEL rather than a lookback — an oscillator threshold, a
  // sigma multiple, a %B position, an ulcer index. Sweeping them over the
  // request's 20..200 period axis would ask for a 200-sigma band or a %B of
  // 200, and every combination would be discarded in silence.
  cci_reversion: [50, 200, 25],
  cmo_trend: [20, 60, 10],
  dpo_reversion: [0.5, 2.5, 0.25],
  bollinger_pctb: [0.0, 0.4, 0.05],
  stddev_channel: [1.0, 3.0, 0.25],
  ulcer_filter: [2.0, 12.0, 2.0],
  cmf_trend: [0.0, 0.2, 0.025],
  aroon_cross: [50, 90, 10],
};

/**
 * Strategies whose FIRST axis is not the request's period sweep either.
 *
 * The symmetric partner of `FREE_SECOND_AXIS`, and it exists for the same
 * reason: the UI's default fast sweep is 5-40 bars, which is a sensible
 * moving-average period and an unusable training window for a four-parameter
 * regression. Sweeping it there would fit four coefficients to five
 * observations and report the result as a strategy.
 *
 * Must match `FREE_FIRST_AXIS` in `modules/backtester.py`.
 */
const FREE_FIRST_AXIS: Partial<Record<Strategy, [number, number, number]>> = {
  linreg_forecast: [60, 240, 30],
};

/** Inclusive, float-safe: index multiplication rather than repeated addition,
 *  which at step 0.25 drifts to 2.7499999999999996 and shows the reader a
 *  different number than the slider they moved. */
function axis(low: number, high: number, step: number): number[] {
  if (step <= 0) return [low];
  const count = Math.floor((high - low) / step + 1e-9) + 1;
  return Array.from({ length: Math.max(1, count) }, (_, i) => Number((low + i * step).toFixed(10)));
}

export function paramGrid(req: SweepRequest): Array<[number, number]> {
  const combos: Array<[number, number]> = [];
  const free = FREE_SECOND_AXIS[req.strategy];
  const freeFast = FREE_FIRST_AXIS[req.strategy];
  const fasts = freeFast
    ? axis(freeFast[0], freeFast[1], freeFast[2])
    : axis(req.fastMin, req.fastMax, req.fastStep);
  const slows = free ? axis(free[0], free[1], free[2]) : axis(req.slowMin, req.slowMax, req.slowStep);
  for (const f of fasts) {
    for (const s of slows) {
      if (free || freeFast || f < s) combos.push([f, s]);
    }
  }
  if (combos.length > MAX_COMBOS) {
    const step = Math.ceil(combos.length / MAX_COMBOS);
    return combos.filter((_, i) => i % step === 0);
  }
  return combos;
}

function columns(bars: Bar[]) {
  const n = bars.length;
  const close = new Float64Array(n);
  const high = new Float64Array(n);
  const low = new Float64Array(n);
  // Volume was carried on the Bar and dropped here. The volume-confirmation
  // family needs it, and a strategy silently reading zeros would look like a
  // model that never confirms rather than one that was never given the data.
  const volume = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    close[i] = bars[i].c;
    high[i] = bars[i].h;
    low[i] = bars[i].l;
    volume[i] = bars[i].v;
  }
  return { close, high, low, volume, pxRet: pctChange(close) };
}

// --------------------------------------------------------------------------- //
// Walk-forward
// --------------------------------------------------------------------------- //
function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}

export function walkForward(
  bars: Bar[],
  combos: Array<[number, number]>,
  req: SweepRequest,
  adv = 0,
): { folds: WalkForwardFold[]; oosSharpe: number | null } {
  const folds = Math.max(2, Math.min(req.folds, 10));
  const seg = Math.floor(bars.length / (folds + 1));
  if (seg < 100) return { folds: [], oosSharpe: null };

  const out: WalkForwardFold[] = [];
  const oosReturns: number[] = [];
  // Taken out of the training window's tail rather than by shifting the test
  // window: shifting would walk the last fold off the end of the data and
  // quietly drop it. Mirrors `walk_forward` in the Python reference.
  const embargo = Math.max(0, Math.min(Math.trunc(req.embargoBars ?? 0), Math.max(0, seg - 50)));

  for (let i = 0; i < folds; i++) {
    const train = bars.slice(i * seg, (i + 1) * seg - embargo);
    const test = bars.slice((i + 1) * seg, (i + 2) * seg);
    if (test.length < 50 || train.length < 50) break;

    const tr = columns(train);
    let bestIs = combos[0];
    let bestSharpe = -Infinity;
    for (const [f, s] of combos) {
      const { result } = runCombo(train, tr.close, tr.high, tr.low, tr.volume, tr.pxRet, req, f, s, adv);
      if (result.sharpe > bestSharpe) {
        bestSharpe = result.sharpe;
        bestIs = [f, s];
      }
    }

    // Score the whole grid out-of-sample, not just the winner: one OOS Sharpe
    // cannot separate "this choice was right" from "this fold was easy for
    // everything". The winner's rank among its peers can.
    const te = columns(test);
    const oos = runCombo(test, te.close, te.high, te.low, te.volume, te.pxRet, req, bestIs[0], bestIs[1], adv);
    for (let k = 0; k < oos.returns.length; k++) oosReturns.push(oos.returns[k]);

    const oosSharpes = combos.map(([f, s2]) => ({
      combo: [f, s2] as [number, number],
      sharpe: runCombo(test, te.close, te.high, te.low, te.volume, te.pxRet, req, f, s2, adv).result.sharpe,
    }));
    oosSharpes.sort((a, b) => b.sharpe - a.sharpe);
    const rankIndex = oosSharpes.findIndex((e) => e.combo[0] === bestIs[0] && e.combo[1] === bestIs[1]);

    out.push({
      fold: i + 1,
      trainStart: isoDay(train[0].t),
      trainEnd: isoDay(train[train.length - 1].t),
      testStart: isoDay(test[0].t),
      testEnd: isoDay(test[test.length - 1].t),
      chosenFast: bestIs[0],
      chosenSlow: bestIs[1],
      isSharpe: bestSharpe,
      oosSharpe: oos.result.sharpe,
      oosReturn: oos.result.totalReturn,
      oosRank: rankIndex >= 0 ? rankIndex + 1 : undefined,
      combosRanked: oosSharpes.length,
      embargoBars: embargo,
    });
  }

  const agg = oosReturns.length
    ? annualisedSharpe(Float64Array.from(oosReturns), barsPerYear(req.interval))
    : null;
  return { folds: out, oosSharpe: agg };
}

// --------------------------------------------------------------------------- //
// Orchestration
// --------------------------------------------------------------------------- //
export function runSweep(
  bars: Bar[],
  req: SweepRequest,
  dataSource: DataSource,
  warnings: string[] = [],
  /**
   * The external benchmark's bars, already loaded by the caller.
   *
   * Passed in rather than fetched here so the engine stays pure and the parity
   * fixture keeps calling it with three arguments. Absent means "not
   * requested", which the response distinguishes from "requested and could not
   * be aligned".
   */
  benchmarkBars: Bar[] | null = null,
): SweepResponse {
  const t0 = Date.now();
  const combos = paramGrid(req);
  if (!combos.length) throw new Error("Empty parameter grid — fast must be less than slow.");
  if (bars.length < 200) throw new Error(`Not enough data: ${bars.length} bars.`);

  const { close, high, low, volume, pxRet } = columns(bars);
  const ann = barsPerYear(req.interval);

  // Sized once on the whole series and reused for every combination and every
  // walk-forward slice. Recomputing it per slice would make an order's modelled
  // impact depend on which fold it landed in, so two identical trades would be
  // charged differently for a reason that has nothing to do with the trade.
  const adv = averageDailyVolume(bars, req.interval);

  const runs: ComboRun[] = combos.map(([f, s]) =>
    runCombo(bars, close, high, low, volume, pxRet, req, f, s, adv),
  );
  const results = runs.map((r) => r.result);

  let bestIdx = 0;
  for (let i = 1; i < results.length; i++) {
    if (results[i].sharpe > results[bestIdx].sharpe) bestIdx = i;
  }
  const best = results[bestIdx];
  const bestRun = runs[bestIdx];

  // --- multiple-testing correction ------------------------------------- //
  const perBarSd = stdev(bestRun.returns, 1);
  const srPerBar = perBarSd > 0 ? mean(bestRun.returns) / perBarSd : 0;
  const candidates = results.map((r) => r.sharpe / Math.sqrt(ann));
  const retSkew = skewness(bestRun.returns);
  const retKurt = kurtosis(bestRun.returns);
  const { dsr, psr, expectedMax } = deflatedSharpe(
    candidates,
    srPerBar,
    bestRun.returns.length,
    retSkew,
    retKurt,
  );

  // MinTRL benchmarks against the PER-BAR expectedMax; the response's
  // `expectedMaxSharpe` is the re-annualised one — do not mix them up.
  const minTrlEntry = (benchmark: number) => {
    const nStar = minTrackRecordLength(srPerBar, benchmark, retSkew, retKurt);
    if (!Number.isFinite(nStar)) return { bars: null, years: null, sufficient: null };
    const needed = Math.ceil(nStar);
    return { bars: needed, years: needed / ann, sufficient: bars.length >= needed };
  };
  const minTrackRecord = {
    confidence: 0.95,
    vsZero: minTrlEntry(0),
    vsSearchHurdle: minTrlEntry(expectedMax),
  };

  // --- walk-forward ------------------------------------------------------ //
  let wf: WalkForwardFold[] = [];
  let wfOos: number | null = null;
  if (req.walkForward) {
    try {
      const res = walkForward(bars, combos, req, adv);
      wf = res.folds;
      wfOos = res.oosSharpe;
      if (!wf.length) warnings.push("Walk-forward skipped: not enough bars for the requested folds.");
    } catch (err) {
      warnings.push(`Walk-forward failed: ${(err as Error).message}`);
    }
  }

  // --- benchmark --------------------------------------------------------- //
  const bhEquity = new Float64Array(bars.length);
  let bh = 1;
  for (let i = 0; i < bars.length; i++) {
    bh *= 1 + pxRet[i];
    bhEquity[i] = bh;
  }

  // --- series for the charts (thinned for payload size) ------------------ //
  // The overlay must be the lines the model ACTUALLY trades on. Plotting two
  // SMAs for every strategy makes the chart contradict the position shading:
  // a Donchian run showed 19 line-crossings against 6 real position changes.
  // RSI is deliberately not plotted as `fast` — it lives on a 0-100 scale and
  // PriceChart derives its y-domain from extent([close, fast, slow]), so a raw
  // RSI would flatten the price axis into a hairline.
  let fastMa: Float64Array;
  let slowMa: Float64Array;
  switch (req.strategy) {
    case "donchian":
      fastMa = shift1(rollingMax(high, best.fast)); // breakout trigger
      slowMa = shift1(rollingMin(low, best.slow)); // trailing exit
      break;
    case "rsi_reversion":
      fastMa = new Float64Array(bars.length).fill(NaN); // RSI is off-scale; omit
      slowMa = sma(close, best.slow); // the trend filter it really uses
      break;
    default:
      fastMa = sma(close, best.fast);
      slowMa = sma(close, best.slow);
  }
  const step = Math.max(1, Math.ceil(bars.length / 700));
  const series: SeriesPoint[] = [];
  const sampleIdx: number[] = [];
  let peak = -Infinity;
  const ddArr = new Float64Array(bars.length);
  for (let i = 0; i < bars.length; i++) {
    if (bestRun.equity[i] > peak) peak = bestRun.equity[i];
    ddArr[i] = bestRun.equity[i] / peak - 1;
  }
  for (let i = 0; i < bars.length; i += step) {
    sampleIdx.push(i);
    series.push({
      t: bars[i].t,
      close: close[i],
      fast: Number.isNaN(fastMa[i]) ? null : fastMa[i],
      slow: Number.isNaN(slowMa[i]) ? null : slowMa[i],
      position: bestRun.position[i],
      equity: bestRun.equity[i],
      buyHold: bhEquity[i],
      drawdown: ddArr[i],
    });
  }

  const sorted = [...results].sort((a, b) => b.sharpe - a.sharpe);

  // --- research analytics ------------------------------------------------ //
  // All derived from what the sweep already computed. Nothing above this line
  // changed, which is what keeps the parity fixture meaningful.
  const dataHash = datasetFingerprint(bars);

  const mcSeed = mcSeedFor(dataHash, best.fast, best.slow);
  const monteCarlo = monteCarloBands(bestRun.returns, sampleIdx, mcSeed);

  const regimes = regimeReport(bars, close, bestRun.returns, bestRun.position, req.interval);

  const stability = parameterStability(results);
  const wfReport = walkForwardReport(
    wf,
    combos.map(([f]) => f),
    combos.map(([, s]) => s),
  );

  const factorSet = buildFactors(pxRet);
  const regression = regress(
    bestRun.returns,
    factorSet.names.map((name, i) => ({ name, values: factorSet.values[i] })),
    ann,
  );
  const factors = regression
    ? {
        regression,
        descriptions: factorSet.descriptions,
        lookback: FACTOR_LOOKBACK,
        note:
          "Time-series factors built from this instrument's own bars — not Fama-French and not "
          + "cross-sectional, which one symbol cannot produce. t-statistics are plain OLS; a "
          + "Newey-West correction would widen them, so the significance shown here is generous.",
      }
    : null;

  const tail = tailReport(
    bestRun.returns,
    bestRun.equity,
    bars,
    req.interval,
    best.turnover,
  );

  const model = costModelFor(req);
  const participation = model.orderNotional > 0 && adv > 0
    ? Math.min(1, model.orderNotional / adv)
    : 0;
  const flatBps = req.feeBps + req.slippageBps;
  const costs = {
    flatBps,
    averageDailyVolume: adv,
    impactBps: (turnoverCost(model, adv) * 1e4) - flatBps,
    participation,
    fundingBpsPer8h: model.fundingBpsPer8h,
    borrowBpsAnnual: model.borrowBpsAnnual,
    flatOnly:
      model.impactCoefficient === 0
      && model.fundingBpsPer8h === 0
      && model.borrowBpsAnnual === 0,
  };

  const promotion = promotionGate({
    deflatedSharpe: dsr,
    walkForwardOosSharpe: wfOos,
    medianEfficiency: wfReport.medianEfficiency,
    stability: stability.best?.kind ?? null,
    alphaTStat: regression?.alphaTStat ?? null,
    maxDrawdown: best.maxDrawdown,
    trades: best.trades,
  });

  return {
    request: req,
    dataSource,
    bars: bars.length,
    periodStart: isoDay(bars[0].t),
    periodEnd: isoDay(bars[bars.length - 1].t),
    dataHash,
    combosTested: results.length,
    durationMs: Date.now() - t0,
    best,
    benchmark: {
      totalReturn: bhEquity[bars.length - 1] - 1,
      sharpe: annualisedSharpe(pxRet, ann),
      maxDrawdown: maxDrawdown(bhEquity),
    },
    benchmarkComparison: benchmarkBars && req.benchmarkSymbol
      ? compareToBenchmark(series, benchmarkBars, req.interval, req.benchmarkSymbol)
      : null,
    results,
    topResults: sorted.slice(0, 15),
    deflatedSharpeRatio: dsr,
    probabilisticSharpeRatio: psr,
    expectedMaxSharpe: expectedMax * Math.sqrt(ann),
    verdict: verdictFor(dsr, wfOos),
    walkForward: wf,
    walkForwardOosSharpe: wfOos,
    series,
    warnings,
    stability,
    walkForwardReport: wfReport,
    factors,
    tail,
    promotion,
    costs,
    minTrackRecord,
    monteCarlo,
    bestRunReturns: Array.from(bestRun.returns),
    regimes,
  };
}
