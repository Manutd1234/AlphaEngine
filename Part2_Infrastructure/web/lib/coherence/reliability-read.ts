/**
 * What the reliability diagram says at one price band, for its crosshair.
 *
 * Split out of `ReliabilityDiagram.tsx` on 2026-08-26 so the drawing keeps
 * its room: three titles — the empty band's, the knot's, the point's — became
 * one reading per band, and a reading is words, not geometry. Every number
 * here is either cut from the wire's own string (`decimalLabel`) or a derived
 * difference that says it is (`deltaLabel`); nothing rounds a wire string
 * through a float.
 */

import { decimalLabel, deltaLabel, unitOf } from "@/lib/coherence/decimals";
import type { CoherenceMapPoint, CoherenceReliabilityBin } from "@/lib/coherence/types-lab";
import type { SharedXRow } from "@/lib/coherence/use-shared-x-readout";

export interface BandReading {
  title: string;
  rows: SharedXRow[];
}

/** The isotonic knot that falls inside band `index` of `count`, if one does. */
export function knotInBand(map: readonly CoherenceMapPoint[], index: number, count: number): CoherenceMapPoint | null {
  for (const point of map) {
    const x = unitOf(point.quoted);
    if (x == null) continue;
    // The last band closes at 1.0 inclusive; every other band is half-open.
    const band = Math.min(count - 1, Math.floor(x * count));
    if (band === index) return point;
  }
  return null;
}

export function readBand(
  bins: readonly CoherenceReliabilityBin[],
  map: readonly CoherenceMapPoint[],
  index: number,
): BandReading {
  const bin = bins[index];
  const title = `Band ${bin.label}, ${index + 1} of ${bins.length}`;
  if (bin.count <= 0) {
    return { title, rows: [{ label: "Settled", value: "none — nobody quoted this band, so it has no outcome rate" }] };
  }
  const priced = unitOf(bin.mean_forecast);
  const happened = unitOf(bin.outcome_rate);
  const rows: SharedXRow[] = [
    { label: "Settled", value: `${bin.count} market${bin.count === 1 ? "" : "s"}`, raw: bin.count },
    { label: "Priced", value: decimalLabel(bin.mean_forecast), raw: priced },
    { label: "Happened", value: decimalLabel(bin.outcome_rate), raw: happened },
    {
      label: "Gap",
      value: priced == null || happened == null ? "— not readable" : deltaLabel(happened - priced),
      raw: priced == null || happened == null ? null : happened - priced,
    },
  ];
  const knot = knotInBand(map, index, bins.length);
  if (knot) {
    rows.push({
      label: "Isotonic knot",
      value: `quoted ${decimalLabel(knot.quoted)} maps to ${decimalLabel(knot.calibrated)}, fitted on ${knot.weight} settled market${knot.weight === 1 ? " — a single observation" : "s"}`,
      raw: unitOf(knot.calibrated),
    });
  }
  return { title, rows };
}
