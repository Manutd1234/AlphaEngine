/**
 * The drift chart, and the arithmetic trap it exists to avoid.
 *
 * The obvious chart here is a dumbbell from current weight to target weight.
 * It is wrong, and wrong in a way nobody would notice by looking: `drift` and
 * the weight pair are measured over DIFFERENT DENOMINATORS, and they part
 * company exactly when the gross cap binds — which is the state a rebalance
 * chart is most likely to be read in. The first test proves the divergence is
 * real rather than theoretical; the rest pin the chart's response to it.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildCovariance,
  proposeAllocation,
  type ReturnsBySymbol,
} from "../lib/portfolio-risk";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const chart = read("../components/portfolio/DriftBars.tsx");
const panel = read("../components/portfolio/AllocationPanel.tsx");

function proposal(limits: { maxGrossNotional?: number; maxSymbolNotional?: number } = {}) {
  const base = Array.from({ length: 80 }, (_, i) => 0.004 * (i % 2 ? 1 : -1) + 0.0006 * ((i % 7) - 3));
  const swing = Array.from({ length: 80 }, (_, i) => 0.0015 * ((i % 5) - 2) + 0.0004 * (i % 3 ? 1 : -1));
  const history: ReturnsBySymbol = {
    AAA: base,
    BBB: base.map((b, i) => 0.6 * b + 2 * swing[i]),
  };
  const model = buildCovariance(Object.keys(history), history);
  assert.ok(model);
  const positions = [
    { symbol: "BBB", signedNotional: 180_000 },
    { symbol: "AAA", signedNotional: 120_000 },
  ];
  const result = proposeAllocation(positions, model, "inverse_vol", limits);
  assert.ok(result);
  return result;
}

describe("drift and the weight pair do not measure the same thing", () => {
  it("agree while the gross cap is slack", () => {
    for (const target of proposal().targets) {
      assert.ok(
        Math.abs(target.drift - (target.targetWeight - target.currentWeight)) < 1e-9,
        `${target.symbol} disagreed with no cap in force`,
      );
    }
  });

  it("DISAGREE once the gross cap binds — which is why no dumbbell is drawn", () => {
    /**
     * `targetWeight = targetNotional / min(gross, cap)` but
     * `drift = (targetNotional - currentNotional) / gross`. With a cap below
     * current gross the denominators differ, so a span drawn from current to
     * target would not equal the drift bar beside it, on the same axis.
     */
    const capped = proposal({ maxGrossNotional: 150_000 }); // gross is 300k
    const divergent = capped.targets.filter(
      (t) => Math.abs(t.drift - (t.targetWeight - t.currentWeight)) > 1e-6,
    );
    assert.ok(
      divergent.length > 0,
      "expected the capped budget to separate drift from the weight difference",
    );
  });

  it("plots drift itself rather than recomputing it from the weights", () => {
    // Comments stripped first: the header explains this exact trap, and the
    // prose describing what not to do must not read as doing it.
    const code = chart.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(
      code,
      /targetWeight\s*-\s*.*currentWeight/,
      "the chart derived drift from the weight pair, reintroducing the denominator bug",
    );
    assert.match(code, /x\(target\.drift\)/);
  });

  it("withholds the current-to-target annotation when the cap binds", () => {
    assert.match(chart, /capBinds\s*\?\s*"—"/);
    assert.match(panel, /limits\.maxGrossNotional < active\.grossBefore/);
  });
});

describe("the axis and the band tell the truth about magnitude", () => {
  it("is symmetric, so neither side is visually favoured", () => {
    assert.match(chart, /linearScale\(-domain,\s*domain,/);
  });

  it("floors the domain at the band so an idle book still looks idle", () => {
    // Without the floor, a book entirely inside the band would have the band
    // fill the whole plot and every row would read as an outlier.
    assert.match(chart, /Math\.max\(driftBand \* 1\.25/);
  });

  it("draws the band edges as strokes, not only as a fill", () => {
    // Forced colours discards the fill; a stroked line is what the single
    // permitted high-contrast rule reaches.
    assert.match(chart, /stroke="var\(--grid\)"/);
  });

  it("gives a position exactly on target a hairline rather than nothing", () => {
    assert.match(chart, /Math\.max\(1, Math\.abs\(x\(target\.drift\) - x\(0\)\)\)/);
  });

  it("names the directions in words, not only in hue", () => {
    assert.match(chart, />\s*trim\s*</);
    assert.match(chart, />\s*add\s*</);
  });
});

describe("the panel keeps its statuses visible", () => {
  it("leaves the unbalanced-weights banner outside every disclosure", () => {
    const firstDisclosure = panel.indexOf("<details");
    assert.ok(firstDisclosure > 0);
    assert.ok(
      panel.indexOf("banner warn") < firstDisclosure,
      "the warning that trades are withheld was collapsed",
    );
  });

  it("says on the chart that trades are withheld when weights do not balance", () => {
    assert.match(chart, /trades withheld — weights sum to/);
  });

  it("forces the table open while an override is active", () => {
    // The toggle's entire effect is the inputs in that table; collapsing it
    // makes the control look inert.
    assert.match(panel, /<details className="disclosure" open=\{override\}>/);
  });
});
