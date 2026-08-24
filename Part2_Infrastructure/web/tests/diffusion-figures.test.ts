/**
 * The announcement arm's figures, and what each one refuses to draw.
 *
 * `StageBars` shows two aggregate bars per stage: how many stages cleared the
 * noise floor, and the MEDIAN percentile against matched no-news windows. Two
 * medians are a summary of a distribution, not a picture of one — and the
 * distribution is where this study's honesty lives, because "indistinguishable
 * from an ordinary half hour" is a claim about the SHAPE of that comparison.
 *
 * `FloorDistribution` draws it, and needs no new gateway data: every run in the
 * absorption payload already carries its own `control_percentile`. That matters
 * enough to pin — a figure that quietly needed a new route would have been a
 * schema change wearing a chart's clothes.
 *
 * TWO FIGURES ARE DELIBERATELY NOT ADDED, and they are pinned as absences so a
 * later reader does not "fix" them:
 *
 *  - A HALF-LIFE HISTOGRAM. The Meetings view already draws every measured
 *    statement half-life as a `ValueStrip`, meeting by meeting. A histogram of
 *    the same column is a second view of one measurement, which is the "one true
 *    statement said three times" this tab spent a pass removing.
 *  - A PLACEBO STRIP. `clock.py` runs the whole measurement on control windows
 *    as a placebo, and that is the check that would catch the pipeline measuring
 *    its own arithmetic — but the wire carries no placebo field. Drawing one
 *    would mean inventing it. Asserted here as a missing MEASUREMENT rather than
 *    a missing figure, so the day the schema gains it, this is where the note
 *    is.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { read } from "./helpers/workspace-sources";

const distribution = read("../components/coherence/diffusion/FloorDistribution.tsx");
const arm = read("../components/coherence/diffusion/InformationDiffusionPane.tsx");
const types = read("../components/coherence/diffusion/types.ts");

describe("the noise floor shows its distribution, not only two medians", () => {
  it("the figure is drawn on the floor view", () => {
    assert.match(arm, /FloorDistribution/, "the Noise floor view draws no distribution");
  });

  it("it reads a field the payload already carries, so it is a figure and not a schema change", () => {
    assert.match(types, /control_percentile: number \| null;/);
    assert.match(distribution, /control_percentile/);
    assert.doesNotMatch(
      distribution,
      /useCoherenceRead|Route\(/,
      "the distribution fetches — it is drawn from the read the arm already has",
    );
  });

  it("a run with no percentile is counted and named, never bucketed", () => {
    // The house rule at its sharpest: a null is not a zero, and a run whose
    // matched windows never cleared the floor has NO percentile rather than a
    // percentile of nought. Bucketing it at zero would put it at "faster than
    // every no-news window", which is the opposite of what it means.
    assert.match(distribution, /null/, "nulls are not handled at all");
    assert.match(
      distribution,
      /no matched window|not ranked|unranked/i,
      "a run without a percentile must say WHY it has none",
    );
  });

  it("the half-way line is drawn and is labelled in the vocabulary the tab already uses", () => {
    // 0.5 is the whole reading: it is where a stage is indistinguishable from an
    // ordinary half hour. `percentileWord` already owns those words in
    // StageBars, and a second vocabulary for one axis is how two figures start
    // describing the same number differently.
    assert.match(distribution, /percentileWord/, "the figure invents its own words for the percentile axis");
  });
});

describe("the two figures that are not drawn are recorded as decisions", () => {
  it("no half-life histogram, because Meetings already draws that column", () => {
    assert.match(
      arm,
      /Statement half-life, meeting by meeting/,
      "the Meetings strip is the half-life spread; if it went, the histogram argument changes",
    );
  });

  it("no placebo strip, because the wire carries no placebo", () => {
    // Stated as a property of the SCHEMA rather than of the component: the day
    // `StageRun` gains a placebo field, this assertion fails and the figure
    // becomes drawable.
    assert.doesNotMatch(
      types,
      /placebo/i,
      "the wire now carries a placebo — the control-window check can be drawn, and should be",
    );
  });
});
