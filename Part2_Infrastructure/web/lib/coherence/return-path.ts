/**
 * The raw abnormal-return path behind every absorbed fraction.
 *
 * WHY THIS EXISTS AT ALL. `HorizonCell.abnormal_return` has been on the wire
 * since the arm shipped and was read by nothing: `types.ts` declared it, the
 * generated contract carried it, and no component under
 * `components/coherence/diffusion/` ever touched it. Measured on the live
 * ledger, that is 1,488 non-null values over 1,984 cells.
 *
 * THE PART THAT MAKES IT WORTH DRAWING. `_cell()` in
 * `modules/coherence/diffusion/absorption.py` never consults the noise gate —
 * the gate is applied afterwards, to `terminal_return`, and lands in
 * `signal_state`. So a run refused by the floor still carries a COMPLETE
 * measured path. And every consumer on this tab opens by filtering
 * `signal_state === "ok"`: `absorption-band.ts`, `ClockAgreement`,
 * `FloorDistribution`, `MeetingTable`.
 *
 * Counted on the live payload: 248 runs, 89 accepted, 159 refused, and all 159
 * of the refused ones carry a full six-point path. 954 measured cells inside
 * refused runs against 534 inside drawn ones. **The tab has been drawing the
 * smaller half of its own measurements**, and nothing on it has ever shown what
 * the noise floor rejects — which is what would make the floor auditable rather
 * than asserted.
 *
 * Basis points, not the raw fraction: an abnormal return of 0.0038 is a number
 * nobody reads, and 38 bps is the unit the desk quotes moves in everywhere else.
 */

import type { StageRun } from "@/components/coherence/diffusion/types";

/** One drawable point: the horizon's index on the grid, and the move in bps. */
export interface PathPoint {
  readonly index: number;
  readonly bps: number;
}

/** A run reduced to what the fan draws. */
export interface RunPath {
  readonly key: string;
  readonly stage: string;
  readonly symbol: string;
  readonly source: string;
  /** False when the noise floor refused this run — drawn, and said so. */
  readonly cleared: boolean;
  readonly points: readonly PathPoint[];
  /** Highest absorbed fraction on the path, when one was resolved. */
  readonly peak: number | null;
}

export const BPS = 10_000;

/**
 * Every run as a path, refused ones INCLUDED.
 *
 * The one place on this tab that does not filter on `signal_state`, and the
 * reason it exists. A refused run is drawn dashed and its title says the floor
 * refused it; it is not dropped, because "the floor rejected 159 of 248" is a
 * claim a reader should be able to check rather than take.
 */
export function runPaths(runs: readonly StageRun[], horizons: readonly string[]): RunPath[] {
  const order = new Map(horizons.map((horizon, index) => [horizon, index] as const));
  const out: RunPath[] = [];

  for (const run of runs) {
    const points: PathPoint[] = [];
    let peak: number | null = null;

    for (const cell of run.cells) {
      const index = order.get(cell.horizon);
      // A cell for a horizon this read does not list is dropped rather than
      // guessed at a position — the grid is the payload's own.
      if (index == null) continue;
      if (cell.absorbed != null) peak = peak == null ? cell.absorbed : Math.max(peak, cell.absorbed);
      // NOT `?? 0`. A cell with no abnormal return was never measured, and a
      // point at zero would draw "the price did not move" over "nobody looked".
      if (cell.abnormal_return == null) continue;
      points.push({ index, bps: cell.abnormal_return * BPS });
    }

    if (!points.length) continue;
    out.push({
      key: run.run_id,
      stage: run.stage,
      symbol: run.symbol,
      source: run.source_ref,
      cleared: run.signal_state === "ok",
      points,
      peak,
    });
  }
  return out;
}

/**
 * A SIGNED LOG axis, and the reason is the measured distribution rather than
 * taste.
 *
 * |bps| over the 1,488 measured cells: median 29.7, p75 70.5, p95 217, p99 477,
 * max 891. A thirty-fold tail. On a linear axis bounded by the largest path the
 * median occupies 3.3% of the half-axis, and bounding at p99 only takes that to
 * 6.2% — so a linear scale is unreadable wherever it is cut, and cutting it is
 * the clipping this figure exists to avoid.
 *
 * `sign(v) * log10(1 + |v|)` keeps every path, keeps the sign, keeps zero at
 * zero, and is very nearly linear for the small moves. On the same data the
 * median lands at 50% of the half-axis, p75 at 63% and p99 at 91%. Nothing is
 * dropped and nothing is compressed into the origin.
 */
export function signedLog(bps: number): number {
  return Math.sign(bps) * Math.log10(1 + Math.abs(bps));
}

/**
 * The ticks a signed-log axis can honestly label: zero, then decades out to the
 * bound. Labelled in bps, because that is the unit a reader thinks in — the
 * scale is a drawing device and should not become a thing to decode.
 */
export function logTicks(bound: number): number[] {
  const out = [0];
  for (let decade = 1; decade <= bound; decade *= 10) {
    if (signedLog(decade) / signedLog(bound) > 0.12) out.push(decade);
  }
  return out;
}

/**
 * The largest absolute move on any drawn path, for a symmetric axis.
 *
 * UNCLIPPED, deliberately. `absorption.py` makes a point of leaving the
 * denominator unclipped, and a hidden clamp here would repeat that defect one
 * axis up: an overshoot would be drawn as a path that merely arrives. Measured
 * on the live ledger, 52 of 534 absorbed values exceed 1.0 and the largest is
 * 3.22, while both mean curves top out at exactly 1.0000 — so the overshoot is
 * real, and structurally invisible everywhere else on the tab.
 *
 * Legibility is bought back by `signedLog` above, not by throwing away the runs
 * that make the point. The quartile band is a second reading — where the middle
 * half sits — rather than the thing that rescues the scale.
 */
export function bpsBound(paths: readonly RunPath[]): number {
  let bound = 0;
  for (const path of paths) {
    for (const point of path.points) bound = Math.max(bound, Math.abs(point.bps));
  }
  // A floor, so an all-flat sample still draws an axis rather than dividing by
  // nothing.
  return bound || 1;
}

/** The p25/p75 envelope at each horizon, over whichever paths are handed in. */
export function quartileBand(
  paths: readonly RunPath[],
  horizonCount: number,
): ReadonlyArray<{ index: number; low: number; high: number; n: number }> {
  const byIndex = new Map<number, number[]>();
  for (const path of paths) {
    for (const point of path.points) {
      const bucket = byIndex.get(point.index);
      if (bucket) bucket.push(point.bps);
      else byIndex.set(point.index, [point.bps]);
    }
  }

  const out: Array<{ index: number; low: number; high: number; n: number }> = [];
  for (let index = 0; index < horizonCount; index += 1) {
    const values = byIndex.get(index);
    // A horizon nobody measured is absent from the band rather than present at
    // zero width, so the band breaks where the paths break.
    if (!values || values.length < 4) continue;
    values.sort((a, b) => a - b);
    out.push({
      index,
      low: values[Math.floor((values.length - 1) * 0.25)],
      high: values[Math.floor((values.length - 1) * 0.75)],
      n: values.length,
    });
  }
  return out;
}

/**
 * A polyline broken at every gap.
 *
 * Lifted out of `AbsorptionCurve` rather than written twice: a line drawn
 * across a horizon nobody measured asserts a reading nobody took, and there is
 * one rule for that on this tab, not two.
 */
export function brokenPath(
  points: readonly PathPoint[],
  x: (index: number) => number,
  y: (bps: number) => number,
): string {
  let out = "";
  let pen = false;
  let previous = -2;
  for (const point of points) {
    const jumped = point.index !== previous + 1;
    out += `${!pen || jumped ? "M" : "L"}${x(point.index).toFixed(1)},${y(point.bps).toFixed(1)}`;
    pen = true;
    previous = point.index;
  }
  return out;
}
