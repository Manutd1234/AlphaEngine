/**
 * Breakout rules: enter when a level is taken out, leave when the level that
 * would have proved it wrong is taken out instead.
 *
 * Every one of these carries `state` across bars, so the order of the two `if`s
 * is the whole model: the entry is assigned first and the exit second, which is
 * what makes a bar where both fire end flat. See `./types` for why.
 */

import { atr, ema, rollingMax, rollingMin, rollingStd, shift1, sma } from "../indicators";
import type { RuleSet } from "./types";

export const BREAKOUT_RULES = {
  donchian: ({ close, high, low, n }, fast, slow, out) => {
    const upper = shift1(rollingMax(high, fast));
    const lower = shift1(rollingMin(low, slow));
    let state = 0;
    for (let i = 0; i < n; i++) {
      if (!Number.isNaN(upper[i]) && close[i] > upper[i]) state = 1;
      if (!Number.isNaN(lower[i]) && close[i] < lower[i]) state = 0; // exit overrides
      out[i] = state;
    }
    return out;
  },

  donchian_mid: ({ close, high, low, n }, fast, slow, out) => {
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
  },

  breakout_sma: ({ close, n }, fast, slow, out) => {
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
  },

  price_channel: ({ close, n }, fast, slow, out) => {
    const upper = shift1(rollingMax(close, fast));
    const lower = shift1(rollingMin(close, slow));
    let state = 0;
    for (let i = 0; i < n; i++) {
      if (!Number.isNaN(upper[i]) && close[i] >= upper[i]) state = 1;
      if (!Number.isNaN(lower[i]) && close[i] <= lower[i]) state = 0; // exit overrides
      out[i] = state;
    }
    return out;
  },

  atr_breakout: ({ close, high, low, n }, fast, slow, out) => {
    // Volatility-aware: a move only signals if it is large relative to how much
    // this instrument has been moving. A fixed percentage says the same thing
    // about a calm market and a panicking one.
    const a = atr(high, low, close, fast);
    for (let i = 1; i < n; i++) out[i] = close[i] > close[i - 1] + slow * a[i] ? 1 : 0;
    return out;
  },

  keltner_breakout: ({ close, high, low, n }, fast, slow, out) => {
    const mid = ema(close, Math.max(2, fast));
    const a = atr(high, low, close, fast);
    let state = 0;
    for (let i = 0; i < n; i++) {
      if (!Number.isNaN(mid[i]) && close[i] > mid[i] + slow * a[i]) state = 1;
      if (!Number.isNaN(mid[i]) && close[i] < mid[i]) state = 0; // exit overrides
      out[i] = state;
    }
    return out;
  },

  bollinger_breakout: ({ close, n }, fast, slow, out) => {
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
  },

  stddev_channel: ({ close, n }, fast, slow, out) => {
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
  },
} satisfies RuleSet;
