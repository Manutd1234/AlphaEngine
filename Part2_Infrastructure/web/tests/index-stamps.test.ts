/**
 * The index pair's shared index space is the distinct poll stamps — derived
 * once, so the chart and the strip cannot count different things.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { marksAtStamps, stampsOf } from "../lib/coherence/index-stamps";
import type { CoherenceIndexPoint } from "../lib/coherence/types";

const point = (ts_ns: number, ci: string | null, detail: string | null = null): CoherenceIndexPoint =>
  ({ ts_ns, ci, detail, series_ticker: "KXBTCD", event_ticker: `E${ts_ns}`, engine: "isotonic" }) as unknown as CoherenceIndexPoint;

describe("stampsOf", () => {
  it("collapses two series polled at one moment into one stamp, ascending", () => {
    const stamps = stampsOf([point(30, "0.01"), point(10, null), point(30, "0.02"), point(20, "0.03")]);
    assert.deepEqual(stamps, [10, 20, 30]);
  });
  it("is empty on an empty tape", () => {
    assert.deepEqual(stampsOf([]), []);
  });
});

describe("marksAtStamps", () => {
  it("draws one mark per stamp, measured if any point at it was", () => {
    const points = [point(10, null, "no book"), point(20, "0.03"), point(30, null, "thin"), point(30, "0.02")];
    const marks = marksAtStamps(points, stampsOf(points));
    assert.deepEqual(marks, [
      { ts: 10, measured: false, detail: "no book" },
      { ts: 20, measured: true, detail: null },
      { ts: 30, measured: true, detail: null },
    ]);
  });
  it("keeps the first recorded reason for a stamp nobody could measure", () => {
    const points = [point(10, null, "first"), point(10, null, "second")];
    assert.equal(marksAtStamps(points, [10])[0].detail, "first");
  });
  it("never invents a mark for a stamp the tape does not hold", () => {
    assert.deepEqual(marksAtStamps([point(10, "0.01")], [10, 99])[1], { ts: 99, measured: false, detail: null });
  });
});
