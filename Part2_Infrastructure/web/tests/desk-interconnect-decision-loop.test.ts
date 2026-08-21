/**
 * The decision loop is clickable, as the reviewer tour has been claiming.
 *
 * The Overview's pipeline draws the four stages of the desk's decision loop,
 * and `lib/workspace-tour.ts` tells a reviewer that every stage links into its
 * tab — a claim that has outlived the truth of it before. This block pins both
 * halves: the sentence is still in the tour, and the stages are still real
 * buttons that land somewhere real.
 *
 * "Real button" is not a style preference. A `<div onClick>` is not focusable
 * and is announced as text, so a stage rendered that way is unreachable by
 * keyboard while looking identical on screen — the same green-and-wrong shape
 * the cross-link measurements exist for. And the destinations are checked
 * against `lib/sections` for the same reason: StageId "execution" opens the
 * `live` workspace, the one place on the desk where the two names differ, and
 * nothing in the type system notices if that mapping rots.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isRealLocation } from "./helpers/desk-rails";
import { overview, pipeline, routingCode, tourCode } from "./helpers/desk-shell-sources";

describe("every pipeline stage links into its tab", () => {
  it("the reviewer tour still makes the claim this section pins", () => {
    // If the sentence goes, these assertions are policing nothing in
    // particular; if it stays, it has to be true.
    // Case-insensitive: the claim now opens its sentence, so it is capitalised.
    assert.match(tourCode, /every pipeline stage links into its tab/i);
  });

  it("each stage is a real button, not a click handler on a div", () => {
    assert.match(pipeline, /<button\s/, "the stages render no button at all");
    assert.match(pipeline, /onClick=\{\(\) => onOpenStage\(stage\.id\)\}/);
    assert.doesNotMatch(
      pipeline,
      /<(?:div|li|span)[^>]*onClick=/,
      "a stage is clickable but not focusable, and is announced as text",
    );
  });

  it("the button carries an accessible name from the stage itself", () => {
    // The visible label IS the name: stage, state word and detail line all sit
    // inside the button, so voice control and a screen reader agree with what
    // is on screen. An aria-label here would be a second, drifting copy.
    const button = pipeline.slice(pipeline.indexOf("<button"), pipeline.indexOf("</button>"));
    assert.match(button, /\{stage\.label\}/);
    assert.doesNotMatch(button, /aria-label=/);
  });

  it("the shell decides where a stage lands, and covers all four", () => {
    assert.match(overview, /<DecisionLoopPipeline stages=\{stages\} onOpenStage=\{onOpenStage\} \/>/);
    const start = routingCode.indexOf("const openLoopStage = useCallback");
    assert.notEqual(start, -1, "use-workspace-routing no longer maps a stage to a destination");
    const body = routingCode.slice(start, routingCode.indexOf("}, [openSection]);", start));
    for (const stage of ["data", "research", "risk", "execution"]) {
      assert.match(
        body,
        new RegExp(`case "${stage}":`),
        `the ${stage} stage has no destination, so clicking it does nothing`,
      );
    }
    // And what it opens is real. StageId "execution" is the `live` workspace —
    // the one place on the desk where the two names differ.
    for (const [view, section] of [
      ["data", "overview"], ["research", "summary"], ["risk", "limits"], ["live", "trade"],
    ]) {
      assert.ok(
        body.includes(`openSection("${view}", "${section}")`) && isRealLocation(view, section),
        `the pipeline opens ${view}/${section}, which is not a section`,
      );
    }
  });
});
