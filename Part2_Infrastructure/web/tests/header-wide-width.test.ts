/**
 * The header's WIDE band — and, far more importantly, proof that adding it
 * changed nothing narrower.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * "fix the top bar also to utilize the empty space since now it is a bit
 * small." The empty space is real and it is measurable: `.workspace-tabs` and
 * `.header-spacer` are both `flex: 1` over a 0 basis, so every spare pixel in
 * the row is split 50/50 between the eight destinations and an empty `<div>`.
 * At 2560 both measured exactly 623.7px on live strings (592.8px on the
 * sweep's widest ones). Half the gap a reader sees is the nav's share already;
 * the other half is the spacer doing nothing at all with it.
 *
 * The dangerous way to answer that is to take width from somewhere. There is
 * nowhere to take it from: at 1440 the guest row overflows its clip by 15px on
 * the widest strings, and `overflow-x: clip` swallows the evidence — the exact
 * defect df63e49 fixed and the data-tier chip re-opened at 30px past the clip.
 * So the answer is a min-width rung that only ever REDISTRIBUTES SURPLUS, and
 * the assertions below are in two halves: the rung exists and is shaped so it
 * cannot clip, and the ladder underneath it is byte-for-byte where it was.
 *
 * The second half is the one that matters. `header-ladder.test.ts` pins what
 * each rung sheds; this pins the SET of widths the header reacts to at all, so
 * a new narrow rung, a moved threshold or a quietly deleted one fails here
 * even when every individual rung still reads correctly.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { globalsCss, readGlobalsPartial } from "./globals-css";

/** Comment bodies blanked, newlines kept, so prose is never read as a rule. */
const css = globalsCss.replace(/\/\*[\s\S]*?\*\//g, (block) =>
  block.replace(/[^\n]/g, " "));

const shell = readGlobalsPartial("app/globals/01-workspace-shell.css");
const standardisation = readGlobalsPartial("app/globals/12-workspace-standardisation.css");

/** Anything that paints, sizes or hides a control in the utility row. */
const HEADER_SELECTOR =
  /\.workspace-header|\.workspace-tabs|\.header-|\.brand-|\.latency-chip|\.system-health|\.data-tier|\.workspace-switcher|\.anchored-panel/;

interface MediaBlock {
  /** The condition text as written, whitespace-collapsed. */
  readonly condition: string;
  readonly body: string;
}

/**
 * Every `@media` block in the cascade, brace-matched.
 *
 * Hand-walked rather than regexed for the reason `seg-metrics.test.ts` gives:
 * a regex that stops at the first `}` reads a media query's first RULE as the
 * whole block, which would make everything below vacuously true.
 */
const mediaBlocks: MediaBlock[] = (() => {
  const found: MediaBlock[] = [];
  const opener = /@media([^{]*)\{/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(css))) {
    let depth = 1;
    let i = opener.lastIndex;
    while (depth > 0 && i < css.length) {
      if (css[i] === "{") depth += 1;
      if (css[i] === "}") depth -= 1;
      i += 1;
    }
    assert.equal(depth, 0, `unclosed @media${match[1]}`);
    found.push({
      condition: `@media${match[1].replace(/\s+/g, " ").trimEnd()}`,
      body: css.slice(opener.lastIndex, i - 1),
    });
  }
  return found;
})();

/** The blocks that reach a header control, in cascade order. */
const headerBlocks = mediaBlocks.filter((block) => HEADER_SELECTOR.test(block.body));

const one = (condition: string) => {
  const hits = headerBlocks.filter((block) => block.condition === condition);
  assert.equal(hits.length, 1, `expected exactly one header ${condition}, found ${hits.length}`);
  return hits[0].body;
};

describe("the parser reads the whole cascade", () => {
  // A walker that quietly returned nothing would make every assertion below
  // vacuously true — the shape of dead test this codebase keeps catching.
  it("finds the media blocks it is about to reason over", () => {
    assert.ok(mediaBlocks.length > 40, `only ${mediaBlocks.length} @media blocks parsed`);
    assert.ok(headerBlocks.length > 15, `only ${headerBlocks.length} header blocks parsed`);
  });
});

describe("the wide band exists, and it can only add", () => {
  const wide = one("@media (min-width: 1441px)");

  it("the surplus goes to the nav instead of splitting 50/50 with an empty div", () => {
    assert.match(
      wide,
      /\.header-spacer \{\s*flex-grow: 0;\s*\}/,
      "the wide rung no longer hands the row's surplus to the tabs",
    );
  });

  it("it starts above the band that has no slack to lend", () => {
    // 1441, not 1440: the measured clip band runs to 1440 inclusive, and the
    // gate is what makes "nothing narrower changed" textual rather than an
    // argument about flexbox.
    const threshold = Number(/min-width: (\d+)px/.exec("@media (min-width: 1441px)")![1]);
    assert.ok(threshold > 1440, `the wide rung starts at ${threshold}px, inside the protected band`);
    assert.doesNotMatch("@media (min-width: 1441px)", /max-width/, "a min-width rung may not carry a ceiling");
  });

  it("only the grow is dropped — the basis stays 0, which is the no-clip guarantee", () => {
    // The seductive version of this rung reserves the separation as a `width`
    // (or a `min-width`) on the spacer, so the nav and the cluster stay apart
    // at every width. Measured in Chrome 151 against the live row with the
    // sweep's widest strings, that is NOT free: a 20px basis does not collapse
    // under deficit — it put the row 12px past its clip at 1728 and 16px at
    // 1920, both of which fit exactly today. Only `flex-grow` may change here,
    // because grow is the one flex term that never runs when the surplus is 0.
    const spacer = /\.header-spacer \{([^}]*)\}/.exec(wide)![1];
    for (const property of ["width", "min-width", "flex-basis", "flex-shrink", "padding", "margin"]) {
      assert.doesNotMatch(
        spacer,
        new RegExp(`(^|[;\\s])${property}:`),
        `${property} on the wide spacer adds to the row's MINIMUM, which the clipping bands cannot pay`,
      );
    }
    assert.doesNotMatch(spacer, /flex:\s/, "the `flex` shorthand resets the basis; set flex-grow alone");
    assert.match(spacer, /flex-grow: 0;/);
  });

  it("the tabs are the row's only grower, so the utility cluster stays hard right", () => {
    // If the tabs stopped growing while the spacer already had, the leftover
    // space would collect at the END of the line and drag Settings, the
    // account chip and the kill switch leftwards into the middle of the bar.
    assert.match(css, /\.workspace-tabs \{[^}]*flex: 1;/, "the tab strip must keep flex-grow");
    assert.doesNotMatch(wide, /\.workspace-tabs \{[^}]*(max-width|flex-grow: 0|flex: 0)/,
      "capping the tabs here would move the surplus to the far right of the row");
    // Restated from `auth-header.test.ts`: a `min-width: 0` here would let the
    // strip shrink past its own labels instead of the ladder folding them.
    assert.doesNotMatch(css, /\.workspace-tabs \{\s*min-width: 0;/);
  });
});

describe("the narrow ladder is exactly where it was — the regression guard", () => {
  /**
   * Every width the header reacts to, in cascade order, with the wide rung as
   * the only min-width entry above 901px.
   *
   * A snapshot on purpose. `header-ladder.test.ts` asserts what each rung
   * SHEDS; the failure this list catches is different and quieter — a rung
   * added, retuned or dropped while every surviving rung still reads
   * correctly. Update it only with a re-measured row, and say the widths.
   *
   * RE-DERIVED 2026-08-25, WHEN THE STRIP TOOK ITS OWN LINE, and the list is
   * SHORTER than it was. Eleven tabs and eight controls could not share one
   * 1728px line — the reader met a settings control cut in half — so the tabs
   * are `flex-basis: 100%` now and the ladder measures against LINE 1 alone,
   * which needs ~1361px unfolded instead of 2046. Every rung fell with it, and
   * rungs 8 to 11 left the ladder entirely: re-derived they land at 890, 810,
   * 650 and 540, inside their own `min-width: 901px` floor. The extra
   * `@media (min-width: 901px)` near the end of the list is the two-row block
   * itself. `14p-header-ladder-tenth-tab.css` carries both derivations in
   * order, and each rung still sits at the previous figure rounded up to a ten.
   *
   * The ORDER of this list is source order, not rung order: 14p is imported
   * after 14, so rungs 4 and 11 sit at the end of it.
   */
  const LADDER = [
    "@media (max-width: 1380px)",                        // rung 1, the Search word
    "@media (max-width: 1050px)",                        // rung 5, the "Live data" label
    "@media (min-width: 1441px)",                        // the wide band added 2026-08-22
    "@media (min-width: 901px)",                         // the nav's left margin
    "@media (max-width: 900px)",                         // the tabs take their own row
    "@media (max-width: 720px)",
    "@media (max-width: 520px)",
    "@media (max-width: 1110px)",                        // the row wraps
    "@media (max-width: 900px)",
    "@media (max-width: 900px)",
    "@media (max-width: 620px)",                         // the switcher goes
    "@media (min-width: 901px) and (max-width: 1380px)", // rung 1
    "@media (min-width: 901px) and (max-width: 1280px)", // rung 2
    "@media (min-width: 901px) and (max-width: 1180px)", // rung 3
    "@media (min-width: 901px) and (max-width: 960px)",  // rung 7
    "@media (min-width: 901px) and (max-width: 1120px)", // rung 4, the tagline (14p)
    "@media (min-width: 901px)",                         // the strip takes its own line (14p)
    "@media (max-width: 620px)",
    "@media (pointer: coarse)",
    "@media (forced-colors: active)",
    "@media print",
  ];

  it("no width was added to, removed from or moved on the ladder", () => {
    assert.deepEqual(headerBlocks.map((block) => block.condition), LADDER);
  });

  it("nothing at or below 1440 was touched to pay for the wide band", () => {
    // The one rule that could have been: the spacer's desk declaration. It is
    // what every width up to 1440 still uses, unchanged.
    assert.match(shell, /\n\.header-spacer \{\n  flex: 1;\n\}\n/,
      "the desk spacer no longer grows — every width below 1441 just lost its right alignment");
    for (const max of [1380, 1280, 1180, 1120, 960]) {
      assert.ok(
        headerBlocks.some((block) => block.condition === `@media (min-width: 901px) and (max-width: ${max}px)`),
        `rung ${max} has left the ladder`,
      );
    }
  });

  it("the chrome type is still one px measurement at every width", () => {
    // The ladder's thresholds were measured at 13/12/11/16. Raising those at
    // wide widths is a defensible follow-up and NOT a token edit: fully
    // labelled, guest, the sweep's widest strings, the row needs 1916.0px at
    // 13/12/11/16 and 2010.2px at 14/13/12/17. So a lift is safe only from
    // 2100px up, where 89.8px is left over and no rung has to move; at 1728 it
    // costs +82.9px against 33.3px of slack. If someone ships it, this is the
    // assertion that makes them say the width out loud.
    for (const block of mediaBlocks) {
      // A DECLARATION, not a use: `var(--fs-chrome-tab)` carries no colon.
      if (!/--fs-chrome-[a-z]+:/.test(block.body)) continue;
      const min = /min-width: (\d+)px/.exec(block.condition);
      assert.ok(
        min && Number(min[1]) >= 2100 && !/max-width/.test(block.condition),
        `the chrome tokens are redeclared in ${block.condition}; the row does not fit a lift below 2100px`,
      );
    }
  });

  it("the selected tab is still said by something that is not colour", () => {
    // Restated here beside the width work: widening the strip must not be paid
    // for by letting hue alone carry selection.
    assert.match(css, /\.workspace-tabs button::after \{[^}]*background: transparent;/);
    assert.match(css, /\.workspace-tabs button\[aria-selected="true"\]::after \{\s*background: var\(--series-1\);/);
  });
});

describe("the row's box is declared once", () => {
  /**
   * Paid for out of the same file, which is what the 400-line ratchet asks.
   * Every line the wide band cost was reclaimed from declarations in 01 that
   * had already lost the cascade — the bar's paint and z-index to 13 and 12,
   * this row's height and inline padding to 12, and the ≤720 copies of both.
   * They were not merely redundant: a reader looking here was told the bar was
   * 62px when the browser had it at 56.
   */
  it("01 no longer restates the height and padding that 12 owns", () => {
    const utility = /\n\.workspace-header__utility \{([\s\S]*?)\n\}/.exec(shell)![1];
    for (const property of ["min-height", "padding-left", "padding-right"]) {
      assert.doesNotMatch(utility, new RegExp(`${property}:`), `01 has taken ${property} back`);
    }
    assert.match(
      standardisation,
      /\.workspace-header__utility \{\n  min-height: var\(--chrome-header\);\n  padding-left: var\(--shell-pad\);\n  padding-right: var\(--shell-pad\);\n\}/,
      "12 is where the row's box lives; if it moved, 01's deletion has to be revisited",
    );
  });

  it("the ≤720 block no longer re-pads the row or the shell", () => {
    const narrow = /@media \(max-width: 720px\) \{([\s\S]*?)\n\}\n/.exec(shell)![1];
    assert.doesNotMatch(narrow, /padding-left|padding-right/, "the ≤720 paddings lost the cascade to 12 and are gone");
    assert.doesNotMatch(narrow, /\.workspace-shell \{/, "`.workspace-shell` is declared once, in 12");
  });
});
