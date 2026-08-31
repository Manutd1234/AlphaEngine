/** The corpus composition's one sorted array, checked where it lives. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { corpusRows } from "../lib/coherence/corpus-rows";
import type { CoherenceCalibration } from "../lib/coherence/types-lab";

const data = {
  composition: [{ series_ticker: "A", count: 10 }, { series_ticker: "B", count: 30 }, { series_ticker: "C", count: 0 }],
  bias_by_series: [{ series_ticker: "B", slope: "1.0234567" }, { series_ticker: "C", slope: "0" }],
} as unknown as CoherenceCalibration;
const corpusView = readFileSync(
  fileURLToPath(new URL("../components/coherence/CalibrationCorpus.tsx", import.meta.url)),
  "utf8",
);

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

  it("keeps the disclosure count for assistive technology without printing the row suffix", () => {
    const at = corpusView.indexOf("Every series in the corpus");
    const start = corpusView.lastIndexOf("<summary>", at);
    const end = corpusView.indexOf("</summary>", at) + "</summary>".length;
    const summary = corpusView.slice(start, end);
    const visible = summary.replace(/<span className="sr-only">[\s\S]*?<\/span>/, "");
    assert.doesNotMatch(visible, /\brows\b/);
    assert.match(summary, /<span className="sr-only">\{`, \$\{rows\.length\} rows`\}<\/span>/);
  });
});
