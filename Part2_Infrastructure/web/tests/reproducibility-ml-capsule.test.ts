/**
 * A fitted model's reproducibility capsule.
 *
 * The Research tab's capsule was built for a sweep and answered every question
 * a sweep raises: which instrument, which bars, how wide the search, which
 * build. A fitted model was listed on the same tab with none of it — the
 * `FittedModels` table showed eight columns of RESULT and one truncated hash,
 * so the three fields that decide whether an ML run can be re-run at all
 * (`seed`, `git_sha`, `engine`) were on the wire, in the database, justified at
 * length in the migration, and nowhere on screen. A run whose Sharpe is visible
 * and whose seed is not is a result nobody can challenge by repeating it.
 *
 * These pin the capsule that closes that gap, and pin it against its sources
 * rather than against itself: the migration says which columns exist, and
 * `modules/ml/fit.py` owns the reason PBO is null, so neither can drift into
 * being a sentence this component invented. The second half pins that it is the
 * SAME capsule as the sweep's — same classes, same kicker, same words for the
 * same null — because a second provenance block styled differently reads as a
 * different kind of claim.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { readSource, stripCode } from "./helpers/source-files";

const capsule = readSource("components/research/MlRunCapsule.tsx");
const capsuleCode = stripCode(capsule);
const fitted = readSource("components/research/FittedModels.tsx");
const fittedCode = stripCode(fitted);
const migration = readSource("../../supabase/migrations/20260820090000_ml_runs.sql");
const fitPy = readSource("../modules/ml/fit.py");

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
        // The sweep capsule moved to the Summary section when page.tsx was split.
        stripCode(readSource("components/research/ResearchSummary.tsx")).includes(token),
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
     * One string for one null, shared by both surfaces so they cannot drift.
     *
     * It was `PBO_NOT_APPLICABLE`, and both surfaces rendered the words "not
     * applicable" for every null PBO. That was true only while every supervised
     * run fitted a single configuration. `modules/ml/selection.py` returns a
     * null on three bases — one configuration, fewer than `MIN_RANKED_FOLDS`
     * ranked folds, no folds — and only the first means "does not apply".
     * Neither `MLRunSummary` nor `MLRunDetail` carries `pbo_basis` or
     * `pbo_reason`, so the portal reads the null WITHOUT its cause and may not
     * name one: "not applicable" for a figure that failed to compute is the
     * flattering half of an ambiguity, which is the reading fit.py's own
     * `pbo_reason` comment exists to prevent.
     */
    assert.match(fittedCode, /PBO_UNSTATED/);
    assert.match(fittedCode, /run\.pbo == null/);
    assert.doesNotMatch(fittedCode, /not applicable/i);
    assert.doesNotMatch(capsuleCode, /"not applicable"/i);
  });

  it("never maxes a hurdle nobody cleared", () => {
    // `Math.max(...runs.map((r) => r.deflated_sharpe ?? 0))` reported 0.00 as
    // the best deflated Sharpe on a corpus where not one run had scored.
    assert.doesNotMatch(fittedCode, /deflated_sharpe \?\? 0/);
    assert.match(fittedCode, /value != null/);
  });
});
