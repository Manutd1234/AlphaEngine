/**
 * Activity, split along the record/stream seam.
 *
 * The same argument as the Fill quality split beside it, applied to the section
 * that only had the weaker version of it: an ordering, held in place by a
 * comment. The describe below records why the seam falls where it does. What
 * belongs at the top of the file is the cost, because it is the part a later
 * edit is most likely to keep while losing the reason for it.
 *
 * A conditional render unmounts DeskTape, and the rows its channel gathered
 * this session are gone when it remounts. That is sound only by the tape's own
 * doctrine — watched, not counted on; the blotter's poll owns every decision
 * the tape ever showed — so one test below scans the raw source with its
 * comments intact, to make sure the trade stays argued at the point it is made.
 *
 * Source-level assertions, like the rest of this suite: there is no DOM here,
 * and what is worth pinning is structural.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { code, read } from "./helpers/execution-controls-sources";

const cockpit = read("components/execution/ExecutionCockpit.tsx");
// The poll and the single invalidation path the panes are wired to moved out
// of the component with the rest of the data layer; the panes did not.
const cockpitFeed = read("components/execution/use-cockpit-feed.ts");

describe("Activity is the record and the stream, one seg apart", () => {
  /**
   * The blotter, the decision tape and the alert feed were one long scroll,
   * and the only thing keeping the record ahead of the stream was source
   * order — a comment saying "after the blotter, deliberately". The split
   * states that argument as geometry: Blotter is the polled record, Tape &
   * alerts is what the desk is doing right now, and the reader chooses which
   * question they are asking instead of scrolling past the answer to the
   * other one.
   */
  const stripped = code(cockpit);

  it("splits into exactly two panes", () => {
    const block = stripped.slice(stripped.indexOf("const ACTIVITY_PANES"));
    const list = block.slice(0, block.indexOf("];"));
    const ids = [...list.matchAll(/\{ id: "([a-z]+)"/g)].map((m) => m[1]);
    assert.deepEqual(ids, ["blotter", "tape"]);
  });

  it("switches with the house `.seg role=group`, never a nested rail", () => {
    // Same grammar as Fill quality directly above it, for the same reason:
    // WorkspaceSubtabs publishes --rail-h and asserts one rail is mounted.
    assert.match(stripped, /<div className="seg" role="group" aria-label="Activity view">/);
    assert.match(stripped, /aria-pressed=\{activityPane === option\.id\}/);
    assert.equal((stripped.match(/<WorkspaceSubtabs\b/g) ?? []).length, 0);
  });

  it("declares the pane state above the loading bail-out", () => {
    // React throws "rendered more hooks than during the previous render" on
    // the first render that gets past the placeholder otherwise.
    const state = stripped.indexOf("useState<ActivityPane>");
    const bail = stripped.indexOf("if (loading && !book && !problem)");
    assert.ok(state >= 0, "the pane holds no state");
    assert.ok(bail >= 0, "the loading bail-out moved");
    assert.ok(state < bail, "the pane state is declared after an early return");
  });

  it("opens on the record, never the stream", () => {
    /**
     * The default carries what the old ordering carried: reading the stream
     * first invites treating it as the record, which is exactly what a
     * channel that drops silently cannot be. A fixed default, not one from a
     * tier — the same rule the quality pane states.
     */
    assert.match(stripped, /useState<ActivityPane>\("blotter"\)/);
    assert.doesNotMatch(stripped, /useComplexity|atLeast/);
  });

  it("renders panes conditionally rather than hiding them", () => {
    assert.match(stripped, /activityPane === "blotter" && \(/);
    assert.match(stripped, /activityPane === "tape" && \(/);
    assert.doesNotMatch(stripped, /hidden=\{activityPane/);
  });

  it("accepts losing the tape's session rows, and says so where the trade is made", () => {
    /**
     * A conditional render unmounts DeskTape, and the rows its channel
     * gathered this session are gone when it remounts. That is sound only by
     * the tape's own doctrine — watched, not counted on; the blotter's poll
     * owns every decision the tape ever showed — so the raw source is scanned
     * here, comments included: the trade must stay argued at the point it is
     * made, or the next edit keeps the unmount and loses the reason.
     */
    assert.match(cockpit, /watched,\s*not counted on/);
  });

  it("puts the record in Blotter and both feeds in Tape & alerts", () => {
    const open = stripped.indexOf('activityPane === "blotter"');
    const shut = stripped.indexOf('activityPane === "tape"');
    // Measured, not sliced blind — `indexOf` returning -1 twice would hand
    // `doesNotMatch` an empty string and pass without reading anything.
    assert.ok(open >= 0 && shut > open, "the panes are gone, so nothing was checked");
    const blotterPane = stripped.slice(open, shut);
    const tapePane = stripped.slice(shut);
    assert.match(blotterPane, /<BlotterViews/);
    assert.doesNotMatch(blotterPane, /<DeskTape|<AlertFeed/);
    assert.match(tapePane, /<DeskTape/);
    assert.match(tapePane, /<AlertFeed/);
    assert.doesNotMatch(tapePane, /<BlotterViews/);
  });

  it("keeps the blotter's wiring exactly as it was", () => {
    // The split moves the record into a pane; it does not re-plumb it. The
    // cancel path still re-reads this panel's own poll — through the cockpit's
    // one invalidation path now, which stays local because a cancel carries no
    // submission result — and `active` still gates the resting book's polling
    // on the subtab, not the pane; the conditional render handles the pane.
    assert.match(stripped, /active=\{section === "activity"\}/);
    assert.match(stripped, /onChanged=\{revalidate\}/);
    assert.match(code(cockpitFeed), /if \(result\) onOrderSettled\?\.\(result\)/);
    assert.match(stripped, /<AlertFeed events=\{effectiveEvents\} source=\{feedSource\}/);
  });

  it("keeps the panel id a literal, because the routing suite scrapes for it", () => {
    assert.match(stripped, /tabId="activity"/);
    assert.doesNotMatch(stripped, /tabId=\{/);
  });
});
