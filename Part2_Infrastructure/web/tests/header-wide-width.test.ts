/**
 * The header's desktop rail — and proof that its fixed rhythm does not create
 * a hidden width rung.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The original wide fix put a flex-grown empty spacer between Diffusion and
 * Telegram. It kept the right edge aligned by turning every spare desktop
 * pixel into a variable hole in the middle of the command rail. The current
 * contract has no spacer at all: the tabs are content-led and the same 6px gap
 * joins every neighbouring destination and action.
 *
 * The dangerous way to answer that is to take width from somewhere. There is
 * nowhere to take it from: at 1440 the guest row overflows its clip by 15px on
 * the widest strings, and `overflow-x: clip` swallows the evidence — the exact
 * defect df63e49 fixed and the data-tier chip re-opened at 30px past the clip.
 * The assertions below therefore pin both sides: no fixed replacement track
 * may appear, and the priority ladder underneath stays explicit.
 *
 * The second half is the one that matters. `header-ladder.test.ts` pins what
 * each rung sheds; this pins the SET of widths the header reacts to at all, so
 * a new narrow rung, a moved threshold or a quietly deleted one fails here
 * even when every individual rung still reads correctly.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { globalsCss, readGlobalsPartial } from "./globals-css";

/** Comment bodies blanked, newlines kept, so prose is never read as a rule. */
const css = globalsCss.replace(/\/\*[\s\S]*?\*\//g, (block) =>
  block.replace(/[^\n]/g, " "));

const shell = readGlobalsPartial("app/globals/01-workspace-shell.css");
const standardisation = readGlobalsPartial("app/globals/12-workspace-standardisation.css");
const header = readFileSync(new URL("../components/WorkspaceHeader.tsx", import.meta.url), "utf8");

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

describe("the parser reads the whole cascade", () => {
  // A walker that quietly returned nothing would make every assertion below
  // vacuously true — the shape of dead test this codebase keeps catching.
  it("finds the media blocks it is about to reason over", () => {
    assert.ok(mediaBlocks.length > 40, `only ${mediaBlocks.length} @media blocks parsed`);
    assert.ok(headerBlocks.length > 15, `only ${headerBlocks.length} header blocks parsed`);
  });
});

describe("the desktop rail has no manufactured middle track", () => {
  it("contains neither a spacer element nor a spacer selector", () => {
    assert.doesNotMatch(header, /header-spacer/,
      "the component reintroduced an empty flex child between navigation and Telegram");
    assert.doesNotMatch(css, /\.header-spacer\b/,
      "a spacer rule or media rung would make the seam viewport-dependent again");
  });

  it("fills the row through the tabs and makes the pseudo-element generate nothing", () => {
    assert.match(css, /\.workspace-tabs \{[^}]*gap: 2px;[^}]*flex: 1 1 auto;/,
      "the tab strip must absorb surplus so the operator cluster reaches the right edge");
    assert.match(css, /\.workspace-tabs button \{[^}]*flex: 1 1 auto;/,
      "each destination must share the available rail");
    assert.match(css, /\.workspace-tabs::after \{\s*content: none;\s*\}/,
      "a zero-width generated flex item still incurs a second gap");
  });

  it("uses borderless destinations and outlined signals on a common 42px control rail", () => {
    assert.match(
      css,
      /\.workspace-tabs button \{[^}]*min-height: 42px;[^}]*padding: 7px 6px;[^}]*border: 0;[^}]*border-radius: 6px;/,
    );
    assert.match(
      css,
      /\.workspace-header__utility > :is\(button, a\),\s*\.workspace-header__utility > \.header-anchor > :is\(button, a\) \{\s*min-height: 42px;\s*\}/,
    );
    assert.match(
      css,
      /\.workspace-header__utility > :is\(\.telegram-cta, \.header-command-button, \.latency-chip, \.system-health-action\),[\s\S]*?\.header-anchor > :is\(\.data-tier, \.header-kill-trigger\)[\s\S]*?box-shadow:/,
      "the operator controls lost their subtle shared outline hierarchy",
    );
  });
});

describe("the narrow ladder is exactly where it was — the regression guard", () => {
  /**
   * Every width the header reacts to, in cascade order. There is deliberately
   * no min-width desktop rung: surplus no longer changes the middle seam.
   *
   * A snapshot on purpose. `header-ladder.test.ts` asserts what each rung
   * SHEDS; the failure this list catches is different and quieter — a rung
   * added, retuned or dropped while every surviving rung still reads
   * correctly. Update it only with a re-measured row, and say the widths.
   *
   * Re-measured over Chrome on 2026-08-24 for the tenth tab (Markets), then
   * REORDERED the same day: the first pass folded the data-tier and Connect
   * labels at 1800 and 1740, so a 1722px desk lost the words "Live" and
   * "Connect" while the brand tagline stayed. The tagline is rung 4 now.
   * `14p-header-ladder-tenth-tab.css` carries the eleven widths the row was
   * measured to need — 2046 unfolded down to 1059 with everything folded, with
   * the widest string each chip can show forced — and each rung sits at the
   * previous figure rounded up to a ten.
   *
   * The ORDER of this list is source order, not rung order: 14p is imported
   * after 14, so rungs 4 and 11 sit at the end of it.
   */
  const LADDER = [
    "@media (max-width: 2160px)",                        // rung 1, the Search word
    "@media (max-width: 1720px)",                        // rung 5, the "Live data" label
    "@media (min-width: 901px)",                         // the nav's left margin
    "@media (max-width: 900px)",                         // the tabs take their own row
    "@media (max-width: 720px)",
    "@media (max-width: 520px)",
    "@media (max-width: 1110px)",                        // the row wraps
    "@media (max-width: 900px)",
    "@media (max-width: 900px)",
    "@media (max-width: 620px)",                         // the switcher goes
    "@media (min-width: 901px) and (max-width: 2160px)", // rung 1
    "@media (min-width: 901px) and (max-width: 1950px)", // rung 2
    "@media (min-width: 901px) and (max-width: 1850px)", // rung 3
    "@media (min-width: 901px) and (max-width: 1280px)", // rung 10
    "@media (min-width: 901px) and (max-width: 1790px)", // rung 4, the tagline (14p)
    "@media (min-width: 901px) and (max-width: 1590px)", // rung 7, contained full tab rail (14p)
    "@media (min-width: 901px) and (max-width: 1280px)", // rung 11, the wordmark (14p)
    "@media (max-width: 620px)",
    "@media (pointer: coarse)",
    "@media (forced-colors: active)",
    "@media print",
  ];

  it("no width was added to, removed from or moved on the ladder", () => {
    assert.deepEqual(headerBlocks.map((block) => block.condition), LADDER);
  });

  it("the measured compact rungs remain after removing the obsolete wide rung", () => {
    assert.doesNotMatch(headerBlocks.map((block) => block.condition).join("\n"), /min-width: 1441px/,
      "the retired spacer-only wide rung returned");
    for (const max of [2160, 1950, 1850, 1790, 1590, 1280]) {
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
    assert.match(
      css,
      /\.workspace-tabs button:hover:not\(:disabled\):not\(\[aria-selected="true"\]\)/,
      "hover must not replace the active destination's stronger selected paint",
    );
    assert.match(css, /\.workspace-tabs button::after \{[^}]*background: transparent;/);
    assert.match(
      css,
      /\.workspace-tabs button\[aria-selected="true"\] \{[^}]*background: transparent;/,
      "the active destination should rely on its underline instead of a bordered or filled box",
    );
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
      /\.workspace-header__utility \{\n  min-height: var\(--chrome-header\);\n  padding-left: 16px;\n  padding-right: 16px;\n\}/,
      "12 is where the row's box lives; if it moved, 01's deletion has to be revisited",
    );
  });

  it("the ≤720 block no longer re-pads the row or the shell", () => {
    const narrow = /@media \(max-width: 720px\) \{([\s\S]*?)\n\}\n/.exec(shell)![1];
    assert.doesNotMatch(narrow, /padding-left|padding-right/, "the ≤720 paddings lost the cascade to 12 and are gone");
    assert.doesNotMatch(narrow, /\.workspace-shell \{/, "`.workspace-shell` is declared once, in 12");
  });
});
