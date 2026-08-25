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
 *     the levels, and the focused mark's words reach a live region outside the
 *     `role="img"` wrapper. One instrument, not one tab stop per level — which
 *     on the 37-level ladder measured in Chrome would have been 37.
 *  2. Each mark says what is resting AT OR BETTER than its price, accumulated
 *     from the top of its own book inwards. A level's own size is what the bar
 *     already draws; the cumulative is the quantity a marketable order actually
 *     eats, and it was nowhere on the desk.
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
    assert.match(stripNonCode(ladder), /<Plot height=\{HEIGHT\}>/,
      "the ladder is back on a bare svg, so its marks are mouse-only again");
    assert.doesNotMatch(stripNonCode(ladder), /useMeasuredWidth/,
      "measuring its own width is what bypassed the keyboard instrument");
  });

  it("and every bar still carries a title, which is what Plot collects", () => {
    // `use-mark-readout` finds marks by walking `<title>` elements. A bar that
    // lost its title would vanish from the keyboard walk while still being
    // drawn — invisible to a reader and to this file's first assertion.
    // COMMENTS BLANKED, because this file's own header explains what a
    // `<title>` is and why it was not enough — and a raw count reads that
    // prose as two more marks. The same trap `markets-sections.test.ts`
    // records, walked into while writing the assertion that records it.
    assert.equal((stripNonCode(ladder).match(/<title>/g) ?? []).length, 2,
      "the two ladders no longer carry one title each");
  });
});

describe("a mark says what an order would actually eat", () => {
  it("each level reports the depth at or better, not only its own size", () => {
    assert.match(ladder, /resting at that bid or better/);
    assert.match(ladder, /resting at that offer or better/);
  });

  it("and it accumulates from the end of the book an order fills from", () => {
    // A YES bid ladder fills from the highest price down; the mirrored NO
    // ladder — drawn on the YES axis — fills from the lowest implied offer up.
    // Accumulating from the wrong end reports the depth BEHIND a price as the
    // depth in front of it, which is the one number this figure adds.
    assert.match(ladder, /barsFor\(yesPoints, x, y, base, barWidth, "from-high"\)/);
    assert.match(ladder, /barsFor\(noPoints, x, y, base, barWidth, "from-low"\)/);
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
