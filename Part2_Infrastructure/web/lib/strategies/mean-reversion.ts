/**
 * Mean-reversion rules: buy the extreme, and let the exit outrank the entry.
 *
 * This is the family where the exit-wins convention is load-bearing rather than
 * tidy. Written as an if/else-if chain the entry wins instead, and `rsi_reversion`
 * goes from 2 trades to 70 — oversold and below-trend nearly always coincide.
 */

import { rollingMax, rollingMin, rollingStd, rsi, sma } from "../indicators";
import type { RuleSet } from "./types";

export const MEAN_REVERSION_RULES = {
  williams_r: ({ close, high, low, n }, fast, slow, out) => {
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
  },

  stochastic: ({ close, high, low, n }, fast, slow, out) => {
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
  },

  zscore_reversion: ({ close, n }, fast, slow, out) => {
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
  },

  cci_reversion: ({ close, high, low, n }, fast, slow, out) => {
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
  },

  stoch_rsi_x: ({ close, n }, fast, slow, out) => {
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
  },

  dpo_reversion: ({ close, n }, fast, slow, out) => {
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
  },

  bollinger_pctb: ({ close, n }, fast, slow, out) => {
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
  },

  rsi_reversion: ({ close, n }, fast, slow, out) => {
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
  },
} satisfies RuleSet;
