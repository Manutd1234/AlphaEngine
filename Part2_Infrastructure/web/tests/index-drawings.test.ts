/**
 * The Coherence index draws its scale, and draws its absences.
 *
 * Ian: "Coherence index has no diagrams and no technical terms included, fix
 * this pls." Both halves were true in a specific way worth writing down.
 *
 * NO SCALE. The lanes were drawn against a shared peak and the peak was
 * nowhere on the figure: a reader could see one lane sitting higher than
 * another and had no way to read either as a number. The distance IS the
 * subject, so it now has an axis — nought at the baseline, the shared peak at
 * the top of every lane, and a dashed line at half of it.
 *
 * NO DRAWING WHERE IT MATTERS MOST. Both figures fell back to a sentence on
 * exactly the reads that need a picture: a watchlist whose polls all failed to
 * measure, and a family with one reading. A record of the recorder RUNNING and
 * failing to measure is a different fact from an empty record, and only a
 * drawing distinguishes them.
 *
 * THE TERMS. The estimator is the venue-shape decision behind every reading —
 * isotonic, mid sum, ask side — and it decided the number a reader is looking
 * at. It was in the notes and nowhere a reader meets first.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { read, stripNonCode } from "./helpers/workspace-sources";

const chart = read("../components/coherence/IndexSeriesChart.tsx");
const ridge = read("../components/coherence/FamilyRidge.tsx");
const pane = read("../components/coherence/IndexPane.tsx");

describe("the lanes are drawn against an axis a reader can read", () => {
  it("reserves a gutter for the scale rather than starting at the frame", () => {
    const margin = chart.match(/const MARGIN = \{ top: \d+, right: \d+, bottom: \d+, left: (\d+) \}/);
    assert.ok(margin, "the chart's margins are gone");
    assert.ok(Number(margin[1]) >= 24,
      `the left margin is ${margin[1]}px, which is not a gutter — a tick drawn there sits under the line`);
  });

  it("labels nought and the shared peak, and rules the half", () => {
    assert.match(chart, /coh-indexlane__scale/, "the lanes carry no scale marks");
    assert.match(chart, /fromCenticents\(peak\)/, "the peak the lanes are scaled to is never printed");
    assert.match(chart, /coh-indexlane__half/, "there is no rule between nought and the peak");
  });

  it("says the scale is shared, because that is what makes two lanes comparable", () => {
    assert.match(chart, /same scale|shared|one axis/i,
      "nothing tells a reader the lanes may be compared");
  });
});

describe("an absence is drawn, not written", () => {
  it("the chart draws the polls it could not measure", () => {
    const branch = chart.slice(chart.indexOf("if (!lanes.length || !measured.length)"), chart.indexOf("// ONE scale"));
    assert.ok(branch.length > 200, "the unmeasurable branch is no longer where this reads it");
    assert.match(branch, /<Plot/, "the branch still falls back to a sentence with no drawing");
    assert.match(branch, /diff-hatch/, "an unmeasurable poll is not drawn as a refused reading");
    assert.match(branch, /missing=/, "the drawing does not say why nothing could be measured");
  });

  it("the ridge draws one reading as one reading, rather than refusing to draw", () => {
    const branch = ridge.slice(ridge.indexOf("if (!drawn.length || stamps.length < 2)"), ridge.indexOf("const height ="));
    assert.ok(branch.length > 200, "the one-poll branch is no longer where this reads it");
    assert.match(branch, /<Plot/, "a family with one reading still gets a sentence instead of a mark");
    assert.match(branch, /not a lane/i, "the drawing no longer says why a single poll has no shape");
  });

  it("neither branch invents a value for what it could not measure", () => {
    /**
     * A RATCHET WITH REASONS, not a ban, because `?? 0` has three legitimate
     * shapes in these two files and none of them is a nullable metric rendered
     * as zero — which is the defect the house rule is about. A counter's first
     * increment, a map lookup's index, and a peak contributing nothing to a
     * maximum that already floors at 1 are all arithmetic, not readings. Every
     * one is named here, so a fourth cannot arrive unexamined.
     */
    const ALLOW: Record<string, { count: number; reason: string }> = {
      chart: { count: 1, reason: "a tally's first increment" },
      ridge: { count: 3, reason: "an ordinal lookup, and two peaks contributing nothing to a max floored at 1" },
    };
    for (const [name, source] of [["chart", chart], ["ridge", ridge]] as const) {
      const found = (stripNonCode(source).match(/\?\? 0\b/g) ?? []).length;
      assert.equal(found, ALLOW[name].count,
        `${name} has ${found} \`?? 0\` where ${ALLOW[name].count} are allowed (${ALLOW[name].reason}) — `
        + "a new one is a missing reading drawn as zero until it is named here");
    }
    // And the thing the rule is actually about: nothing a reader SEES is
    // coerced. Every rendered reading in either file goes through
    // `fromCenticents`, which answers null with a dash of its own.
    for (const [name, source] of [["chart", chart], ["ridge", ridge]] as const) {
      assert.doesNotMatch(source, /\{[^}]*\?\? 0\}/, `${name} renders a coerced zero`);
    }
  });
});

describe("the estimator is named where a reader meets it", () => {
  it("the pane chips the estimators the record was built with", () => {
    assert.match(pane, /word="Estimators"/, "the estimator count is not on the chip row");
    assert.match(pane, /mark="◇"/, "the chip carries no mark");
  });

  it("the chip counts DISTINCT estimators over the record, not points", () => {
    assert.match(stripNonCode(pane), /new Set\(data\.points\.map\(\(point\) => point\.engine\)\)/,
      "the estimator chip counts something other than the distinct estimators");
  });
});
