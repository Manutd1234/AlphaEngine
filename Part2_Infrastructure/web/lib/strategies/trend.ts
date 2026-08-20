/**
 * Trend rules: stay long while the instrument keeps going one way.
 *
 * Fourteen of the catalogue's forty-six, and most are a crossover of two
 * smoothings of the same series. The moving-average variants differ only in how
 * they trade lag for overshoot; running them against `ma_cross` on the same
 * symbol is the cheapest way to find out which end of that trade-off the
 * instrument rewards.
 */

import { atr, dema, ema, hma, rollingMax, rollingSum, sma, tema, zlema } from "../indicators";
import type { RuleSet } from "./types";

export const TREND_RULES = {
  ma_cross: ({ close, n }, fast, slow, out) => {
    const f = sma(close, fast);
    const s = sma(close, slow);
    for (let i = 0; i < n; i++) {
      out[i] = !Number.isNaN(f[i]) && !Number.isNaN(s[i]) && f[i] > s[i] ? 1 : 0;
    }
    return out;
  },

  ema_cross: ({ close, n }, fast, slow, out) => {
    const f = ema(close, fast);
    const s = ema(close, slow);
    for (let i = 0; i < n; i++) out[i] = f[i] > s[i] ? 1 : 0;
    return out;
  },

  macd_cross: ({ close, n }, fast, slow, out) => {
    // Signal fixed at the conventional 9: the request carries two parameters,
    // and a third axis for a value nobody tunes multiplies every sweep by nine.
    const macd = new Float64Array(n);
    const f = ema(close, fast);
    const s = ema(close, slow);
    for (let i = 0; i < n; i++) macd[i] = f[i] - s[i];
    const signal = ema(macd, 9);
    for (let i = 0; i < n; i++) out[i] = macd[i] > signal[i] ? 1 : 0;
    return out;
  },

  triple_ma: ({ close, n }, fast, slow, out) => {
    // Middle leg derived, not a third parameter: the geometric mean keeps the
    // three periods evenly spaced on a log scale at no extra sweep axis.
    const midPeriod = Math.max(2, Math.round(Math.sqrt(fast * slow)));
    const f = sma(close, fast);
    const m = sma(close, midPeriod);
    const sl = sma(close, slow);
    for (let i = 0; i < n; i++) out[i] = f[i] > m[i] && m[i] > sl[i] ? 1 : 0;
    return out;
  },

  ppo_cross: ({ close, n }, fast, slow, out) => {
    const fastEma = ema(close, fast);
    const slowEma = ema(close, slow);
    const ppo = new Float64Array(n).fill(NaN);
    for (let i = 0; i < n; i++) {
      if (slowEma[i] !== 0) ppo[i] = ((fastEma[i] - slowEma[i]) / slowEma[i]) * 100;
    }
    const signal = ema(ppo, 9);
    for (let i = 0; i < n; i++) out[i] = ppo[i] > signal[i] ? 1 : 0;
    return out;
  },

  trix_cross: ({ close, n }, fast, slow, out) => {
    const e3 = ema(ema(ema(close, fast), fast), fast);
    const trix = new Float64Array(n).fill(NaN);
    for (let i = 1; i < n; i++) {
      if (e3[i - 1] !== 0) trix[i] = (e3[i] / e3[i - 1] - 1) * 100;
    }
    const sig = sma(trix, Math.max(2, slow));
    for (let i = 0; i < n; i++) out[i] = trix[i] > sig[i] ? 1 : 0;
    return out;
  },

  supertrend: ({ close, high, low, n }, fast, slow, out) => {
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
  },

  atr_trailing_stop: ({ close, high, low, n }, fast, slow, out) => {
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
  },

  dema_cross: ({ close, n }, fast, slow, out) => {
    const f = dema(close, fast);
    const s = dema(close, slow);
    for (let i = 0; i < n; i++) out[i] = f[i] > s[i] ? 1 : 0;
    return out;
  },

  tema_cross: ({ close, n }, fast, slow, out) => {
    const f = tema(close, fast);
    const s = tema(close, slow);
    for (let i = 0; i < n; i++) out[i] = f[i] > s[i] ? 1 : 0;
    return out;
  },

  zlema_cross: ({ close, n }, fast, slow, out) => {
    const f = zlema(close, fast);
    const s = zlema(close, slow);
    for (let i = 0; i < n; i++) out[i] = f[i] > s[i] ? 1 : 0;
    return out;
  },

  hull_trend: ({ close, n }, fast, slow, out) => {
    const h = hma(close, fast);
    for (let i = 0; i < n; i++) {
      out[i] = i >= slow && !Number.isNaN(h[i]) && !Number.isNaN(h[i - slow]) && h[i] > h[i - slow] ? 1 : 0;
    }
    return out;
  },

  vortex_cross: ({ close, high, low, n }, fast, slow, out) => {
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
  },

  ema_slope: ({ close, n }, fast, slow, out) => {
    const e = ema(close, fast);
    for (let i = 0; i < n; i++) {
      out[i] = i >= slow && e[i] - e[i - slow] > 0 ? 1 : 0;
    }
    return out;
  },
} satisfies RuleSet;
