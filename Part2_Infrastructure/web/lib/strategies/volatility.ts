/**
 * Volatility rules: hold the trend only while the weather allows it.
 *
 * Two rules, and both read volatility as a regime FILTER rather than as a
 * signal — the trend decides the direction, the filter decides whether to be in
 * at all. They disagree about which way to read it, which is the point: each
 * one's comment says what it assumes, and the sweep is what settles it.
 */

import { ema, rollingMax, sma } from "../indicators";
import type { RuleSet } from "./types";

export const VOLATILITY_RULES = {
  chaikin_volatility: ({ close, high, low, n }, fast, slow, out) => {
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
  },

  ulcer_filter: ({ close, n }, fast, slow, out) => {
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
  },
} satisfies RuleSet;
