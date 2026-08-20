/**
 * Volume rules: whether a price move carried participation.
 *
 * The one thing price alone cannot say. These are the rules that read the
 * `volume` column, which is also why it is carried through the engine rather
 * than dropped at the column split — a strategy silently reading zeros would
 * look like a model that never confirms rather than one never given the data.
 */

import { ema, rollingMax, rollingSum, shift1, sma } from "../indicators";
import type { RuleSet } from "./types";

export const VOLUME_RULES = {
  obv_trend: ({ close, volume, n }, fast, slow, out) => {
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
  },

  volume_breakout: ({ close, volume, n }, fast, slow, out) => {
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
  },

  mfi_reversion: ({ close, high, low, volume, n }, fast, slow, out) => {
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
  },

  vwap_trend: ({ close, high, low, volume, n }, fast, slow, out) => {
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
  },

  cmf_trend: ({ close, high, low, volume, n }, fast, slow, out) => {
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
  },

  force_index: ({ close, volume, n }, fast, slow, out) => {
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
  },

  eom_trend: ({ close, high, low, volume, n }, fast, slow, out) => {
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
  },
} satisfies RuleSet;
