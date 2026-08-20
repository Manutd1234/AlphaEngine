/**
 * What a run is judged by.
 *
 * Three expressions and one lookup. Each of the three is evaluated by the
 * Python reference in the same order on the same floats, which is why they are
 * written out rather than delegated. `sortino` is exported only because
 * `runCombo` now lives in a neighbouring module; it is still an implementation
 * detail of the result row and nothing outside the engine reads it.
 */

import { mean, stdev } from "../stats";
import { BARS_PER_YEAR } from "../types";

export const barsPerYear = (interval: string) => BARS_PER_YEAR[interval] ?? 8760;

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

export function sortino(returns: Float64Array, ann: number): number {
  const downside: number[] = [];
  for (let i = 0; i < returns.length; i++) if (returns[i] < 0) downside.push(returns[i]);
  const dd = downside.length > 1 ? stdev(downside, 1) : 0;
  return dd > 0 ? (mean(returns) / dd) * Math.sqrt(ann) : 0;
}
