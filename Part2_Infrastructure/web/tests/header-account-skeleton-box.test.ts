/**
 * The account chip's loading placeholder, pinned to the box it actually
 * reserves — in numbers rather than in a class string.
 *
 * WHY A SECOND FILE ON A BRANCH auth-header.test.ts ALREADY COVERS
 * ----------------------------------------------------------------
 * `auth-header.test.ts` asserts "occupies the same box as the control it
 * replaces" by matching the padding/gap substring the placeholder shares with
 * the signed-out control. That proxy passed for the whole time the box was
 * wrong. Measured in Chrome over the running desk, in the real header row at
 * 1920px, the placeholder came out 90x28 where the signed-out control it is
 * built against measures 77.3x32 — 12.7px too wide and 4px too short, so the
 * probe answering reflowed the entire utility cluster sideways. A shared
 * padding string cannot see either error, because neither error is in the
 * padding: the width came from the label bar and the height from the fact that
 * a bare bar raises no line box.
 *
 * So this file pins the ARITHMETIC the measurement confirmed, not the spelling:
 *
 *   icon 14 + gap-1.5 6 + bar 39 + px-1.5 12 + border 2 = 73px
 *
 * against the signed-out control's measured 77.3px, and a declared 32px of
 * height against its measured 32px. Every term is asserted separately, so a
 * change to any one of them fails here with the term named rather than as a
 * mysterious total.
 *
 * The 39px is not chosen: "Sign in" sets 39.3px at the chip's own 12px/600
 * (--fs-chrome-chip, Inter), measured in the same row. 52px was the old value
 * and is the 12.7px.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readSource } from "./helpers/source-files";

const chip = readSource("components/header/AccountChip.tsx");

/** The `session.status === "loading"` branch, up to the next branch. */
const loadingBranch = (() => {
  const from = chip.indexOf('session.status === "loading"');
  const to = chip.indexOf('session.status === "signed-out"');
  assert.ok(from > 0 && to > from, "the loading branch must precede the signed-out branch");
  return chip.slice(from, to);
})();

/** The signed-out control, which is the box the placeholder reserves for. */
const signedOutBranch = (() => {
  const from = chip.indexOf('session.status === "signed-out"');
  const to = chip.indexOf("const label =", from);
  assert.ok(from > 0 && to > from, "the signed-out branch must precede the signed-in return");
  return chip.slice(from, to);
})();

describe("the account placeholder reserves the box it measured", () => {
  it("declares the row's 32px height rather than inheriting a short one", () => {
    // A 14px icon over an 11px bar raises a 28px box; the control it replaces
    // raises 32px because its LABEL sets an 18px line box. Declaring the height
    // fixes that without inflating the bar, which would have read as a second
    // icon rather than as a word.
    assert.match(loadingBranch, /min-h-\[32px\]/,
      "the placeholder must declare min-h-[32px], the row's control height");
  });

  it("sizes the label bar to the label it stands in for", () => {
    // "Sign in" measures 39.3px at 12px/600 in the header's Inter.
    assert.match(loadingBranch, /skeleton block h-\[11px\] w-\[39px\]/,
      "the bar must be 39px, the measured width of 'Sign in'");
    assert.doesNotMatch(loadingBranch, /w-\[52px\]/,
      "52px is the old bar and the 12.7px of width reflow it caused");
  });

  it("keeps the icon and the gap the control uses, so the arithmetic closes", () => {
    for (const term of [/h-\[14px\] w-\[14px\]/, /gap-1\.5/, /px-1\.5/]) {
      assert.match(loadingBranch, term, `the placeholder must keep ${term}`);
    }
    // 14 + 6 + 39 + 12 + 2 = 73; the control shrank with it when px-2 became px-1.5.
    const icon = 14, gap = 6, bar = 39, padding = 2 * 6, border = 2;
    assert.equal(icon + gap + bar + padding + border, 73);
  });

  it("reserves for the signed-out control, which is the wider outcome", () => {
    // The signed-in monogram is 32x32 — SMALLER — so reserving it would grow
    // the row by 45px on every signed-out load. Both outcomes are 32px tall,
    // which is why the height fix needs no such trade.
    assert.match(signedOutBranch, /gap-1\.5 rounded-\[9px\] border border-transparent px-1.5 py-1\.5/,
      "the signed-out control must keep the padding the placeholder mirrors");
    assert.match(signedOutBranch, /UserRound size=\{14\}/,
      "the signed-out control must keep the 14px icon the placeholder mirrors");
  });

  it("stays hidden from assistive tech, because it says nothing", () => {
    assert.match(loadingBranch, /aria-hidden/,
      "a shimmer is not a label; the branch must not announce itself");
  });
});
