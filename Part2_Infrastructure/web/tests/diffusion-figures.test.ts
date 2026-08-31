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

const distribution = read("../components/coherence/diffusion/ControlRank.tsx");
const floor = read("../components/coherence/diffusion/FloorDistance.tsx");
const arm = read("../components/coherence/diffusion/InformationDiffusionPane.tsx");
// The per-meeting strip and its table left the pane on 2026-08-25, when the
// four-view arm was split so `meetings` could become a section of its own. The
// caption below is pinned against the file that DRAWS it, not against the file
// that used to.
const meetings = read("../components/coherence/diffusion/MeetingTable.tsx");
const types = read("../components/coherence/diffusion/types.ts");

describe("the noise floor shows its distribution, not only two medians", () => {
  it("the figure is drawn on the floor view", () => {
    assert.match(arm, /ControlRank/, "the Control view draws no rank strip");
    assert.match(arm, /FloorDistance/, "the Control view draws no distance to the floor");
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
  it("the floor figure places every stage by the wire's judged sigma, and falls back to the sentence", () => {
    // Since 2026-08-26 `StageRun.terminal_sigmas` is on the wire for all 248
    // stages — computed on the gateway from the one formula `_judge` uses —
    // so the figure reads it FIRST and the sentence only where it is null.
    // Two pins: the wire field is read, and it is never coerced to nought.
    assert.match(floor, /run\.terminal_sigmas != null/, "the wire's judged sigma is not read");
    assert.match(floor, /refusalSigma\(run\.signal_reason\)\?\.sigma \?\? null/,
      "the sentence is not the fallback — a gateway that predates the field would blank the figure");
    assert.doesNotMatch(floor, /terminal_sigmas \?\? 0/, "a missing sigma was coerced to nought");
    assert.match(floor, /is-cleared/, "the stages that cleared are not told apart from the refused");
    const wire = read("../components/coherence/diffusion/types.ts");
    assert.match(wire, /terminal_sigmas: number \| null;/, "the field is not typed on the wire");
    assert.match(wire, /sigma_pre_per_bar: number \| null;/, "the raw scale is not typed on the wire");
  });

  it("the floor figure reads the refusal sentence and fetches nothing", () => {
    // 159 of 159 refusals on the live ledger carry "N pre-event sigmas, below
    // the floor of M" and no numeric field beside it. The figure parses that
    // through one shared helper; it does not fetch, and it does not draw the
    // 89 accepted runs at the floor — their sigma is not on the wire.
    assert.match(floor, /refusalSigma/, "the floor figure no longer reads the refusal sentence");
    assert.doesNotMatch(floor, /useCoherenceRead|Route\(/, "the floor figure fetches");
    assert.doesNotMatch(floor, /half_life_s\b(?!\s*\?\?\s*null)/, "the floor figure buckets half-lives, which is the histogram Meetings already draws");
  });

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
    // COMMENTS BLANKED FIRST. `FloorDistance`'s header explains in prose why it
    // does NOT read `controls_used`, and a raw scan found the word in the
    // explanation and failed the file for explaining itself — the same shape
    // that has cost this tree six red runs in a week. A guard reads code.
    const codeOf = (file: string) =>
      read(`../components/coherence/diffusion/${file}.tsx`)
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/^[ \t]*\/\/.*$/gm, " ");
    for (const file of ["ControlRank", "FloorDistance", "MeetingTable", "InformationDiffusionPane"]) {
      assert.doesNotMatch(
        codeOf(file),
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

/**
 * The Findings section's two figures, and the one sentence on it that a
 * payload can contradict.
 *
 * `EffectPlot` drew `t` on one axis; the sample behind each row was on another
 * button. `EffectField` places every row by `t` AND `shuffled_p` and sizes the
 * mark by `n`, so "every null rests on 26 or 29 meetings while the control
 * rests on 61" is the figure's shape. `EvidenceMatrix` pairs the two stages of
 * each relationship in a grid, which is the one question a fourteen-row list
 * cannot answer at a glance.
 *
 * THE SCORED SENTENCE. The desk once asserted, in fixed prose, that the clock
 * is predictable out of sample on 57 meetings. That is true of a study in the
 * ledger and false of the one on the wire, whose `skill_meetings` is 0. Both
 * places that speak of the score now branch on that field, and this pins the
 * branch — proven red by making either sentence unconditional.
 */
describe("Findings: the field, the matrix, and the sentence the wire decides", () => {
  const codeOf = (file: string) =>
    read(`../components/coherence/diffusion/${file}.tsx`)
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^[ \t]*\/\/.*$/gm, " ");
  const pane = codeOf("FindingsPane");
  const folds = codeOf("FindingsFolds");
  const field = codeOf("EffectField");
  const matrix = codeOf("EvidenceMatrix");
  const fit = codeOf("InstrumentFit");

  it("both views open on the new figures and the old ones are gone", () => {
    assert.match(pane, /<EffectField findings=/);
    assert.match(pane, /<EvidenceMatrix findings=/);
    assert.doesNotMatch(pane, /EffectPlot|ValueStrip/, "an old Findings figure is still mounted");
  });

  it("the field draws two axes and an area, not one axis", () => {
    assert.match(field, /shuffled_p/, "the p axis is not read");
    assert.match(field, /Math\.sqrt\(Math\.max\(0, n\)\)/, "mark area does not follow n");
    assert.match(field, /P_RULE = 0\.05/, "the p rule is not 0.05");
    assert.match(field, /p === 0 \? "under 0\.001"/, "a p of exactly zero would print as 0.000");
    assert.doesNotMatch(field, /Math\.log/, "the p axis went logarithmic; the docblock says why it must not");
  });

  it("the matrix pairs the two stages and hatches a cell it cannot draw", () => {
    assert.match(matrix, /STAGES = \["release", "call"\] as const/);
    assert.match(matrix, /diff-matrix__unmeasured/, "an unmeasured cell has no hatched shape");
    assert.doesNotMatch(matrix, /\?\? 0/, "a missing t was coerced to a bar of nought");
  });

  it("no fixed prose on the pane asserts the out-of-sample number", () => {
    assert.doesNotMatch(pane, /\+0\.14|57 meetings|R² \+/, "a number the wire can contradict is asserted in fixed prose");
  });

  it("the caption's claim about the ladder branches on skill_meetings", () => {
    const at = folds.indexOf("the ladder above reports whether the clock is predictable");
    assert.notEqual(at, -1, "the ladder sentence is gone");
    const before = folds.slice(Math.max(0, at - 200), at);
    assert.match(before, /study\.skill_meetings > 0\s*\?/,
      "\"the ladder above reports\" is rendered without a branch on `skill_meetings` — on this deployment it is false");
    assert.match(folds, /on this run it has not been scored/, "the unscored case has no sentence of its own");
  });

  it("decodes d6:s7 and states why that run was selected", () => {
    assert.ok(folds.includes(String.raw`study.study_id.match(/:d(\d+):s(\d+)$/)`),
      "the displayed run key is no longer decoded from the study id");
    assert.match(folds, /latent dimensions/);
    assert.match(folds, /random seed/);
    assert.match(folds, /selected because it best recovered the known fact among the well-conditioned candidates under the pre-registered rule below/,
      "the row decodes d6:s7 but still does not explain why that pair won");
  });

  it("the method folds are tables whose summaries name them without a count, and the pane keeps no prose fold", () => {
    assert.match(pane, /<FindingsFolds study=\{study\} calendar=\{calendar\} \/>/, "the folds are not mounted");
    // ONE fold stays on the pane — the table view's folded `FindingsTable`,
    // which is a table already. The two prose folds and the third are gone.
    assert.equal((pane.match(/<details/g) ?? []).length, 1, "the pane should keep exactly the table view's fold");
    assert.doesNotMatch(pane, /How this run was chosen|Why report the predictor/,
      "a prose fold survives on the pane; the folds are tables in FindingsFolds now");
    // SINCE 2026-08-27 the two counts moved off these headers: 12 settings
    // and 3 fixed checks are not measurements, so nothing replaces them — a
    // plain-text summary is the precedent (`ModelFormulas.tsx`'s "What it
    // measures, what breaks it, and when it holds", 13 identical renders).
    assert.match(folds, /<summary>The run, and what it was held to<\/summary>/, "the run fold's summary is no longer plain text naming its table");
    assert.match(folds, /<summary>Timestamps, checked against the issuer<\/summary>/, "the timestamp fold's summary is no longer plain text naming its table");
    assert.doesNotMatch(folds, /<summary>\{`/, "a fold summary interpolates a count again — a row count is not a measurement here");
    assert.equal((folds.match(/<table className="coh-table table-fixed">/g) ?? []).length, 2, "each fold is one fixed-layout table");
    assert.doesNotMatch(folds, /\?\? 0/, "a missing study field was coerced to nought");
  });

  it("the ladder's unscored row says it was not scored, and only when it was not", () => {
    const at = fit.indexOf('"not scored for this run"');
    assert.notEqual(at, -1, "the unscored reading is gone");
    const before = fit.slice(Math.max(0, at - 120), at);
    assert.match(before, /scored\s*\?/, "\"not scored for this run\" is not conditional on the meeting count");
    assert.match(fit, /const scored = study\?\.skill_meetings \?\? 0;/,
      "`scored` no longer reads the wire field, or a missing study is no longer distinct from zero meetings");
  });
});
