/**
 * What makes two research runs comparable rather than merely similar.
 *
 * The research log answers "did I already test this?". That answer is only
 * trustworthy if two things hold: the attempt count cannot be corrupted by
 * annotation or re-runs, and two runs can be proven to have seen the same bars.
 * Both are pinned here, along with the overfitting estimate that the whole
 * walk-forward apparatus exists to produce.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { datasetFingerprint, walkForward } from "../lib/engine";
import {
  annotateExperiment,
  compareRuns,
  sameRequest,
  type ExperimentRecord,
} from "../lib/experiments";
import { overfittingProbability } from "../lib/quant";
import { DEFAULT_REQUEST, type Bar, type SweepRequest, type WalkForwardFold } from "../lib/types";

// A deterministic price path — no randomness, so a failure is a real change.
function bars(count: number, seed = 1): Bar[] {
  let price = 100;
  const out: Bar[] = [];
  for (let i = 0; i < count; i++) {
    price *= 1 + Math.sin((i + seed) / 17) * 0.004 + Math.cos((i + seed) / 43) * 0.002;
    out.push({
      t: Date.UTC(2026, 0, 1) + i * 3_600_000,
      o: price, h: price * 1.002, l: price * 0.998, c: price, v: 1000,
    });
  }
  return out;
}

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

// --------------------------------------------------------------------------
// Overfitting probability
// --------------------------------------------------------------------------

function fold(rank: number, total = 10): WalkForwardFold {
  return {
    fold: rank,
    trainStart: "2026-01-01", trainEnd: "2026-01-20",
    testStart: "2026-01-21", testEnd: "2026-02-01",
    chosenFast: 10, chosenSlow: 50,
    isSharpe: 1.5, oosSharpe: 0.2, oosReturn: 0.02,
    oosRank: rank, combosRanked: total,
  };
}

describe("PBO counts how often the in-sample pick lost its rank", () => {
  it("winners that keep placing in the bottom half read as overfit", () => {
    assert.equal(overfittingProbability([fold(8), fold(9), fold(10)]), 1);
  });

  it("winners that hold up read as robust", () => {
    assert.equal(overfittingProbability([fold(1), fold(2), fold(3)]), 0);
  });

  it("is null when nothing was ranked, not zero", () => {
    // Absent evidence must never render as "0% overfit" — that is the most
    // reassuring possible reading of no information at all.
    const unranked = { ...fold(1), oosRank: undefined, combosRanked: undefined };
    assert.equal(overfittingProbability([unranked]), null);
    assert.equal(overfittingProbability([]), null);
  });

  it("a single-combination grid cannot rank anything", () => {
    assert.equal(overfittingProbability([fold(1, 1)]), null);
  });
});

// --------------------------------------------------------------------------
// Embargoed folds
// --------------------------------------------------------------------------

describe("the embargo keeps a lookback from spanning the fold boundary", () => {
  const combos: Array<[number, number]> = [[5, 20], [10, 50]];
  const request = (embargoBars?: number): SweepRequest => ({
    ...DEFAULT_REQUEST, bars: 1600, folds: 3, walkForward: true, embargoBars,
  });

  it("shortens training without moving the test window or dropping a fold", () => {
    const plain = walkForward(bars(1600), combos, request());
    const gapped = walkForward(bars(1600), combos, request(120));

    assert.equal(gapped.folds.length, plain.folds.length);
    for (let i = 0; i < plain.folds.length; i++) {
      assert.equal(gapped.folds[i].testStart, plain.folds[i].testStart);
      assert.ok(gapped.folds[i].trainEnd < plain.folds[i].trainEnd);
      assert.equal(gapped.folds[i].embargoBars, 120);
    }
  });

  it("defaults to zero so the Python parity fixture still holds", () => {
    const { folds } = walkForward(bars(1600), combos, request());
    assert.ok(folds.length > 0);
    assert.ok(folds.every((f) => f.embargoBars === 0));
  });

  it("ranks the winner against the whole grid on every fold", () => {
    const { folds } = walkForward(bars(1600), combos, request());
    for (const f of folds) {
      assert.equal(f.combosRanked, combos.length);
      assert.ok(f.oosRank! >= 1 && f.oosRank! <= combos.length);
    }
  });
});
