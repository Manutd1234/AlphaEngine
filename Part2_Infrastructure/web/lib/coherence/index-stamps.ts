/**
 * The index tape's one index space: its distinct poll stamps, in order.
 *
 * The recorder writes one point per FAMILY per poll, so a poll that read two
 * series is two points with one `ts_ns`. The series chart draws lanes over the
 * union of those stamps and the coverage strip under it draws one mark per
 * recorded moment — and for the two to share a crosshair they must count the
 * same thing. This is that thing, derived once and handed to both, so neither
 * figure can arrive at its own idea of how many polls there were.
 *
 * `IndexPane` used to build the strip's marks as one per POINT, which on a
 * two-series watchlist drew every poll twice and would have put the strip's
 * index space at twice the chart's. The strip's marks are per stamp now: a
 * stamp is measured if ANY point at it could be measured, and its reason is
 * the first unmeasurable point's, as the recorder wrote it.
 */

import type { CoherenceIndexPoint } from "@/lib/coherence/types";
import { toCenticents } from "@/lib/coherence/fixed-point";

export interface StampMark {
  ts: number;
  measured: boolean;
  detail: string | null;
}

/** Distinct `ts_ns` values, ascending. */
export function stampsOf(points: readonly CoherenceIndexPoint[]): number[] {
  return [...new Set(points.map((point) => point.ts_ns))].sort((a, b) => a - b);
}

/** One coverage mark per stamp, in stamp order. */
export function marksAtStamps(points: readonly CoherenceIndexPoint[], stamps: readonly number[]): StampMark[] {
  const byStamp = new Map<number, CoherenceIndexPoint[]>();
  for (const point of points) {
    const at = byStamp.get(point.ts_ns);
    if (at) at.push(point);
    else byStamp.set(point.ts_ns, [point]);
  }
  return stamps.map((ts) => {
    const at = byStamp.get(ts) ?? [];
    const measured = at.some((point) => toCenticents(point.ci) != null);
    const unmeasured = at.find((point) => toCenticents(point.ci) == null);
    return { ts, measured, detail: measured ? null : unmeasured?.detail ?? null };
  });
}
