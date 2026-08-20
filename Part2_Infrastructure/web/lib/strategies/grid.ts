/**
 * The parameter space each strategy is swept over.
 *
 * Here rather than in the engine because which of a strategy's two numbers is
 * a lookback and which is a level is a property of the rule, not of the sweep
 * that runs it. Both tables must match their namesakes in
 * `modules/backtester/indicators.py`: the two engines are compared combination
 * by combination, so a grid that differs is not a disagreement about the model,
 * it is the two of them answering about different parameters entirely.
 */

import { MAX_COMBOS, type Strategy, type SweepRequest } from "../types";

/**
 * Strategies whose SECOND parameter is not a lookback period.
 *
 * Must match `FREE_SECOND_AXIS` in `modules/backtester/indicators.py` — the
 * two engines are compared combination by combination, so a grid that differs
 * is not a disagreement about the model, it is the two of them answering about
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
 * Must match `FREE_FIRST_AXIS` in `modules/backtester/indicators.py`.
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
