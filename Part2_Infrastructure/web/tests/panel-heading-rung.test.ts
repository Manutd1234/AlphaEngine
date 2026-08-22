/**
 * The first heading under a subtab rail is ONE size on every tab.
 *
 * This is the fifth guard written against one complaint, and the previous four
 * failed the same way: they measured the CONTROL. The user said the subtabs
 * "enlarge", so four passes looked at the button — its weight, its rung, its
 * padding, the rail's height — and each found the button clean, because it is.
 * Measured over CDP across eight rails, 48 tabs, rest/selected/hover/focus and
 * three text sizes (865 observations), a selected tab differs from its
 * neighbours in zero of seventeen box and type properties.
 *
 * What moves is the heading BELOW the rail. Measured in Chrome at 1512px,
 * comfortable, before this change:
 *
 *   Portfolio   all five sections 20.5px       <- the user's stated reference
 *   Data        Work Queue 24.5px
 *   Developer   CI/CD and API & Schema 24.5px, Code & Diffs 24.5px, Task Queue 24.5px
 *
 * Four selectors carried `--fs-h1` in the position where every other tab shows a
 * card title, so switching subtab changed the first thing under the rail by four
 * pixels. The role those four belonged to — "section head" — is defensible on
 * its own and indefensible in that position, which is why this is a rung change
 * rather than a new rule: they are card heads and now take the card-title rung.
 *
 * WHY THE REASONING IS HERE AND NOT BESIDE THE RULES. All three stylesheets sit
 * at a file-size ratchet with zero or one line of headroom, so the change had to
 * be an in-place token swap with no line added. This file is the comment.
 *
 * REJECTED: levelling upward, by moving Portfolio and the other four uniform
 * tabs to --fs-h1. It would have satisfied "don't change size" equally, and it
 * makes the majority of the desk louder to accommodate the minority — against a
 * reference the user chose precisely because it was calm.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

/** The rung every first-position panel heading resolves to. */
const CARD_TITLE_RUNG = "--fs-h2";

/**
 * Each selector that renders the first heading inside a subtab panel, with the
 * partial that owns it. Named individually rather than matched by pattern: a
 * regex over "h2 in a heading-ish container" would have caught none of these,
 * because the four that drifted are named after a workboard, an explorer, a work
 * queue and a hero — the drift hid in the naming, not in the shape.
 */
const FIRST_HEADINGS: ReadonlyArray<readonly [file: string, selector: string]> = [
  ["app/globals/07-data-operations.css", ".data-workboard__heading h2"],
  ["app/globals/08-developer-engineering.css", ".codebase-explorer__heading h2"],
  ["app/globals/08-developer-engineering.css", ".developer-work__heading h2"],
  ["app/globals/10-developer-control-plane.css", ".developer-cp-section-hero h2"],
];

/** The declared font-size inside one selector's own block, or null. */
function rungOf(css: string, selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!block) return null;
  const size = /font-size:\s*var\((--fs-[a-z0-9-]+)\)/.exec(block[1]);
  return size ? size[1] : null;
}

describe("the first heading under a subtab rail", () => {
  for (const [file, selector] of FIRST_HEADINGS) {
    it(`${selector} is the card-title rung`, () => {
      const rung = rungOf(read(file), selector);
      assert.notEqual(rung, null, `${selector} declares no font-size in ${file}`);
      assert.equal(
        rung,
        CARD_TITLE_RUNG,
        `${selector} renders where every other tab shows a card title, so it must be ` +
          `${CARD_TITLE_RUNG}. At --fs-h1 it is four pixels taller, and switching to that ` +
          `subtab moves the first thing under the rail — the defect the user reported five times.`,
      );
    });
  }

  it("they all agree, which is the property the user actually asked for", () => {
    const rungs = FIRST_HEADINGS.map(([file, selector]) => rungOf(read(file), selector));
    assert.equal(
      new Set(rungs).size,
      1,
      `the first heading resolves to ${new Set(rungs).size} different rungs across tabs: ` +
        `${FIRST_HEADINGS.map(([, s], i) => `${s} -> ${rungs[i]}`).join(", ")}`,
    );
  });
});

describe("a heading inside a card does not outrank the card's own title", () => {
  /**
   * Code & Diffs nests `.codebase-detail__header h3` inside the same
   * `.card.codebase-explorer` whose `h2` is the title. Both carried --fs-h1, so
   * the h3 EQUALLED its parent; moving only the h2 down would have made the
   * child louder than the parent, which is worse than the flattening it
   * replaced. The h3 takes --fs-title, the plurality rung among in-card h3s on
   * this desk (`.pipeline-card h3`, `.handoff-head h3`) — followed rather than
   * invented, because inventing a rung per component is how this drifted.
   */
  const LADDER = ["--fs-h2", "--fs-title"] as const;

  it("Code & Diffs descends from card title to in-card head", () => {
    const css = read("app/globals/08-developer-engineering.css");
    assert.equal(rungOf(css, ".codebase-explorer__heading h2"), LADDER[0]);
    assert.equal(
      rungOf(css, ".codebase-detail__header h3"),
      LADDER[1],
      "the detail header sits INSIDE the explorer card, so it must be a rung below the " +
        "card's own title; equal or larger is a flattening a reader cannot navigate by",
    );
  });
});
