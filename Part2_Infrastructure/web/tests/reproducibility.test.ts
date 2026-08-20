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
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

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

// --------------------------------------------------------------------------
// A fitted model's reproducibility capsule
// --------------------------------------------------------------------------

/**
 * The Research tab's capsule was built for a sweep and answered every question
 * a sweep raises: which instrument, which bars, how wide the search, which
 * build. A fitted model was listed on the same tab with none of it — the
 * `FittedModels` table showed eight columns of RESULT and one truncated hash,
 * so the three fields that decide whether an ML run can be re-run at all
 * (`seed`, `git_sha`, `engine`) were on the wire, in the database, justified at
 * length in the migration, and nowhere on screen.
 *
 * These pin the capsule that closes that gap, and pin it against its sources
 * rather than against itself: the migration says which columns exist, and
 * `modules/ml/fit.py` owns the reason PBO is null, so neither can drift into
 * being a sentence this component invented.
 */

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

/** Comments explain the traps; a scan that cannot tell them apart reads the
 *  explanation as the offence. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/.*$/gm, "");

const capsule = read("../components/research/MlRunCapsule.tsx");
const capsuleCode = code(capsule);
const fitted = read("../components/research/FittedModels.tsx");
const fittedCode = code(fitted);
const migration = read("../../../supabase/migrations/20260820090000_ml_runs.sql");
const fitPy = read("../../modules/ml/fit.py");

describe("a fitted run states what it would take to re-run it", () => {
  it("renders every provenance column ml_runs records, not only the results", () => {
    // Each of these is a column the migration argues for by name. A capsule
    // that showed the Sharpe and hid the seed would be the table it replaced.
    for (const column of ["data_hash", "seed", "git_sha", "engine"]) {
      assert.match(migration, new RegExp(`\\b${column}\\b`), `ml_runs no longer has ${column}`);
      assert.match(
        capsuleCode,
        new RegExp(`run\\.${column}\\b`),
        `the capsule does not read ${column}, which ml_runs records so a run can be repeated`,
      );
    }
  });

  it("reads the seed and the sha as fields that can be missing", () => {
    /**
     * `seed` is NOT NULL with no default in the migration, so this branch
     * should be unreachable — which is the reason to keep it. A corpus that
     * answered without one would otherwise render an empty cell, and an empty
     * cell beside a Sharpe reads as a run that is fine.
     */
    assert.match(capsuleCode, /run\.seed == null/);
    assert.match(capsuleCode, /run\.git_sha == null/);
    assert.doesNotMatch(capsuleCode, /seed \?\?|git_sha \?\?|pbo \?\? 0/);
  });

  it("dashes what it does not have, and never zeroes or blanks it", () => {
    // The Withheld cell is the whole rule in one component: an em dash the eye
    // catches, and a cause beside it. Nothing here may fall back to a figure.
    assert.match(capsuleCode, /function Withheld/);
    assert.match(capsuleCode, /—/);
    assert.doesNotMatch(capsuleCode, /\?\? 0\b|\?\? ""/);
  });

  it("takes the reason PBO is null from the code that decides it", () => {
    // Not a sentence this component composed. `modules/ml/fit.py` sets the
    // column to None and records why; the capsule quotes that reason, so the
    // two cannot drift into disagreeing about the same null.
    // Adjacent string literals rejoined first, in both languages: Python
    // implicit concatenation and a TypeScript `+` both wrap this reason across
    // two lines, and a wrap is not a change of wording.
    const joined = (source: string) => source.replace(/"\s*\+?\s*"/g, "");
    const clause = "PBO ranks a selected configuration against the alternatives it was selected from";
    assert.ok(joined(fitPy).includes(clause), "fit.py no longer records why pbo is null");
    assert.ok(
      joined(capsuleCode).includes(clause),
      "the capsule states a PBO reason of its own invention rather than the one fit.py records",
    );
  });

  it("names where the fields it cannot reach actually live", () => {
    /**
     * The feature spec hash and the per-fold purge and embargo are recorded —
     * in `ml_features` and `ml_folds` — and served only by the run detail
     * route, which this app does not proxy. Omitting them would let a reader
     * take the absence for a zero purge, and an unpurged fold's out-of-sample
     * Sharpe is indistinguishable from a leak.
     */
    // Whitespace-tolerant: JSX wraps its copy, and the prose half of this
    // capsule carries the same two phrases across a line break.
    assert.match(capsuleCode, /spec\s+hash/);
    assert.match(capsuleCode, /[Pp]urge and\s+embargo/);
    const detail = capsuleCode.match(/GET \/api\/research\/ml\/runs\/\{run_id\}/g) ?? [];
    assert.ok(detail.length >= 2, "both withheld fields must name the record that holds them");
  });

  it("reads the withheld cells from the run detail, now that it is proxied", () => {
    // This was a ratchet on the excuse: it asserted the detail route did NOT
    // exist, so that adding it would fail here and force the two dashes to
    // become values. The route exists now, so the assertion inverts — the
    // capsule must read them rather than explain their absence.
    const proxied = existsSync(
      fileURLToPath(new URL("../app/api/gateway/research/ml/runs/[runId]/route.ts", import.meta.url)),
    );
    assert.equal(proxied, true, "the run detail proxy went away; restore it or re-withhold the cells");
    assert.match(capsuleCode, /evidence\?\.spec_hash/, "the capsule still ignores the feature spec");
    assert.match(capsuleCode, /purge_bars/, "the capsule still ignores the fold gaps");
  });

  it("still withholds them when the detail has not arrived", () => {
    // Null evidence is "this desk cannot currently say", which covers both the
    // request being in flight and the detail being unreadable. From the
    // reader's side those are the same fact, and neither is a zero.
    assert.match(capsuleCode, /evidence == null \|\| evidence\.purge_bars\.length === 0/);
  });
});

describe("the fitted-model capsule is the sweep capsule, not a lookalike", () => {
  it("wears the same markup as the one on the summary section", () => {
    // Same classes, same kicker, same definition list. A second provenance
    // block styled differently reads as a different kind of claim.
    for (const token of ["research-provenance", "research-provenance__lead", "Reproducibility capsule"]) {
      assert.ok(capsuleCode.includes(token), `the ML capsule stopped sharing "${token}"`);
      assert.ok(
        code(read("../app/dashboard/page.tsx")).includes(token),
        `the sweep capsule stopped using "${token}"`,
      );
    }
  });

  it("is rendered by the panel that lists the runs", () => {
    assert.match(fittedCode, /<MlRunCapsule\s+run=\{/);
  });

  it("can never point at a run the table is not showing", () => {
    /**
     * Derived from the list on every render rather than synced by an effect: a
     * refresh that drops the chosen run falls back to the newest one, instead
     * of leaving provenance on screen for a row that is gone.
     */
    assert.match(fittedCode, /runs\.find\(\(run\) => run\.id === chosenId\) \?\? runs\[0\] \?\? null/);
    assert.doesNotMatch(fittedCode, /useEffect\([^)]*chosenId/);
  });

  it("says the same thing about PBO in the table as in the capsule", () => {
    /**
     * The run table rendered every null through the generic "not computed"
     * cell, which is the reading `modules/ml/fit.py` wrote its `pbo_reason`
     * to prevent: PBO does not apply to a run that fitted one configuration,
     * and "failed to compute" invites someone to go and fix it.
     */
    assert.match(fittedCode, /PBO_NOT_APPLICABLE/);
    assert.match(fittedCode, /run\.pbo == null/);
  });

  it("never maxes a hurdle nobody cleared", () => {
    // `Math.max(...runs.map((r) => r.deflated_sharpe ?? 0))` reported 0.00 as
    // the best deflated Sharpe on a corpus where not one run had scored.
    assert.doesNotMatch(fittedCode, /deflated_sharpe \?\? 0/);
    assert.match(fittedCode, /value != null/);
  });
});
