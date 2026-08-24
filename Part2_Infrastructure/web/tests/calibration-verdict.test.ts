/**
 * The Scorecard's verdict figures, and the three things they refuse to call a pass.
 *
 * A gauge is the most dangerous figure on this engine, because it converts a
 * number a reader has to think about into a position on a dial they do not. The
 * settled score is exactly the number that must not be read that way: on the
 * live sample the `final_trade` engine returns a skill of 0.99935238, which
 * would put a needle almost at the top of any dial drawn without an argument —
 * and it measures how fast the exchange converges on an answer already in plain
 * sight, not whether it saw anything coming.
 *
 * So the gauge is allowed to exist only with its refusals pinned. Three of them,
 * and each is a different way a good-looking number can be untrue:
 *
 *  1. `final_trade` is NOT A FORECAST TEST and can never render as a pass,
 *     whatever the skill. `EngineBanner` makes this argument in prose; a gauge
 *     that ignored it would contradict the banner directly above it.
 *  2. A THIN corpus is WITHHELD, not failed. Too few settled markets to conclude
 *     from is an absence of evidence, and drawing it at the bottom of the dial
 *     would report it as evidence of absence.
 *  3. A NULL skill declines the needle and says why. The house rule at its
 *     sharpest: `?? 0` on a nullable metric turns "we do not know" into "it is
 *     fine", and on this dial zero is a real reading — no better than the base
 *     rate.
 *
 * The trend has one of its own: the series accrues FORWARD ONLY, so the first
 * point is where the recorder started and not where the venue did. A chart that
 * did not say so invites a reader to date the venue's behaviour from it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { read } from "./helpers/workspace-sources";

const gauge = read("../components/coherence/CalibrationGauge.tsx");
const trend = read("../components/coherence/CalibrationTrend.tsx");
const routes = read("../lib/coherence/routes.ts");

/**
 * The same source with comments blanked, for the checks that are about CODE.
 *
 * `coherence-proof-claims.test.ts` strips comments for the opposite reason — it
 * is scanning what a reader SEES, and a header quoting the wording it replaced
 * would count as a live claim. Here the direction is reversed and the trap is
 * the same shape: both files argue in prose about the coercion they refuse, so a
 * raw scan for `?? 0` finds the sentence explaining why it is banned and reports
 * it as the ban being broken. It happened on the first run of this suite.
 */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");

describe("the gauge refuses to call three things a pass", () => {
  it("a convergence engine is never a pass, whatever the skill", () => {
    assert.match(gauge, /final_trade/,
      "the gauge does not know about the engine, so it will draw a convergence score as foresight");
    assert.match(gauge, /not a forecast test/i,
      "the gauge must SAY that a final_trade score is not a forecast test, in words a reader meets");
  });

  it("a thin corpus is withheld rather than failed", () => {
    assert.match(gauge, /thin/);
    assert.match(gauge, /withheld/i,
      "a thin sample must render as withheld — drawing it low reports absence of evidence as evidence");
  });

  it("a null skill declines the needle and names the reason", () => {
    assert.match(gauge, /skill == null|skill === null/,
      "the gauge does not handle a null skill, so it will coerce one somewhere");
    assert.doesNotMatch(code(gauge), /\?\?\s*0\b/,
      "`?? 0` on this dial turns “we do not know” into “no better than the base rate”, which is a reading");
  });

  it("zero is drawn as a real position, since it means something here", () => {
    // Skill of zero is not the bottom of the scale — it is "no better than
    // knowing the base rate", and below it is worse than that. A dial that put
    // zero at the floor would hide half the range that matters.
    assert.match(gauge, /worse than/i,
      "the sub-zero region must be drawn and labelled: negative skill is worse than knowing nothing");
  });
});

describe("the trend says where its record begins", () => {
  it("it reads the history through the routes module, like everything else", () => {
    assert.match(routes, /calibrationHistoryRoute/,
      "the history has no route helper, so a pane would have to spell the path itself");
    assert.match(trend, /calibrationHistoryRoute/);
  });

  it("it says the series accrues forward only", () => {
    assert.match(trend, /forward only/i,
      "without it, a reader dates the venue's behaviour from the recorder's start");
  });

  it("a run that could not be scored is a gap, never a zero", () => {
    // The same refusal the store makes, carried through to the drawing: those
    // rows exist and have null figures, and a line closed over them would claim
    // a score nobody took.
    assert.match(trend, /gap/i, "the trend must draw unscoreable runs as gaps");
    assert.doesNotMatch(code(trend), /\?\?\s*0\b/);
  });
});
