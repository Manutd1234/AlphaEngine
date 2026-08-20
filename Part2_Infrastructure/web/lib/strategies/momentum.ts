/**
 * Momentum rules: hold what has already been moving.
 *
 * The near-opposites of the mean-reversion family, and deliberately in the same
 * catalogue: `rsi_trend` and `rsi_reversion` read one indicator in opposite
 * directions, and which is right is a property of the regime, not of the maths.
 */

import { barsSinceMax, barsSinceMin, rollingSum, rsi, sma } from "../indicators";
import type { RuleSet } from "./types";

export const MOMENTUM_RULES = {
  momentum: ({ close, n }, fast, slow, out) => {
    // 12-1: return to `slow` bars ago, skipping the most recent `fast`, because
    // short-horizon reversal is the documented contaminant of momentum.
    for (let i = 0; i < n; i++) {
      if (i < slow) { out[i] = 0; continue; }
      const past = close[i - slow];
      const recent = close[i - fast];
      out[i] = past > 0 && recent / past - 1 > 0 ? 1 : 0;
    }
    return out;
  },

  roc_trend: ({ close, n }, fast, slow, out) => {
    const trend = sma(close, slow);
    for (let i = 0; i < n; i++) {
      if (i < fast || Number.isNaN(trend[i])) { out[i] = 0; continue; }
      const roc = close[i - fast] > 0 ? close[i] / close[i - fast] - 1 : NaN;
      out[i] = roc > 0 && close[i] > trend[i] ? 1 : 0;
    }
    return out;
  },

  rsi_trend: ({ close, n }, fast, slow, out) => {
    // Momentum reading of RSI — the opposite of rsi_reversion, deliberately
    // both in the catalogue: which is right is a property of the regime.
    const r = rsi(close, fast);
    const trend = sma(close, slow);
    for (let i = 0; i < n; i++) {
      out[i] = !Number.isNaN(r[i]) && r[i] > 55 && !Number.isNaN(trend[i]) && close[i] > trend[i] ? 1 : 0;
    }
    return out;
  },

  awesome_cross: ({ high, low, n }, fast, slow, out) => {
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
  },

  cmo_trend: ({ close, n }, fast, slow, out) => {
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
  },

  aroon_cross: ({ high, low, n }, fast, slow, out) => {
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
  },
} satisfies RuleSet;
