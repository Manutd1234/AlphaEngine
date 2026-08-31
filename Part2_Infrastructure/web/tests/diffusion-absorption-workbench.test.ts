/**
 * The absorption curve is one instrument over the payload it already owns.
 *
 * These tests pin the two ways this workbench could become misleading: a
 * browser-rebuilt mean replacing the gateway aggregate, or an unresolved
 * half-life being drawn as a number. The source checks then hold the wiring to
 * the restored per-mark interaction and no request on inspection.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  absorptionWorkbenchEvidence,
  crossingOrdinal,
  horizonSeconds,
} from "../lib/coherence/absorption-workbench";
import type {
  HorizonCell,
  SignalState,
  StageRun,
} from "../components/coherence/diffusion/types";
import { read, stripNonCode } from "./helpers/workspace-sources";

const curve = read("../components/coherence/diffusion/AbsorptionCurve.tsx");
const pane = read("../components/coherence/diffusion/InformationDiffusionPane.tsx");
const workbench = read("../components/coherence/diffusion/AbsorptionWorkbench.tsx");
const helper = read("../lib/coherence/absorption-workbench.ts");

function cell(
  horizon: string,
  absorbed: number | null,
  state: HorizonCell["state"] = "ok",
  reason: string | null = null,
): HorizonCell {
  return {
    horizon,
    state,
    abnormal_return: absorbed,
    absorbed,
    bars: absorbed == null ? null : 1,
    reason,
  };
}

function run(
  runId: string,
  stage: StageRun["stage"],
  signalState: SignalState,
  cells: HorizonCell[],
): StageRun {
  return {
    run_id: runId,
    source_ref: `fed:${runId}`,
    symbol: "SPY",
    stage,
    interval: "1m",
    signal_state: signalState,
    signal_reason: signalState === "ok" ? null : "terminal move below the floor",
    t0: "2026-01-01T14:00:00Z",
    terminal_return: signalState === "ok" ? 0.01 : null,
    half_life_s: null,
    half_life_state: null,
    half_life_vol: null,
    control_percentile: null,
    sigma_pre_per_bar: null,
    terminal_sigmas: null,
    controls_used: 0,
    measured_horizons: cells.filter((row) => row.absorbed != null).length,
    of_horizons: cells.length,
    market_adjusted: false,
    data_hash: null,
    params_version: "test",
    cells,
  };
}

const horizons = ["30s", "1m", "2m", "5m"];
const runs: StageRun[] = [
  run("r1", "release", "ok", [
    cell("30s", null, "unavailable", "no free bar source"),
    cell("1m", 0.1), cell("2m", 0.5), cell("5m", null, "insufficient", "too few bars"),
  ]),
  run("r2", "release", "ok", [
    cell("30s", null, "unavailable", "no free bar source"),
    cell("1m", 0.3), cell("2m", 0.7), cell("5m", null, "pending", "window still open"),
  ]),
  // Deliberately carries values: the band must still exclude it because the
  // stage failed the signal gate.
  run("r3", "release", "no_signal", horizons.map((horizon) => cell(horizon, 0.99))),
  run("c1", "call", "ok", [
    cell("30s", null, "unavailable", "no free bar source"),
    cell("1m", 0.05), cell("2m", 0.35), cell("5m", 0.65),
  ]),
  run("c2", "call", "ok", [
    cell("30s", null, "unavailable", "no free bar source"),
    cell("1m", 0.15), cell("2m", 0.45), cell("5m", 0.75),
  ]),
];

describe("the exact workbench evidence", () => {
  it("parses the wire's horizon units without inventing a value for an unknown label", () => {
    assert.equal(horizonSeconds("30s"), 30);
    assert.equal(horizonSeconds("2m"), 120);
    assert.equal(horizonSeconds("1.5h"), 5_400);
    assert.equal(horizonSeconds("0m"), null);
    assert.equal(horizonSeconds("closing bell"), null);
  });

  it("keeps the payload mean and gives its run-cell spread an exact population", () => {
    const evidence = absorptionWorkbenchEvidence(
      horizons,
      [null, 0.25, 0.65, null],
      [null, 0.1, 0.4, 0.7],
      runs,
    );
    const oneMinute = evidence.rows[1];

    // The two accepted run cells average to 0.20; 0.25 proves this is the
    // payload aggregate and was not silently rebuilt in the browser.
    assert.equal(oneMinute.release.mean, 0.25);
    assert.equal(oneMinute.release.band.n, 2);
    assert.equal(oneMinute.release.band.p25, 0.15);
    assert.equal(oneMinute.release.band.p75, 0.25);
    assert.doesNotMatch(oneMinute.release.provenance, /3 floor-cleared/);
  });

  it("keeps a missing horizon missing, together with the recorded reason and refusal", () => {
    const evidence = absorptionWorkbenchEvidence(horizons, [null, 0.25, 0.65, null], [null, 0.1, 0.4, 0.7], runs);
    assert.equal(evidence.rows[0].release.mean, null);
    assert.equal(evidence.rows[0].release.band.n, 0);
    assert.match(evidence.rows[0].release.provenance, /payload has no mean/);
    assert.match(evidence.rows[0].release.provenance, /no source/);
    assert.match(evidence.rows[0].release.provenance, /refused before aggregation/);
  });

  it("uses the parity-tested crossing and locates it between its recorded horizons", () => {
    const evidence = absorptionWorkbenchEvidence(horizons, [null, 0.25, 0.65, null], [null, 0.1, 0.4, 0.7], runs);
    assert.equal(evidence.crossings.release.state, "ok");
    assert.ok((evidence.crossings.release.value ?? 0) > 60);
    assert.ok((evidence.crossings.release.value ?? 999) < 120);
    const ordinal = crossingOrdinal(evidence.crossings.release, evidence.seconds);
    assert.ok(ordinal != null && ordinal > 1 && ordinal < 2);
  });

  it("preserves every unresolved crossing state rather than drawing a fallback number", () => {
    const refused = absorptionWorkbenchEvidence(
      ["1m", "2m", "5m"],
      [0.1, 0.2, 0.3],
      [0.6, 0.8, 0.9],
      [],
    );
    assert.equal(refused.crossings.release.state, "never_reached");
    assert.equal(refused.crossings.call.state, "at_or_before_first");
    assert.equal(crossingOrdinal(refused.crossings.release, refused.seconds), null);
    assert.equal(crossingOrdinal(refused.crossings.call, refused.seconds), null);

    const sparse = absorptionWorkbenchEvidence(["1m", "2m"], [null, 0.6], [null, null], []);
    assert.equal(sparse.crossings.release.state, "too_few_points");
  });
});

describe("one local interaction over the existing read", () => {
  it("uses one selectable shared-horizon instrument, including measured gaps", () => {
    const code = stripNonCode(curve);
    assert.match(code, /<Plot[\s\S]*?height=\{HEIGHT\}[\s\S]*?minWidth=\{300\}[\s\S]*?scrollLabel=/);
    assert.match(code, /sharedX=\{/);
    assert.equal((code.match(/<title>/g) ?? []).length, 0);
    assert.match(curve, /label: "Statement"/);
    assert.match(curve, /label: "Press conference"/);
    assert.match(curve, /label: "Resolution"/);
    assert.match(curve, /aria-label="Absorption lines"/);
    assert.match(curve, /diff-curve__band--release/);
    assert.match(curve, /diff-curve__band--call/);
    assert.match(curve, /absorptionBand/);
  });

  it("keeps the original half threshold and ordinal horizon marks without estimator overlays", () => {
    assert.match(curve, /diff-curve__half/);
    assert.doesNotMatch(stripNonCode(curve), /crossingOrdinal|crossingMark|AbsorptionWorkbenchEvidence/);
    assert.match(stripNonCode(curve), /horizons\.map\(/);
  });

  it("uses the existing estimator; local selection adds no request or synthetic series", () => {
    assert.match(stripNonCode(helper), /halfLife\(/);
    assert.doesNotMatch(stripNonCode(helper), /function halfLife/);
    for (const source of [curve, workbench, helper]) {
      assert.doesNotMatch(
        stripNonCode(source),
        /\bfetch\(|useCoherenceRead|useEffect\(|Math\.random|crypto\.randomUUID|Date\.now|setInterval\(|setTimeout\(/,
      );
    }
    assert.match(stripNonCode(curve), /\buseState(?:<[^>]+>)?\(/);
    for (const source of [workbench, helper]) assert.doesNotMatch(stripNonCode(source), /\buseState\(/);
    assert.match(pane, /<AbsorptionCurve[\s\S]*?horizons=\{read\.horizons\}/);
    assert.match(pane, /<ReturnFan[\s\S]*?<details className="disclosure diff-absorption-audit">[\s\S]*?<summary>Exact estimator audit<\/summary>[\s\S]*?<AbsorptionWorkbench/);
    assert.doesNotMatch(pane, /<details[^>]*\sopen(?:=|\s|>)/);
  });

  it("keeps exact means, spread, counts and provenance in one accessible table", () => {
    assert.match(workbench, /className="table-wrap"[\s\S]*?tabIndex=\{0\}[\s\S]*?role="region"/);
    assert.match(workbench, /<caption className="coh-table__caption">/);
    for (const heading of ["Payload mean", "Middle 50%", "Cells", "Record provenance"]) {
      assert.match(workbench, new RegExp(`>${heading}<`));
    }
    assert.doesNotMatch(stripNonCode(workbench), /\?\? 0|\|\| 0/);
  });
});
