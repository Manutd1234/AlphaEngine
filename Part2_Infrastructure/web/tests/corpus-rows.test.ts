/** The corpus composition's one sorted array, checked where it lives. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { corpusRows } from "../lib/coherence/corpus-rows";
import type { CoherenceCalibration } from "../lib/coherence/types-lab";

const data = {
  composition: [{ series_ticker: "A", count: 10 }, { series_ticker: "B", count: 30 }, { series_ticker: "C", count: 0 }],
  bias_by_series: [{ series_ticker: "B", slope: "1.0234567" }, { series_ticker: "C", slope: "0" }],
} as unknown as CoherenceCalibration;

describe("corpusRows", () => {
  it("sorts heaviest first and shares divide by the composition's total", () => {
    const { rows, corpus } = corpusRows(data);
    assert.equal(corpus, 40);
    assert.deepEqual(rows.map((r) => [r.ticker, r.share]), [["B", 0.75], ["A", 0.25], ["C", 0]]);
  });
  it("keeps the wire's slope string and reads zero as a slope, not as nothing", () => {
    const { rows } = corpusRows(data);
    const b = rows.find((r) => r.ticker === "B");
    const c = rows.find((r) => r.ticker === "C");
    const a = rows.find((r) => r.ticker === "A");
    assert.deepEqual([b?.slope, b?.slopeRaw, b?.slopeText], [1.0234567, "1.0234567", "1.0234"]);
    assert.deepEqual([c?.slope, c?.slopeText], [0, "0"]);
    assert.deepEqual([a?.slope, a?.slopeRaw, a?.slopeText], [null, null, "no slope reported"]);
  });
  it("gives an empty composition no shares and a zero corpus", () => {
    assert.deepEqual(corpusRows({ composition: [], bias_by_series: [] } as unknown as CoherenceCalibration), { rows: [], corpus: 0 });
  });
});
