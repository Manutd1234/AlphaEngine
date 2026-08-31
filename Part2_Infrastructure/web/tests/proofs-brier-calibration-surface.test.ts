import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  calibrationMetrics,
  calibrationSurfaceBins,
} from "../lib/coherence/brier-calibration-surface";
import type { CoherenceCalibration, CoherenceReliabilityBin } from "../lib/coherence/types-lab";

const root = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

const BINS: CoherenceReliabilityBin[] = [
  {
    label: "0.0–0.1", low: "0", high: "0.1", count: 12,
    mean_forecast: "0.07000000", outcome_rate: "0.08333333", deviation: "0.01333333",
  },
  {
    label: "0.1–0.2", low: "0.1", high: "0.2", count: 0,
    mean_forecast: null, outcome_rate: null, deviation: null,
  },
  {
    label: "0.2–0.3", low: "0.2", high: "0.3", count: 3,
    mean_forecast: "NaN", outcome_rate: "Infinity", deviation: null,
  },
];

const CALIBRATION: CoherenceCalibration = {
  state: "available",
  engine: "tape",
  count: 15,
  base_rate: "0.40000000",
  brier: "0.170000001",
  reliability: "0.020000001",
  resolution: "0.030000001",
  uncertainty: "0.160000001",
  binning: "0.020000001",
  skill: "0.29166666",
  bias_slope: null,
  bias_by_series: [],
  median_horizon_s: 3600,
  horizon_s: 3600,
  thin: true,
  bins: BINS,
  isotonic_map: [],
  composition: [],
  detail: "",
};

describe("the Brier surface is only another view of the calibration payload", () => {
  it("preserves bin order, exact display strings, counts, and missing states", () => {
    const rows = calibrationSurfaceBins(BINS);
    assert.deepEqual(rows.map((row) => row.label), BINS.map((bin) => bin.label));
    assert.deepEqual(rows.map((row) => row.state), ["point", "empty", "unavailable"]);
    assert.equal(rows[0].count, 12);
    assert.equal(rows[0].forecastText, "0.070000");
    assert.equal(rows[0].observedText, "0.083333…");
    assert.equal(rows[0].deviationText, "0.013333…");
    assert.match(rows[1].readout, /no settled markets/);
    assert.match(rows[2].readout, /unavailable, so no point is drawn/);
    assert.doesNotMatch(rows.map((row) => row.readout).join(" "), /NaN|Infinity/);
  });

  it("prints the returned Brier identity without deriving a replacement", () => {
    const metrics = calibrationMetrics(CALIBRATION);
    assert.deepEqual(metrics.map((metric) => metric.label), [
      "Brier", "Reliability", "Resolution", "Uncertainty", "Binning",
    ]);
    assert.deepEqual(metrics.map((metric) => metric.role), [
      "total", "add", "subtract", "add", "add",
    ]);
    assert.deepEqual(metrics.map((metric) => metric.value), [
      "0.17000000…", "0.02000000…", "0.03000000…", "0.16000000…", "0.02000000…",
    ]);
  });
});

describe("the Proofs Reliability view leads with one linked inspection surface", () => {
  const pane = read("components/coherence/CalibrationPane.tsx");
  const settled = read("components/coherence/CalibrationSettled.tsx");
  const surface = read("components/coherence/BrierCalibrationSurface.tsx");
  const surfaceCode = code(surface);
  const css = read("components/coherence/BrierCalibrationSurface.module.css");

  it("mounts only on Reliability and leaves Equation, Component scale, Measures and Bands distinct", () => {
    assert.doesNotMatch(pane, /<BrierCalibrationSurface/);
    assert.match(pane, /<CalibrationSettled data=\{data\} error=\{error\} view=\{view\} \/>/);
    assert.match(settled, /view === "reliability" \? \(\s*<BrierCalibrationSurface data=\{data\} error=\{null\} \/>/);
    assert.match(read("components/coherence/CalibrationBands.tsx"), /<table className="coh-table">/);
    const score = read("components/coherence/CalibrationScore.tsx");
    assert.match(pane, /\["decomposition", "Equation"\]/);
    assert.match(pane, /\["components", "Component scale"\]/);
    assert.match(settled, /view === "decomposition" \? \(\s*<ScoreDecompositionView data=\{data\} \/>/);
    assert.match(settled, /view === "components" \? \(\s*<ScoreComponentsView data=\{data\} \/>/);
    assert.match(settled, /view === "measures" \? \(\s*<ScoreMeasuresView facts=\{scoreFacts\(data\)\} \/>/);
    assert.match(score, /export function ScoreDecompositionView[\s\S]*?<MurphyBars[\s\S]*?mode="equation"/);
    assert.match(score, /export function ScoreComponentsView[\s\S]*?<MurphyBars[\s\S]*?mode="components"/);
    assert.match(score, /export function ScoreMeasuresView[\s\S]*?<table className="coh-table">/);
  });

  it("links pointer and keyboard inspection to one precise readout", () => {
    assert.match(surface, /<QuantInspectionPair/);
    assert.equal((surface.match(/<QuantInspectionReadout\b/g) ?? []).length, 1);
    assert.match(surface, /reserveInteractionRow=\{false\}/);
    assert.match(surface, /<div className="sr-only">\s*<QuantInspectionReadout/s);
    assert.match(surface, /<Figure[\s\S]*?<SurfacePlot rows=\{rows\} \/>[\s\S]*?<QuantInspectionReadout[\s\S]*?<BinRail rows=\{rows\} \/>[\s\S]*?Exact Brier decomposition[\s\S]*?<\/Figure>/,
      "the focused portal would separate the chart from its readout, bin rail, or exact terms");
    assert.match(surface, /onPointerEnter=\{\(\) => setHot\(row\.index\)\}/);
    for (const key of ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End", "Escape"]) {
      assert.match(surface, new RegExp(key));
    }
    assert.match(surface, /role="listbox"/);
    assert.match(surface, /aria-activedescendant=/);
    assert.match(surface, /tabIndex=\{0\}/);
  });

  it("names unavailable, empty, and engine-defined thin states without fabricating data", () => {
    assert.match(surface, /state="unavailable"/);
    assert.match(surface, /state="empty"/);
    assert.match(surface, /data-sample-state="low-count"/);
    assert.match(surface, /data\.bins/);
    for (const field of ["brier", "reliability", "resolution", "uncertainty", "binning"]) {
      assert.match(read("lib/coherence/brier-calibration-surface.ts"), new RegExp(`data\\.${field}`));
    }
    assert.doesNotMatch(surfaceCode, /fetch\(|useCoherenceRead|regime|horizon|interpolat/i);
  });

  it("keeps its local boundary responsive, tokenised, and keyboard-visible", () => {
    assert.match(css, /\.plotInstrument\s*\{[^}]*overflow-x:\s*auto;[^}]*overflow-y:\s*hidden;/s);
    assert.match(css, /\.plotInstrument\s*\{[^}]*touch-action:\s*pan-x pan-y pinch-zoom;/s);
    assert.match(css, /\.plotInstrument\s*\{[^}]*max-width:\s*72rem;[^}]*margin-inline:\s*auto;/s);
    assert.match(css, /:global\(\.coh-figure-dialog\) \.plotInstrument\s*\{[^}]*max-width:\s*none;/s);
    assert.match(css, /\.plotInstrument:focus-visible/);
    assert.match(css, /\.binRail:focus-visible/);
    assert.match(css, /\.metrics\s*\{[^}]*margin-block-start:\s*var\(--space-3\)/s);
    assert.doesNotMatch(css, /\.preciseReadout/);
    assert.match(css, /@media \(max-width: 760px\)/);
    assert.match(css, /@media \(forced-colors: active\)/);
    assert.doesNotMatch(css, /#[\da-f]{3,8}\b|\brgba?\s*\(/i);
  });

  it("keeps every new source under the repository ceiling", () => {
    for (const file of [
      "components/coherence/BrierCalibrationSurface.tsx",
      "components/coherence/BrierCalibrationSurface.module.css",
      "lib/coherence/brier-calibration-surface.ts",
      "tests/proofs-brier-calibration-surface.test.ts",
    ]) {
      assert.ok(read(file).split("\n").length <= 400, `${file} crossed 400 lines`);
    }
  });
});
