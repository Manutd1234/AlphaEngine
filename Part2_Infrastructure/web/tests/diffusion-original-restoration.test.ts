/** Contracts for the original Diffusion instrument restored from 6b7c31c. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { rankByClock } from "../components/coherence/diffusion/ClockAgreement";
import { absorption } from "./helpers/coherence-fallback-diffusion";
import { read, stripNonCode } from "./helpers/workspace-sources";

const pane = read("../components/coherence/diffusion/InformationDiffusionPane.tsx");
const curve = read("../components/coherence/diffusion/AbsorptionCurve.tsx");
const fan = read("../components/coherence/diffusion/ReturnFan.tsx");
const marks = read("../app/globals/10k-diffusion-marks.css");
const meetings = read("../components/coherence/diffusion/MeetingsSection.tsx");
const control = read("../components/coherence/diffusion/DiffusionViewControl.tsx");
const clock = read("../components/coherence/diffusion/ClockAgreement.tsx");
const calendar = read("../components/coherence/diffusion/MeetingCalendar.tsx");
const kalshi = read("../components/coherence/diffusion/KalshiArm.tsx");
const effect = read("../components/coherence/diffusion/EffectField.tsx");
const matrix = read("../components/coherence/diffusion/EvidenceMatrix.tsx");
const spectrum = read("../components/coherence/diffusion/model/SpectrumExplorer.tsx");

describe("the original Diffusion figure graph", () => {
  it("keeps AbsorptionCurve before ReturnFan and folds the additive audit", () => {
    const absorptionAt = pane.indexOf("<AbsorptionCurve");
    const fanAt = pane.indexOf("<ReturnFan");
    const auditAt = pane.indexOf("<AbsorptionWorkbench");

    assert.ok(absorptionAt >= 0, "the original absorption curve is missing");
    assert.ok(fanAt > absorptionAt, "the path fan no longer follows the absorption curve");
    assert.ok(auditAt > fanAt, "the additive estimator audit interrupts the two original figures");
    assert.match(pane, /<details className="disclosure diff-absorption-audit">/);
    assert.match(pane, /<summary>Exact estimator audit<\/summary>/);
    assert.doesNotMatch(pane, /<details[^>]*\sopen(?:=|\s|>)/,
      "the estimator audit is visible by default");
  });

  it("keeps the original absorption lines, selection and their middle-half shadows", () => {
    const code = stripNonCode(curve);
    assert.match(curve, /diff-curve__band--release/);
    assert.match(curve, /diff-curve__band--call/);
    assert.match(curve, /aria-label="Absorption lines"/);
    assert.match(code, /sharedX={/);
    assert.match(curve, /diff-curve__half/);
    assert.match(curve, /diff-curve__release/);
    assert.match(curve, /diff-curve__call/);
    assert.match(code, /<XAxis\b/);
    assert.doesNotMatch(code, /crossingOrdinal|crossingMark|AbsorptionWorkbenchEvidence/);
  });

  it("keeps the full horizon domain and its leading hatched evidence span", () => {
    const code = stripNonCode(fan);
    assert.match(code, /index\s*\/\s*\(horizons\.length\s*-\s*1\)/,
      "the fan no longer uses the complete horizon domain");
    assert.match(code, /width=\{Math\.max\(0, x\(firstMeasured\) - left\)\}/,
      "the 1s and 30s missing interval is not a quantitative hatch");
    assert.match(fan, /horizons\.slice\(0, firstMeasured\)\.join\(" and "\)/);
    assert.doesNotMatch(code, /returnFanXFraction|diff-fan__missing-label/,
      "the missing interval is still compressed into a small legend token");
  });

  it("renders the leading span as named older history instead of a white card", () => {
    const code = stripNonCode(fan);
    assert.match(fan, /<rect\s+className="diff-fan__unmeasured-ground"/,
      "the transparent hatch has no grey ground beneath it");
    assert.match(marks, /\.diff-fan__unmeasured-ground\s*\{[^}]*fill:\s*color-mix\(in srgb, var\(--surface-2\)[^}]*var\(--text-muted\)/s,
      "the historical ground has regressed to plot-paper white");
    assert.match(fan, /<text\s+className="diff-fan__history-label"/,
      "the historical gap has no visible label");
    assert.match(code, />older<\/tspan>[\s\S]*?>history<\/tspan>/,
      "the older-history label is not stacked inside the narrow measured span");
    assert.match(code, /const historyRange = firstMeasured > 1/,
      "the visible range is hand-written rather than derived from the horizon domain");
    assert.match(fan, /<rect\s+className="diff-fan__unmeasured"[\s\S]*?<title>/,
      "the grey historical span is not part of the plot's keyboard mark walk");
  });

  it("keeps the original Control, Clocks, Calendar and Mechanism order", () => {
    const floorAt = pane.indexOf("<FloorDistance");
    const rankAt = pane.indexOf("<ControlRank");
    assert.ok(floorAt >= 0 && rankAt > floorAt, "Control lost its paired figure order");
    assert.match(pane, /view === "clocks"[\s\S]*?<ClockAgreement/);
    assert.match(meetings, /view === "calendar"[\s\S]*?<MeetingCalendar/);
    const windowsAt = meetings.indexOf("<StageWindows");
    const resolutionAt = meetings.indexOf("<HorizonResolution");
    assert.ok(windowsAt >= 0 && resolutionAt > windowsAt, "Mechanism lost windows-then-resolution order");
  });

  it("does not replace a protected figure with a generic lifecycle drawing", () => {
    for (const file of [
      "InformationDiffusionPane", "ReturnFan", "FloorDistance", "ControlRank",
      "ClockAgreement", "MeetingCalendar", "HorizonResolution",
    ]) {
      assert.doesNotMatch(
        stripNonCode(read(`../components/coherence/diffusion/${file}.tsx`)),
        /DiffusionSparseState/,
        `${file} still substitutes the generic three-step lifecycle`,
      );
    }
  });

  it("uses the original pressed-button control while retaining controlled state", () => {
    assert.doesNotMatch(control, /ToggleGroup/);
    assert.match(control, /role="group"/);
    assert.match(control, /aria-pressed=\{value === name\}/);
    assert.match(control, /onClick=\{\(\) => onValueChange\(name\)\}/);
  });

  it("keeps the original diagram bodies and restores additive interaction", () => {
    assert.match(clock, /diff-clock__link--\$\{row\.stage\}/);
    assert.match(calendar, /diff-cal__rug/);
    assert.match(kalshi, /coh-survival__step/);
    assert.match(effect, /className="diff-band"/);
    assert.match(matrix, /diff-matrix__bar--\$\{stage\}/);
    assert.match(spectrum, /className="coh-model__area"/);

    const restored = [clock, calendar, kalshi, effect, matrix, spectrum].join("\n");
    assert.match(restored, /clockRowsForMode/);
    assert.match(restored, /filterCalendarRuns/);
    assert.match(restored, /survivalAt/);
    assert.match(restored, /qualifyingEvidence/);
    assert.match(restored, /aria-label="Clock paths"/);
    assert.match(restored, /aria-label="Calendar sample"/);
    assert.match(restored, /aria-label="Probe lifetime"/);
    assert.match(restored, /aria-label="Minimum absolute t"/);
    assert.doesNotMatch(spectrum, /data-spectrum-pair/);
  });
});

describe("the serverless Diffusion fallback matches the original wire shape", () => {
  it("provides eight horizons with truthful null 1s and 30s cells", () => {
    const payload = absorption();
    assert.deepEqual(payload.horizons, ["1s", "30s", "1m", "2m", "5m", "10m", "15m", "30m"]);
    assert.equal(payload.backend, "sandbox");
    assert.deepEqual(payload.release_curve.slice(0, 2), [null, null]);
    assert.deepEqual(payload.call_curve.slice(0, 2), [null, null]);
    assert.equal(payload.release_curve.length, 8);
    assert.equal(payload.call_curve.length, 8);

    for (const run of payload.runs) {
      assert.equal(run.of_horizons, 8);
      assert.equal(run.measured_horizons, 6);
      assert.equal(run.controls_used > 0, true);
      assert.deepEqual(run.cells.slice(0, 2).map((cell) => ({
        state: cell.state,
        abnormal_return: cell.abnormal_return,
        absorbed: cell.absorbed,
        bars: cell.bars,
      })), [
        { state: "unavailable", abnormal_return: null, absorbed: null, bars: null },
        { state: "unavailable", abnormal_return: null, absorbed: null, bars: null },
      ]);
    }
  });

  it("produces non-degenerate statement and conference clock rankings", () => {
    const payload = absorption();
    for (const stage of ["release", "call"] as const) {
      const ranked = rankByClock(payload.runs, stage);
      assert.ok(ranked.rows.length >= 2, `${stage} has no drawable clock panel`);
      assert.ok(ranked.rows.some((row) => row.wallRank !== row.volRank),
        `${stage} fallback draws identical wall and volatility rankings`);
    }
  });
});

describe("Diffusion remains a live component instrument", () => {
  it("does not substitute historical screenshots", () => {
    const sources = [pane, curve, fan, meetings].join("\n");
    assert.doesNotMatch(sources, /diffusion-now|s4-fan2|s6-watch|s7-head|\.png/i);
  });
});
