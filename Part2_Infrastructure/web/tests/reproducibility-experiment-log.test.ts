/**
 * What makes two research runs comparable rather than merely similar.
 *
 * The research log answers "did I already test this?". That answer is only
 * trustworthy if two things hold, and both are pinned here.
 *
 * The first is dataset identity. A periodStart/periodEnd pair says which window
 * was tested, not which bars were in it — a revision, a different venue or a
 * different symbol over the same dates is a different experiment wearing the
 * same label, so the log fingerprints the series and compares that.
 *
 * The second is that the attempt count cannot be corrupted by annotation. A tag
 * or a note is a thing the reader wrote about a run, not a parameter of it, and
 * a tag that leaked into the request would make every re-run look novel and
 * inflate the count the log exists to keep honest.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { datasetFingerprint } from "../lib/engine";
import {
  annotateExperiment,
  compareRuns,
  sameRequest,
  type ExperimentRecord,
} from "../lib/experiments";
import { DEFAULT_REQUEST, type SweepRequest } from "../lib/types";
import { bars } from "./helpers/deterministic-bars";

function record(id: string, overrides: Partial<ExperimentRecord> = {}): ExperimentRecord {
  return {
    id,
    savedAt: 1,
    symbol: "BTCUSDT",
    interval: "1h",
    strategy: "ma_cross",
    direction: "long_only",
    bars: 1200,
    periodStart: "2026-01-01",
    periodEnd: "2026-02-20",
    combosTested: 40,
    fast: 10,
    slow: 50,
    sharpe: 1.2,
    totalReturn: 0.3,
    maxDrawdown: -0.12,
    trades: 20,
    deflatedSharpeRatio: 0.6,
    walkForwardOosSharpe: 0.4,
    medianEfficiency: 0.5,
    stabilityKind: "plateau",
    alphaTStat: 1.8,
    verdict: "marginal",
    promotionPassed: 4,
    promotionTotal: 6,
    modelledFrictions: false,
    request: { ...DEFAULT_REQUEST },
    ...overrides,
  };
}

// --------------------------------------------------------------------------
// Dataset identity
// --------------------------------------------------------------------------

describe("a window is not a dataset", () => {
  it("the same bars fingerprint identically", () => {
    assert.equal(datasetFingerprint(bars(300)), datasetFingerprint(bars(300)));
  });

  it("one revised bar changes the fingerprint", () => {
    const original = bars(300);
    const revised = original.map((b, i) => (i === 150 ? { ...b, c: b.c * 1.0001 } : b));
    assert.notEqual(datasetFingerprint(original), datasetFingerprint(revised));
  });

  it("two different series over the same window do not collide", () => {
    const a = bars(300, 1);
    const b = bars(300, 9);
    // Identical timestamps and length — exactly what a periodStart/periodEnd
    // comparison cannot tell apart.
    assert.equal(a[0].t, b[0].t);
    assert.equal(a[a.length - 1].t, b[b.length - 1].t);
    assert.notEqual(datasetFingerprint(a), datasetFingerprint(b));
  });
});

// --------------------------------------------------------------------------
// Comparing two runs
// --------------------------------------------------------------------------

describe("a comparison states whether it is a comparison at all", () => {
  it("matching hashes mean the difference is attributable to the request", () => {
    const comparison = compareRuns(
      record("EXP-001", { dataHash: "abc123" }),
      record("EXP-002", { dataHash: "abc123", sharpe: 1.6 }),
    );
    assert.equal(comparison.sameData, true);
    const sharpe = comparison.metricDeltas.find((m) => m.metric === "Sharpe");
    assert.ok(sharpe && Math.abs(sharpe.delta! - 0.4) < 1e-9);
  });

  it("different hashes are flagged, because the bars are the confound", () => {
    const comparison = compareRuns(
      record("EXP-001", { dataHash: "abc123" }),
      record("EXP-002", { dataHash: "def456" }),
    );
    assert.equal(comparison.sameData, false);
  });

  it("an unfingerprinted run is unknown, never assumed identical", () => {
    // "Unknown" and "different" prompt opposite conclusions from a reader, and
    // so do "unknown" and "same". Only three-valued logic is honest here.
    assert.equal(compareRuns(record("EXP-001"), record("EXP-002", { dataHash: "x" })).sameData, null);
    assert.equal(compareRuns(record("EXP-001"), record("EXP-002")).sameData, null);
  });

  it("names the request fields that actually differ", () => {
    const a = record("EXP-001");
    const b = record("EXP-002", { request: { ...DEFAULT_REQUEST, slippageBps: 25 } });
    const diffs = compareRuns(a, b).requestDiffs;
    assert.equal(diffs.length, 1);
    assert.equal(diffs[0].field, "slippageBps");
  });

  it("leaves a missing metric as a gap rather than a zero delta", () => {
    const comparison = compareRuns(
      record("EXP-001", { walkForwardOosSharpe: null }),
      record("EXP-002", { walkForwardOosSharpe: 0.5 }),
    );
    const oos = comparison.metricDeltas.find((m) => m.metric === "OOS Sharpe");
    // A run without walk-forward did not score 0 out-of-sample; it did not
    // score at all, and a "+0.50" would read as an improvement over nothing.
    assert.equal(oos?.delta, null);
  });
});

// --------------------------------------------------------------------------
// Annotation must not corrupt the attempt count
// --------------------------------------------------------------------------

describe("annotating a run does not make it a new experiment", () => {
  it("keeps tags off the request, where they would break dedupe", () => {
    const annotated = annotateExperiment([record("EXP-001")], "EXP-001", {
      note: "regime-sensitive",
      tags: ["trend", "high-vol"],
    });
    assert.deepEqual(annotated[0].tags, ["trend", "high-vol"]);
    // The request is what identifies an experiment; a tag array inside it would
    // fail scalar equality and make every re-run look novel.
    assert.ok(sameRequest(annotated[0].request, DEFAULT_REQUEST as SweepRequest));
  });

  it("normalises tags so the same label is one label", () => {
    const annotated = annotateExperiment([record("EXP-001")], "EXP-001", {
      tags: [" Trend ", "trend", "TREND", ""],
    });
    assert.deepEqual(annotated[0].tags, ["trend"]);
  });

  it("clears an emptied note instead of storing whitespace", () => {
    const withNote = annotateExperiment([record("EXP-001", { note: "old" })], "EXP-001", { note: "   " });
    assert.equal(withNote[0].note, undefined);
  });

  it("touches only the record named", () => {
    const annotated = annotateExperiment(
      [record("EXP-001"), record("EXP-002", { note: "keep me" })],
      "EXP-001",
      { note: "new" },
    );
    assert.equal(annotated[1].note, "keep me");
  });
});
