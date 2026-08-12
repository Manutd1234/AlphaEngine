/**
 * The research sweep runs itself. Four properties keep that from being worse
 * than the button it replaced, and none of them is visible to a type checker.
 *
 *  1. **Commit is the DOM's `change`, not React's `onChange`.** React's
 *     `onChange` is the native `input` event: on a range input it fires on
 *     every tick of a drag. If a future edit wires the commit path to a React
 *     handler, one slider drag becomes one request per pixel — the exact
 *     failure this design exists to avoid, and one that looks completely
 *     correct in review.
 *
 *  2. **Auto-runs never enter the experiment trail.** `addExperiment`
 *     deduplicates by `sameRequest`, so a *re-run* replaces its predecessor —
 *     but every auto-run carries different parameters and would be a NEW
 *     record. Dragging one slider across ten values would write ten rows into
 *     the panel whose entire purpose is an honest count of hypotheses tried.
 *
 *  3. **A drill-down suspends auto-run.** `inspectCombo` re-runs the sweep
 *     pinned to one parameter pair with `preserveInspect`. An auto-run would
 *     replace it with the full sweep and silently undo what was just asked for.
 *
 *  4. **The veil cannot claim to be recomputing when nothing is coming.**
 *     `StaleGate`'s two modes mean different things; showing "Recomputing" over
 *     evidence that will never refresh is the silent lie the gate exists to
 *     prevent.
 *
 * Source-level assertions on purpose: there is no DOM in this suite, and the
 * properties worth pinning are structural, so a future edit has to break them
 * deliberately. The `sameRequest` behaviour underneath (1) and (2) is exercised
 * as a real unit test at the bottom.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { addExperiment, sameRequest } from "../lib/experiments";
import { DEFAULT_REQUEST, type SweepRequest, type SweepResponse } from "../lib/types";

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

const controls = read("../components/Controls.tsx");
const page = read("../app/dashboard/page.tsx");
const staleGate = read("../components/research/StaleGate.tsx");

// --------------------------------------------------------------------------
// 1 — the commit signal is the native change event
// --------------------------------------------------------------------------

describe("the sweep commits on the DOM's change event, not React's onChange", () => {
  it("Controls registers a native change listener", () => {
    assert.match(
      controls,
      /addEventListener\(\s*["']change["']/,
      "Controls no longer listens for the native `change` event — React's onChange is the "
        + "`input` event and fires on every tick of a slider drag",
    );
    assert.match(
      controls,
      /removeEventListener\(\s*["']change["']/,
      "the change listener is added but never removed",
    );
  });

  it("the listener sits on the panel root so change can bubble to it", () => {
    // One listener for fifteen controls only works because `change` bubbles.
    // Attaching it to an inner node would silently miss whole groups of fields.
    assert.match(controls, /panelRef/, "the panel root ref is gone");
    assert.match(
      controls,
      /<div(?=[^>]*className="card sidebar experiment-panel")(?=[^>]*ref=\{panelRef\})[^>]*>/,
      "the change listener's ref is no longer on the panel root, so controls outside "
        + "that subtree stop committing",
    );
  });

  it("Controls takes an onCommit prop distinct from onRun", () => {
    assert.match(controls, /onCommit:\s*\(\)\s*=>\s*void/);
    assert.match(controls, /onRun:\s*\(\)\s*=>\s*void/);
  });

  it("page.tsx passes its commit handler in", () => {
    assert.match(page, /onCommit=\{commitRequest\}/);
  });
});

// --------------------------------------------------------------------------
// 2 — auto-runs do not record
// --------------------------------------------------------------------------

describe("auto-runs stay out of the experiment trail", () => {
  it("run() takes a record flag", () => {
    assert.match(page, /record = true,/, "run() lost its `record` parameter");
  });

  it("the trail is only written when record is set", () => {
    assert.match(
      page,
      /if \(record && !preserveInspect\) \{\s*\n\s*setExperiments\(\(current\) => addExperiment/,
      "addExperiment is no longer guarded by `record` — every settled slider value would "
        + "become a new row in the run archive",
    );
  });

  it("commitRequest runs without recording", () => {
    const start = page.indexOf("const commitRequest = useCallback");
    assert.notEqual(start, -1, "commitRequest is gone");
    const body = page.slice(start, page.indexOf("}, [", start));
    assert.match(
      body,
      /void run\(undefined, false, false\)/,
      "commitRequest no longer passes record=false",
    );
  });

  it("an explicit pin is the way a run enters the trail", () => {
    assert.match(page, /const pinRun = useCallback/);
    assert.match(page, /onClick=\{pinRun\}/);
  });
});

// --------------------------------------------------------------------------
// 3 — suspension rules
// --------------------------------------------------------------------------

describe("auto-run yields to the states it would clobber", () => {
  const start = page.indexOf("const commitRequest = useCallback");
  const body = page.slice(start, page.indexOf("}, [", start));

  it("does nothing when Auto is off", () => {
    assert.match(body, /if \(!autoRun\) return;/);
  });

  it("does nothing while a drill-down is open", () => {
    assert.match(body, /if \(inspect\) return;/);
  });

  it("skips a request identical to the one already run", () => {
    assert.match(body, /sameRequest\(lastRunRequest\.current, req\)/);
  });

  it("the idle fallback is also suspended by both", () => {
    assert.match(
      page,
      /if \(!autoRun \|\| inspect\) return;\s*\n\s*const timer = window\.setTimeout\(commitRequest/,
      "the idle fallback no longer respects the Auto switch and the drill-down",
    );
  });

  it("the abort-and-sequence guard survives", () => {
    // Superseded auto-runs are the common case now, not the rare one.
    assert.match(page, /activeRun\.current\?\.abort\(\)/);
    assert.match(page, /if \(sequence !== runSeq\.current\) return;/);
  });
});

// --------------------------------------------------------------------------
// 4 — the veil tells the truth
// --------------------------------------------------------------------------

describe("StaleGate distinguishes recomputing from stale", () => {
  it("takes an explicit mode", () => {
    assert.match(staleGate, /mode\?:\s*"stale"\s*\|\s*"recomputing"/);
  });

  it("only the stale mode offers a rerun", () => {
    const start = staleGate.indexOf("{recomputing ? (");
    assert.notEqual(start, -1, "the two modes no longer render differently");
    const recomputingBranch = staleGate.slice(start, staleGate.indexOf(") : (", start));
    assert.doesNotMatch(
      recomputingBranch,
      /onClick=\{onRerun\}/,
      "the recomputing veil offers a rerun for a run that is already on its way",
    );
  });

  it("page.tsx only claims recomputing when a sweep is genuinely coming", () => {
    assert.match(
      page,
      /const sweepIncoming = autoRun && !inspect && !error;/,
      "sweepIncoming no longer accounts for Auto being off, a drill-down, or a failed run — "
        + "any of which means nothing is on its way and the veil must ask instead",
    );
    assert.match(page, /mode=\{sweepIncoming \? "recomputing" : "stale"\}/);
  });

  it("a failed run drops back to the hard-stale path", () => {
    // `error` feeds sweepIncoming, and the failed request must not keep
    // satisfying the sameRequest short-circuit or a retry would be skipped.
    assert.match(page, /lastRunRequest\.current = null;/);
  });

  it("every research gate carries the mode", () => {
    const gates = page.match(/<StaleGate/g)?.length ?? 0;
    const moded = page.match(/mode=\{sweepIncoming \? "recomputing" : "stale"\}/g)?.length ?? 0;
    assert.equal(moded, gates, `${gates} StaleGates but only ${moded} carry a mode`);
  });
});

// --------------------------------------------------------------------------
// The dedupe behaviour the source assertions above depend on
// --------------------------------------------------------------------------

function response(request: SweepRequest): SweepResponse {
  // Only the fields addExperiment/toRecord read. The rest of SweepResponse is
  // irrelevant to identity, which is the property under test.
  return {
    request,
    best: { fast: request.fastMin, slow: request.slowMin, sharpe: 1, totalReturn: 0.1, maxDrawdown: -0.1 },
    verdict: { level: "fail" },
    combosTested: 1,
  } as unknown as SweepResponse;
}

describe("sameRequest is what makes the three commit paths idempotent", () => {
  it("an unchanged request is the same request", () => {
    assert.equal(sameRequest(DEFAULT_REQUEST, { ...DEFAULT_REQUEST }), true);
  });

  it("one changed parameter is a different request", () => {
    assert.equal(
      sameRequest(DEFAULT_REQUEST, { ...DEFAULT_REQUEST, fastMin: DEFAULT_REQUEST.fastMin + 1 }),
      false,
    );
  });

  it("a re-run replaces its record, but a changed sweep does not", () => {
    // This is the whole reason auto-runs must not record: the dedupe key is the
    // request, and every auto-run has a different one.
    const first = addExperiment([], response(DEFAULT_REQUEST), 1);
    const rerun = addExperiment(first, response(DEFAULT_REQUEST), 2);
    assert.equal(rerun.length, 1, "an identical re-run should replace, not append");

    let trail = rerun;
    for (let fastMin = 6; fastMin <= 15; fastMin++) {
      trail = addExperiment(trail, response({ ...DEFAULT_REQUEST, fastMin }), fastMin);
    }
    assert.equal(
      trail.length,
      11,
      "ten distinct parameter sets append ten rows — which is exactly what one slider "
        + "drag would do if auto-runs were recorded",
    );
  });
});
