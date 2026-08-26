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
// The per-meeting strip and its table left the pane on 2026-08-25, when the
// four-view arm was split so `meetings` could become a section of its own. The
// caption below is pinned against the file that DRAWS it, not against the file
// that used to.
const meetings = read("../components/coherence/diffusion/MeetingTable.tsx");
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
      meetings,
      /Statement half-life, meeting by meeting/,
      "the Meetings strip is the half-life spread; if it went, the histogram argument changes",
    );
  });

  it("no figure draws controls_used as the backing for a rank", () => {
    // `control_percentile` is a rank against the PLACEBO population — the
    // matched windows whose own path cleared the gate AND whose volatility
    // half-life resolved. `controls_used` is the windows FOUND, before either
    // filter. So it is an upper bound on what a rank stands on, not the
    // denominator, and a figure drawing it as "how many controls back this
    // rank" would overstate the backing by an unknown amount.
    //
    // Measured on the live ledger 2026-08-25, which is the part that settles
    // it: `controls_used` was identically 5 on every run, ranked and unranked
    // alike, while only 19 of 89 measured runs carried a percentile at all. It
    // distinguishes nothing on this payload even before the definition is
    // argued.
    //
    // Pinned as a property of the SCHEMA rather than of today's numbers, so it
    // fails the day the wire carries the count that IS the denominator, and not
    // before — a guard keyed to 70-of-89 would cry wolf the moment the tape
    // grows.
    assert.doesNotMatch(
      types,
      /controls_ranked|placebo_count|controls_scored/,
      "the wire now carries the population a percentile is ranked against — the backing can be drawn, and should be",
    );
    for (const file of ["FloorDistribution", "StageBars", "MeetingTable", "InformationDiffusionPane"]) {
      assert.doesNotMatch(
        read(`../components/coherence/diffusion/${file}.tsx`),
        /controls_used/,
        `${file} draws controls_used; it is the windows found, not the population the rank was taken over`,
      );
    }
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

describe("the watch says which round trip it carries, and follows the payload rather than a comment", () => {
  // THE DEFECT, 2026-08-26. The gateway started timing its own reads and put
  // `round_trip_source` on the wire — "assumed" for the query default echoed
  // back, "measured" for the median of real reads. `EpisodeWatch`'s header was
  // updated the same day to say the figure follows that field. The sentence it
  // rendered was not: on a payload saying `measured`, the live desk still read
  // "the 270ms round trip is an ASSUMPTION … nothing on this desk has timed
  // it". A comment describing a fix is not the fix, and no suite compared the
  // two — so this one pins the SENTENCE to the FIELD, not to the prose.
  //
  // Comments are blanked first. Every one of these files argues in prose about
  // the very strings this looks for, and a raw scan would find the word
  // "ASSUMPTION" in the explanation of why it must not always be said.
  const watch = read("../components/coherence/diffusion/EpisodeWatch.tsx")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ");

  it("reads the source field off the payload", () => {
    assert.match(watch, /data\.round_trip_source/,
      "the watch no longer reads `round_trip_source`, so it cannot know whether the number was timed");
  });

  it("the assumption sentence is reachable only when the source is not measured", () => {
    // The word may be rendered — it is the honest label for the default — but
    // only behind a branch on the field. An unconditional "ASSUMPTION" is the
    // exact shape that lied on the live desk.
    const at = watch.indexOf("is an ASSUMPTION");
    assert.notEqual(at, -1, "the assumed case no longer names itself as one");
    const before = watch.slice(Math.max(0, at - 700), at);
    assert.match(before, /roundTripSource === "measured"/,
      "\"ASSUMPTION\" is rendered without a branch on `round_trip_source` above it — a measured read would be called an assumption");
  });

  it("the measured sentence carries the gateway's own caveat: a read bounds an order from below", () => {
    // `coherence_history.py`'s contract: "a surface may not present a measured
    // read as the cost of trading … every surface drawing it has to say so."
    assert.match(watch, /is measured/, "the measured case is never named as measured");
    assert.match(watch, /lower bound on an order/,
      "a measured read is shown without saying it bounds an order from below, which the gateway forbids");
  });

  it("the field is typed on the wire, so a rename fails here rather than rendering the default silently", () => {
    const wire = read("../lib/coherence/types.ts");
    assert.match(wire, /round_trip_source\?: string;/);
    assert.match(wire, /round_trip_samples\?: number;/);
  });
});
