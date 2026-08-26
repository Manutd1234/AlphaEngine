/**
 * The reliability diagram's reading per band, checked where it lives.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { knotInBand, readBand } from "../lib/coherence/reliability-read";
import type { CoherenceMapPoint, CoherenceReliabilityBin } from "../lib/coherence/types-lab";

const bin = (label: string, count: number, mean_forecast: string | null, outcome_rate: string | null) =>
  ({ label, count, mean_forecast, outcome_rate }) as unknown as CoherenceReliabilityBin;
const knot = (quoted: string, calibrated: string, weight: number) => ({ quoted, calibrated, weight }) as unknown as CoherenceMapPoint;

describe("readBand", () => {
  const bins = [bin("0.0–0.1", 0, null, null), bin("0.1–0.2", 12, "0.1500", "0.2500")];
  it("says a band nobody quoted has no outcome rate, never a zero", () => {
    const reading = readBand(bins, [], 0);
    assert.equal(reading.title, "Band 0.0–0.1, 1 of 2");
    assert.deepEqual(reading.rows.map((r) => r.value), ["none — nobody quoted this band, so it has no outcome rate"]);
  });
  it("cuts the priced and happened figures from the wire and signs the gap", () => {
    const reading = readBand(bins, [], 1);
    assert.deepEqual(reading.rows.map((r) => [r.label, r.value]), [
      ["Settled", "12 markets"],
      ["Priced", "0.1500"],
      ["Happened", "0.2500"],
      ["Gap", "+0.1000"],
    ]);
  });
  it("names the isotonic knot that falls inside the band, with what it rests on", () => {
    // Two bins here, so the bands are halves: a knot quoted at 0.6 sits in the second.
    const reading = readBand(bins, [knot("0.6000", "0.2200", 1)], 1);
    assert.equal(reading.rows.at(-1)?.value, "quoted 0.6000 maps to 0.2200, fitted on 1 settled market — a single observation");
  });
});

describe("knotInBand", () => {
  it("closes the last band at 1.0 and keeps the others half-open", () => {
    const map = [knot("1.0000", "1.0000", 3), knot("0.5000", "0.4000", 2)];
    assert.equal(knotInBand(map, 9, 10)?.weight, 3);
    assert.equal(knotInBand(map, 5, 10)?.weight, 2);
    assert.equal(knotInBand(map, 4, 10), null);
  });
});
