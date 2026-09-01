/** Interaction contracts for the restored Diffusion drawings. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  clockPathIsMaterial,
  clockRowsForMode,
  rankByClock,
} from "../components/coherence/diffusion/ClockAgreement";
import { filterCalendarRuns } from "../components/coherence/diffusion/MeetingCalendar";
import { survivalAt } from "../components/coherence/diffusion/KalshiArm";
import { qualifyingEvidence } from "../components/coherence/diffusion/EffectField";
import { returnFanPathsForMode } from "../components/coherence/diffusion/ReturnFan";
import type { Finding } from "../components/coherence/diffusion/types";
import { absorption, findings } from "./helpers/coherence-fallback-diffusion";
import { runPaths } from "../lib/coherence/return-path";
import { read, stripNonCode } from "./helpers/workspace-sources";

const controlRank = read("../components/coherence/diffusion/ControlRank.tsx");
const absorptionCurve = read("../components/coherence/diffusion/AbsorptionCurve.tsx");
const returnFan = read("../components/coherence/diffusion/ReturnFan.tsx");
const informationPane = read("../components/coherence/diffusion/InformationDiffusionPane.tsx");
const clock = read("../components/coherence/diffusion/ClockAgreement.tsx");
const calendar = read("../components/coherence/diffusion/MeetingCalendar.tsx");
const kalshi = read("../components/coherence/diffusion/KalshiArm.tsx");
const effect = read("../components/coherence/diffusion/EffectField.tsx");
const matrix = read("../components/coherence/diffusion/EvidenceMatrix.tsx");
const floorDistance = read("../components/coherence/diffusion/FloorDistance.tsx");
const horizonResolution = read("../components/coherence/diffusion/HorizonResolution.tsx");
const diffusionStyles = read("../app/globals/14zzc-diffusion-workbench.css")
  + read("../app/globals/14zzh-interface-density.css");
const diffusionFigures = read("../app/globals/10c-diffusion-figures.css");
const diffusionMarks = read("../app/globals/10k-diffusion-marks.css");

describe("restored Diffusion drawings remain keyboard-readable", () => {
  it("keeps each ranked run as its own named mark with collision-safe stacking", () => {
    assert.match(controlRank, /row\.ranked\.map\(\(run\) =>/);
    assert.match(controlRank, /key=\{run\.run_id\}/);
    assert.match(controlRank, /run\.source_ref[\s\S]*?run\.symbol/);
    assert.match(controlRank, /const seen = new Map<number, number>/);
    assert.match(controlRank, /seen\.set\(key, stack \+ 1\)/);
    assert.doesNotMatch(controlRank, /index % 3/);
  });

  it("keeps a Plot instrument and an honest framed sparse state in every restored view", () => {
    for (const [name, source] of [
      ["clocks", clock],
      ["calendar", calendar],
      ["Kalshi episodes", kalshi],
      ["findings field", effect],
      ["findings matrix", matrix],
    ] as const) {
      const code = stripNonCode(source);
      assert.match(code, /<Plot\b/, `${name} lost its technical drawing`);
    }
    for (const [name, source] of [
      ["clocks", clock],
      ["calendar", calendar],
      ["findings field", effect],
    ] as const) {
      assert.match(stripNonCode(source), /<DiffusionSparseState\b/, `${name} lost its connected sparse state`);
    }
    for (const [name, source] of [["Kalshi episodes", kalshi], ["findings matrix", matrix]] as const) {
      assert.match(stripNonCode(source), /<FigureEmpty\b/, `${name} lost its framed empty state`);
    }
  });

  it("adds flat local controls without replacing the restored drawing bodies", () => {
    const restored = [absorptionCurve, returnFan, controlRank, clock, calendar, kalshi, effect, matrix].join("\n");
    assert.match(restored, /clockRowsForMode/);
    assert.match(restored, /filterCalendarRuns/);
    assert.match(restored, /survivalAt/);
    assert.match(restored, /qualifyingEvidence/);
    for (const label of [
      "Absorption lines", "Measured return paths", "Probe lifetime", "Minimum absolute t",
      "Maximum shuffled p", "Calendar sample", "Clock paths",
    ]) {
      assert.match(restored, new RegExp(`aria-label="${label}"`));
    }
    assert.match(controlRank, /aria-label="Control percentile stages"/);
    assert.match(restored, /aria-pressed=/);
  });

  it("restores the announcement spread without adding a card shadow", () => {
    assert.match(absorptionCurve, /absorptionBand/);
    assert.match(absorptionCurve, /diff-curve__band--release/);
    assert.match(absorptionCurve, /diff-curve__band--call/);
    assert.match(diffusionFigures, /diff-curve__band--release/);
  });

  it("keeps every Diffusion control flat and phone reachable", () => {
    const shadows = [...diffusionStyles.matchAll(/box-shadow:\s*([^;]+)/g)].map((match) => match[1].trim());
    assert.ok(shadows.length > 0);
    assert.ok(shadows.every((value) => value === "none"), `unexpected Diffusion shadow: ${shadows.join(", ")}`);
    assert.doesNotMatch(diffusionStyles, /drop-shadow\s*\(/);
    assert.match(diffusionStyles, /min-block-size:\s*44px/);
    assert.match(
      diffusionMarks,
      /@media \(max-width: 700px\)[\s\S]*\.diff-thresh__legend-group li > span:last-child[\s\S]*white-space: normal/,
      "the long Findings requirement state must wrap instead of widening the phone plot",
    );
  });

  it("places the compact inspection rail below the Diffusion drawing", () => {
    assert.match(diffusionStyles, /\.diffusion-plane \.coh-figure__plot \{ order: 1; \}/);
    assert.match(
      diffusionStyles,
      /\.diffusion-plane \.coh-figure__interaction[\s\S]*--interaction-row-size:[\s\S]*order: 2;/,
      "the reserved readout must not reopen a blank band between the caption and the diagram",
    );
    assert.match(diffusionStyles, /\.coh-figure__interaction > span:last-child[\s\S]*text-overflow: ellipsis/);
  });

  it("names every Diffusion plot that becomes a phone scroll region", () => {
    for (const [name, source, label] of [
      ["absorption lines", absorptionCurve, "Absorption lines diagram"],
      ["return paths", returnFan, "Measured return paths"],
      ["control percentile", controlRank, "Control percentile diagram"],
      ["noise-floor distance", floorDistance, "Noise-floor distance diagram"],
      ["horizon resolution", horizonResolution, "Horizon resolution diagram"],
    ] as const) {
      assert.match(source, new RegExp(`scrollLabel="${label}"`), `${name} scroll region has no accessible name`);
    }
  });

  it("reserves each Arm view only while a browser-refresh read is pending", () => {
    assert.match(informationPane, /const pending = read === null && error === null/);
    assert.match(informationPane, /data-arm-loading=\{pending \? view : undefined\}/);
    assert.match(informationPane, /aria-busy=\{pending \|\| undefined\}/);
    for (const view of ["absorption", "floor", "clocks"]) {
      assert.match(diffusionStyles, new RegExp(`data-arm-loading="${view}"`));
    }
    assert.match(diffusionStyles, /@media \(max-width: 600px\)[\s\S]*data-arm-loading="absorption"/);
  });
});

describe("Diffusion filters preserve the wire data while changing the visible subset", () => {
  it("switches Clock paths by main/background style without reranking either stage", () => {
    for (const stage of ["release", "call"] as const) {
      const rows = rankByClock(absorption().runs, stage).rows;
      const solid = clockRowsForMode(rows, "solid");
      const dotted = clockRowsForMode(rows, "dotted");
      assert.equal(solid.length + dotted.length, rows.length);
      assert.ok(solid.every((row) => clockPathIsMaterial(row, rows.length)));
      assert.ok(dotted.every((row) => !clockPathIsMaterial(row, rows.length)));
      assert.ok(solid.every((row) => row.stage === stage));
      assert.ok(dotted.every((row) => row.stage === stage));
    }
    assert.match(clock, /totalRecords = runs\.length/);
    assert.match(clock, /total paths/);
  });

  it("switches calendar and return paths by the floor verdict", () => {
    const readout = absorption();
    const clearedRuns = filterCalendarRuns(readout.runs, "cleared");
    const refusedRuns = filterCalendarRuns(readout.runs, "refused");
    assert.equal(clearedRuns.length + refusedRuns.length, readout.runs.length);

    const paths = runPaths(readout.runs, readout.horizons);
    assert.equal(
      returnFanPathsForMode(paths, "solid").length + returnFanPathsForMode(paths, "dotted").length,
      paths.length,
    );
  });

  it("moves the survival and Effect thresholds without inventing observations", () => {
    const points = [{ t: 10, s: .75 }, { t: 20, s: .5 }, { t: 30, s: 0 }];
    assert.equal(survivalAt(points, 0), 1);
    assert.equal(survivalAt(points, 15), .75);
    assert.equal(survivalAt(points, 30), 0);

    const rows = findings().findings as unknown as Finding[];
    const permissive = qualifyingEvidence(rows, "all", 1, .2);
    const strict = qualifyingEvidence(rows, "all", 3, .02);
    assert.ok(permissive.length > strict.length);
    assert.ok(strict.every((row) => Math.abs(row.t_statistic ?? 0) >= 3 && (row.shuffled_p ?? 1) <= .02));
    assert.match(effect, /aria-label="Minimum absolute t" min=\{0\} max=\{tSliderMax\}/);
    assert.match(effect, /aria-label="Maximum shuffled p" min=\{0\} max=\{1\}/);
  });
});

describe("clock ranking still reflects the fallback wire data", () => {
  it("produces distinct wall and volatility orderings in both stages", () => {
    for (const stage of ["release", "call"] as const) {
      const ranked = rankByClock(absorption().runs, stage).rows;
      assert.ok(ranked.length >= 2);
      assert.ok(ranked.some((row) => row.wallRank !== row.volRank));
    }
  });
});
