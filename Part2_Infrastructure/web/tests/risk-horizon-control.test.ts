/**
 * The shared forward horizon takes the row it is standing in.
 *
 * Reported: "fix the monte carlo dates 1d 10d 30d 90d i want it to be bigger,
 * there is so much space to the right of it." Accurate. `.seg` is a
 * shrink-to-fit flex box inside `.risk-horizon`, which is a flex row, so four
 * two-glyph labels sized the control at roughly 180px and left the rest of a
 * desk-width panel empty — on the one control that governs BOTH loss estimates
 * on this tab, which is exactly why it sits above a card rather than in its
 * heading.
 *
 * The constraint that shaped the fix is the interesting half. `.seg` and
 * `.seg button` are being converged in `12-workspace-standardisation.css` onto
 * one size for all eight tabs, with the note "the ask was consistent and NOT
 * bigger", and `15-navigator-and-trailing-layer.css` raises the same floor to
 * 40px for coarse pointers. So this partial changes the BOX the seg occupies
 * and not one property of the seg itself: no padding, no font-size, no
 * min-height, no border. The two assertions that matter here are therefore in
 * opposite directions — the row must claim the width, and the partial must
 * still not redeclare a single metric the shared rules own.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readSource, stripCode } from "./helpers/source-files";

const density = readSource("app/globals/14e-density-risk.css");
/** Selector text and declarations only; the prose above names what it avoids. */
const rules = density.replace(/\/\*[\s\S]*?\*\//g, "");
const seg = stripCode(readSource("components/risk/HorizonSeg.tsx"));

describe("the control fills the space that was empty beside it", () => {
  it("the row becomes a two-track grid at tablet width and up", () => {
    assert.match(rules, /@media \(min-width: 720px\)[\s\S]*?\.risk-horizon \{[^}]*grid-template-columns: auto minmax\(0, 1fr\)/,
      "the label takes its own width, the seg takes the rest");
  });

  it("the seg is told to fill its track", () => {
    assert.match(rules, /\.risk-horizon > \.seg \{[^}]*width: 100%/);
  });

  it("the four segments spread themselves, through the shared flex rule", () => {
    // `.seg button { flex: 1 }` in 00 is what distributes them once the
    // container has a width. Nothing here needs to say so, and this asserts
    // that nothing here DOES: the fix is one width declaration, not four.
    assert.doesNotMatch(rules, /\.risk-horizon[^{]*\.seg button \{[^}]*flex:/);
  });

  it("the label is legible against a control that now spans the panel", () => {
    assert.match(rules, /\.risk-horizon > span \{[^}]*font-size: var\(--fs-sm\)/,
      "12.5px over a full-width control reads as a caption that lost its subject");
  });
});

describe("the shared seg rules are not forked at this one call site", () => {
  /** Every metric `12-workspace-standardisation.css` and 00 own on the seg. */
  const OWNED = ["min-height", "padding", "font-size", "border", "background", "box-shadow"];

  it("no seg metric is redeclared in this partial", () => {
    const segRules = [...rules.matchAll(/([^{}]*\.seg[^{}]*)\{([^}]*)\}/g)];
    assert.ok(segRules.length > 0, "the partial must still be styling the seg's box, or this proves nothing");
    for (const [, selector, body] of segRules) {
      for (const property of OWNED) {
        assert.ok(
          !new RegExp(`(^|;|\\s)${property}\\s*:`).test(body),
          `14e sets ${property} on "${selector.trim()}" — that belongs to the shared convergence, `
          + "not to one row on one tab",
        );
      }
    }
  });

  it("every size in this partial reads the token ladder", () => {
    // One numeric exception is allowed and it is the media query itself.
    const literals = [...rules.matchAll(/(?:font-size|gap|margin[a-z-]*|padding[a-z-]*|column-gap):\s*([^;]+);/g)]
      .map(([, value]) => value.trim())
      .filter((value) => !/var\(--/.test(value) && value !== "0");
    assert.deepEqual(literals, [], `these bypass the token ladder:\n  ${literals.join("\n  ")}`);
  });
});

describe("the control still says what it is", () => {
  it("keeps its visible name and its four choices", () => {
    // The name is the price of sitting above a card instead of in its
    // heading: a bare row reading "1d 10d 30d 90d" could as easily be the bar
    // interval being resampled. Widening it makes that MORE true, not less.
    assert.match(seg, /<span>Forward horizon<\/span>/);
    assert.match(seg, /MC_HORIZON_CHOICES = \[1, 10, 30, 90\]/);
  });

  it("each segment says which horizon it sets, for both estimates", () => {
    assert.match(seg, /Run both estimates over a \$\{choice\}-day forward horizon/);
    assert.match(seg, /aria-pressed=\{days === choice\}/,
      "selection is carried by state, never by colour alone");
  });
});
