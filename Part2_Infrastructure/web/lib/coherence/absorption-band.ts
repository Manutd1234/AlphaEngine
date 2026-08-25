/**
 * The spread behind the two mean absorption curves.
 *
 * `release_curve` and `call_curve` are MEANS. `modules/api/diffusion.py`'s
 * `_curve()` builds each as the mean absorbed fraction at a horizon over the
 * runs whose `signal_state` is `ok`, and `None` where nobody measured — so the
 * tab drew one number per horizon while every run carried its own eight-point
 * path in `cells`. A mean of paths that differ is worth drawing as a mean of
 * paths that differ.
 *
 * THE POPULATION HAS TO MATCH THE MEAN'S, exactly, or the band is not the
 * spread behind that line: the same `signal_state === "ok"` filter and the same
 * "absorbed is not null" filter, taken per stage and per horizon. This is the
 * single correctness constraint on the figure and it is why the filter lives
 * here rather than in the component.
 *
 * NO NEW GATEWAY DATA. Every field read here is already in the absorption
 * payload the announcement arm holds — the `FloorDistribution` precedent, which
 * `diffusion-figures.test.ts` pins as "a figure and not a schema change".
 */

import type { StageRun } from "@/components/coherence/diffusion/types";

export interface HorizonBand {
  /** Null where nobody measured this horizon, never zero. */
  p25: number | null;
  p75: number | null;
  /** How many runs the band at this horizon was taken over. */
  n: number;
}

/**
 * The linearly-interpolated quantile of a sorted sample.
 *
 * Interpolated rather than nearest-rank because the samples here are small — a
 * few dozen stages — and nearest-rank on a small sample makes the band jump by
 * a whole observation as one run enters or leaves.
 */
export function quantile(sorted: readonly number[], q: number): number | null {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (position - lower) * (sorted[upper] - sorted[lower]);
}

/**
 * The inter-quartile band per horizon, for one stage, over the mean's own population.
 *
 * ONE PASS OVER THE RUNS, NOT ONE PER HORIZON. The first cut looped horizons on
 * the outside and runs on the inside, so every run's cell array was walked once
 * for each of the eight horizons — 8 x 248 x 8 on the live ledger, about 15,900
 * iterations for a job that visits 1,984 cells. Bucketing by horizon in a single
 * sweep is the same answer for an eighth of the work, and the sort cost is
 * unchanged because it was always per horizon.
 */
export function absorptionBand(
  runs: readonly StageRun[],
  stage: "release" | "call",
  horizons: readonly string[],
): HorizonBand[] {
  const byHorizon = new Map<string, number[]>();
  for (const horizon of horizons) byHorizon.set(horizon, []);
  for (const run of runs) {
    if (run.stage !== stage || run.signal_state !== "ok") continue;
    for (const cell of run.cells) {
      if (cell.absorbed == null) continue;
      // `get` rather than `has` + `get`: a cell whose horizon is not on the
      // read's horizon list is dropped, which is what the nested loop did by
      // never asking about it.
      byHorizon.get(cell.horizon)?.push(cell.absorbed);
    }
  }
  return horizons.map((horizon) => {
    const values = byHorizon.get(horizon) ?? [];
    values.sort((a, b) => a - b);
    return { p25: quantile(values, 0.25), p75: quantile(values, 0.75), n: values.length };
  });
}

/**
 * How many runs stand behind the band, as one sentence or null.
 *
 * Constant on the live ledger — 42 statement stages and 47 press-conference
 * stages at every horizon that has a source — so it is reported as one count
 * rather than as a per-horizon list. If that ever stops being true the range is
 * stated instead, because a band from six runs and a band from ninety are drawn
 * at the same weight and the count is the only thing that says which is which.
 */
export function bandCoverage(bands: readonly HorizonBand[]): string | null {
  const counts = [...new Set(bands.map((band) => band.n).filter((n) => n > 0))];
  if (!counts.length) return null;
  if (counts.length === 1) return `${counts[0]} stages`;
  return `${Math.min(...counts)} to ${Math.max(...counts)} stages`;
}
