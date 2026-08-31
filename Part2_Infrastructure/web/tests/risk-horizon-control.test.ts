/**
 * The shared forward horizon is styled without forking the shared seg.
 *
 * This suite used to pin the OTHER half of that sentence too — that the row
 * became a two-track grid and the seg stretched to fill a `1fr` track, written
 * for "i want it to be bigger, there is so much space to the right of it". The
 * desk then reported the result: "reduce the size of the 10d 30d 90d dont need
 * occupy the entire row." The stretch is gone, and the assertions that pinned
 * it went with it rather than being softened into something that would pass
 * either way. What replaced them lives in `risk-rail-fit.test.ts`, which pins
 * the opposite just as hard: content-sized, with a fingertip floor.
 *
 * What stays here is the constraint that outlived both answers, and it is the
 * interesting half. `.seg` and `.seg button` are converged in
 * `12-workspace-standardisation.css` onto one size across the workspace, with the
 * note "the ask was consistent and NOT bigger", and
 * `15-navigator-and-trailing-layer.css` raises the same floor to 40px for
 * coarse pointers. Whatever this partial does to the horizon row, it must do
 * without redeclaring one metric the shared rules own: no padding, no
 * font-size, no min-height, no border. That held for the stretch and it holds
 * for the floor that replaced it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readSource, stripCode } from "./helpers/source-files";

const density = readSource("app/globals/14e-density-risk.css");
/** Selector text and declarations only; the prose above names what it avoids. */
const rules = density.replace(/\/\*[\s\S]*?\*\//g, "");
const seg = stripCode(readSource("components/risk/HorizonSeg.tsx"));

describe("the row styles the seg's box and nothing inside it", () => {
  it("does not redistribute the segments itself", () => {
    // `.seg button { flex: 1 }` in 00 equalises them; this partial has never
    // needed to say so and must not start. Survives the stretch's removal
    // unchanged, because it was never about the stretch.
    assert.doesNotMatch(rules, /\.risk-horizon[^{]*\.seg button \{[^}]*flex:/);
  });

  it("the label is legible beside the control it names", () => {
    assert.match(rules, /\.risk-horizon > span \{[^}]*font-size: var\(--fs-sm\)/,
      "12.5px beside the seg reads as a caption that lost its subject");
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
