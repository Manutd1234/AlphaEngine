/**
 * The Books ladder is reachable from a keyboard, and says what a ladder is asked.
 *
 * IT WAS THE ONE FIGURE ON THIS TAB A KEYBOARD COULD NOT READ. Every bar
 * carried a `<title>` with its price and size — and a `<title>` is a native
 * tooltip: reachable with a mouse and by nothing else. It never appears on a
 * touch screen and never appears from a keyboard, which is the exact exclusion
 * `lib/coherence/use-mark-readout.ts` exists to end. Twenty-five figures on this
 * engine get that instrument by drawing through `<Plot>`; this one drew into a
 * raw `<svg>` over `useMeasuredWidth`, so it got none of it.
 *
 * Two properties, and the second is the reason the swap was worth making rather
 * than merely correct:
 *
 *  1. It draws through `Plot`, so the plot takes ONE tab stop, arrow keys walk
 *     the levels, and the focused position's words reach a live region outside
 *     the `role="img"` wrapper. One instrument, not one tab stop per level —
 *     which on the 37-level ladder measured in Chrome would have been 37.
 *  2. Each level says what is resting AT OR BETTER than its price, accumulated
 *     from the top of its own book inwards. A level's own size is what the bar
 *     already draws; the cumulative is the quantity a marketable order actually
 *     eats, and it was nowhere on the desk.
 *
 * THE MECHANISM CHANGED ON 2026-08-26 AND THE TWO PROPERTIES DID NOT. The walk
 * was per-bar `<title>`s collected by `use-mark-readout`; it is now the shared
 * axis, because a ladder is an axis figure and `Plot` gives such a figure one
 * readout or the other — a title beside `sharedX` makes BOTH interactive, two
 * tab stops and two voices on one figure (`engine-crosshair.test.ts`). The
 * walk is over the UNION of the two ladders now, so a position speaks both
 * sides at once, which no per-bar title could: a price where only the NO side
 * rests used to be silent on the YES ladder it is drawn against.
 *
 * Derived, never observed (CLAUDE.md, fact 6) — but the behaviour above WAS
 * observed once, over CDP: tabIndex 0, 37 marks, and two arrow presses moving
 * the live region to "YES bid 0.0900 for 800 contracts; 66887.9 resting at that
 * bid or better". This suite is what stops it regressing silently.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { read, stripNonCode } from "./helpers/workspace-sources";

const ladder = read("../components/coherence/LadderChart.tsx");

describe("the ladder draws through the shared instrument", () => {
  it("uses Plot rather than a raw svg over a measured div", () => {
    assert.match(stripNonCode(ladder), /<Plot\b/,
      "the ladder is back on a bare svg, so its marks are mouse-only again");
    assert.match(stripNonCode(ladder), /height=\{HEIGHT\}/,
      "the plot no longer takes the figure's height");
    assert.doesNotMatch(stripNonCode(ladder), /useMeasuredWidth/,
      "measuring its own width is what bypassed the keyboard instrument");
  });

  it("and no bar carries a title, because the walk is the shared axis now", () => {
    // The inverse of what this asserted until 2026-08-26, and for the reason
    // the header gives: `Plot` picks ONE readout by whether `sharedX` is
    // declared, so a leftover title here would hand a hovering reader a second
    // voice saying something narrower than the crosshair already says.
    // COMMENTS BLANKED, because this file's own prose quotes the tag it counts
    // — a raw count reads that prose as marks. The same trap
    // `markets-sections.test.ts` records, walked into while writing the
    // assertion that records it.
    assert.equal((stripNonCode(ladder).match(/<title>/g) ?? []).length, 0,
      "a bar carries a title again, so the figure has two readouts");
    assert.match(stripNonCode(ladder), /sharedX=\{/,
      "the ladder declares no shared axis, so nothing walks its levels");
  });
});

describe("a mark says what an order would actually eat", () => {
  it("each level reports the depth at or better, not only its own size", () => {
    // RAW, not stripped: these are string literals, which `stripNonCode`
    // blanks. They are the crosshair's row labels now rather than the tail of
    // a title sentence, so the claim is read beside the number it belongs to.
    assert.match(ladder, /Resting at that bid or better/);
    assert.match(ladder, /Resting at that offer or better/);
    assert.match(stripNonCode(ladder), /level\.yes\.depth/,
      "the YES row reports something other than the accumulated depth");
    assert.match(stripNonCode(ladder), /level\.no\.depth/,
      "the NO row reports something other than the accumulated depth");
  });

  it("and it accumulates from the end of the book an order fills from", () => {
    // A YES bid ladder fills from the highest price down; the mirrored NO
    // ladder — drawn on the YES axis — fills from the lowest implied offer up.
    // Accumulating from the wrong end reports the depth BEHIND a price as the
    // depth in front of it, which is the one number this figure adds.
    // The accumulation moved out of `barsFor` — which draws — into `depthBy`,
    // which counts, so one book cannot be accumulated twice and disagree with
    // itself between the bar and the readout.
    assert.match(ladder, /depthBy\(yesPoints, "from-high"\)/);
    assert.match(ladder, /depthBy\(noPoints, "from-low"\)/);
  });

  it("and the count is not a float's tail", () => {
    // Measured in Chrome before this existed: "66887.90000000001 resting at
    // that bid or better" on a 37-level ladder. Sizes are decimal strings and
    // the cumulative is a sum of Numbers.
    assert.match(ladder, /function contractsLabel/);
    // And it must not pad the tail back on. `toFixed(2)` turned 66887.9 into
    // "66887.90", which claims a hundredth the count does not have — the same
    // defect one decimal shorter.
    //
    // Scoped to the HELPER'S BODY, not the file: `stepPath` and `barsFor` round
    // SVG path coordinates with `toFixed(2)` and are right to — a path is
    // geometry, not a measurement, and a file-wide ban failed on those.
    // COMMENT-STRIPPED, because the helper's own comment explains that
    // `toFixed(2)` was the defect — and a raw scan of its body reads that
    // sentence as the defect returning. Third time this file has met that trap
    // in one pass, which is why `stripNonCode` exists.
    const body = /function contractsLabel\(value: number\): string \{([\s\S]*?)\n\}/
      .exec(stripNonCode(ladder));
    assert.ok(body, "the count helper is gone");
    assert.doesNotMatch(body[1], /toFixed/,
      "the count is padded to a fixed width again, so a whole-contract sum claims hundredths");
    assert.doesNotMatch(ladder, /\$\{depth\} resting/,
      "the raw sum is printed again, so a long ladder shows sixteen decimal places");
    assert.doesNotMatch(ladder, /\$\{size\} contracts/,
      "the raw size is printed again");
  });
});
