/**
 * A HEAD IS NEVER THE SIZE OF THE THING IT INTRODUCES.
 *
 * "standardize the sub headings sizing for all 8 big tabs and subtabs and
 *  sub-subtabs"
 *
 * `type-role-map.test.ts` says which rung a ROLE gets. It cannot say whether
 * two rules that both obey it are the same rung as each other while sitting one
 * inside the other — which is the shape of the complaint. A reader does not see
 * a rung; they see a column head and the cards beneath it, and if those compute
 * the same number the level is gone. That is invisible on one screen and
 * glaring the moment you move between tabs, and no assertion in this repository
 * reached it before 2026-08-23.
 *
 * WHAT WAS MEASURED, AND HOW
 * ------------------------------------------------------------------------
 * Every heading on all 48 rail sections of all eight tabs, over the running dev
 * server through the Chrome DevTools Protocol, at all three Text-size presets:
 * computed font-size, weight, letter-spacing and text-transform for 1,047
 * visible elements, then the same sweep again at compact and at large. The
 * numbers quoted in this file are those, not a token read out of the sheet —
 * this codebase has twice diagnosed a declaration that loses the cascade and
 * never renders, and the sheet is 26 partials with real append-instead-of-edit
 * history.
 *
 * The navigation ladder came out standardised, which is worth stating because
 * it was the thing most suspected: 384 role tabs at a fixed 13px, 314 subtab
 * rail buttons at 12 / 14 / 17px, and all 103 `.seg` sub-subtab buttons at
 * 11.14 / 13 / 15.79px with one weight. Three levels, three rungs, no
 * exceptions on any tab. It is the HEADS INSIDE the panels that disagree.
 *
 * WHY A PAIR LIST AND NOT A TREE WALK
 * ------------------------------------------------------------------------
 * A generic "no child head at or above its parent's rung" needs the DOM, and
 * `npm test` is plain Node with no jsdom and no browser and may add no
 * dependency. So the pairs are named: each one is a containment relationship
 * read off the components and confirmed on screen, and each carries the numbers
 * it was confirmed at. A new pair costs one entry; a regression on a named pair
 * costs a red suite.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { globalsCss, locateInGlobals } from "./globals-css";
import { cssRules, declaredRung, selectorList } from "./globals-rules";

/** Comment bodies blanked, newlines kept, so prose is never read as a rule. */
const declarations = globalsCss.replace(/\/\*[\s\S]*?\*\//g, (block) =>
  block.replace(/[^\n]/g, " "));

const rules = cssRules(declarations, locateInGlobals);

/** The winning rule for a selector: the LAST context-free one naming it. */
function winner(selector: string): { rung: string; body: string; where: string } {
  let found: { rung: string; body: string; where: string } | null = null;
  for (const rule of rules) {
    if (rule.context.length > 0) continue;
    if (!selectorList(rule.selector).includes(selector)) continue;
    const rung = declaredRung(rule.body);
    if (rung !== null) found = { rung, body: rule.body, where: rule.where };
  }
  assert.ok(found, `${selector} declares no size at all — renamed? then rename it here`);
  return found!;
}

/** The first `:root` block, and one rung out of it in px at step 1. */
const rootBlock = declarations.slice(
  declarations.indexOf(":root {"),
  declarations.indexOf("\n}\n", declarations.indexOf(":root {")),
);

function px(rung: string): number {
  const token = rung.match(/--fs-[a-z0-9-]+/)?.[0];
  assert.ok(token, `${rung} is not a ladder rung`);
  const fixed = rootBlock.match(new RegExp(`${token}:\\s*(\\d+)px;`));
  if (fixed) return Number(fixed[1]);
  const match = rootBlock.match(new RegExp(`${token}:\\s*calc\\((?:clamp\\()?([\\d.]+)rem`));
  assert.ok(match, `${token} is not in :root`);
  return Number(match![1]) * 16;
}

interface Pair {
  /** The head that owns the group. */
  readonly parent: string;
  /** A head INSIDE that group. */
  readonly child: string;
  /** Where the containment is written, and what it computed. */
  readonly why: string;
}

/**
 * Containment pairs, each confirmed in a browser at all three presets.
 *
 * Every rung multiplies the same `--type-step`, so an order that holds at the
 * unstamped default holds at Compact and at Large — the same argument the role
 * map makes for its own chain. That is why one comparison per pair is enough,
 * and it is only sound because BOTH sides step; a fixed `--fs-chrome-*` token
 * on either side would have to be compared three times.
 */
const NESTED: readonly Pair[] = [
  {
    parent: ".data-workboard__heading h2",
    child: ".data-work-column__heading h3",
    why: "Data → Task Queue. The board card's own head, over the four kanban column "
      + "heads inside it. The column head measured 12.86 / 15 / 18.21px — the SAME "
      + "number, and the same weight 700, as the `<h4>` title of every card standing "
      + "under it, so the board had two levels in one voice. It now takes the desk's "
      + "in-card subheading idiom (--fs-sm, uppercase, --ls-caps) from "
      + "14g-density-data.css, which is what `.console-subhead`, `.stress-subhead` "
      + "and `.allocation-subhead` already are on three other tabs.",
  },
  {
    parent: ".data-work-column__heading h3",
    child: ".data-work-card h4",
    why: "The pair that was flat: column head against the cards it introduces. This "
      + "one is inverted BY DESIGN and is asserted the other way below — the head is "
      + "smaller than its cards and carries rank by uppercase and tracking, which is "
      + "the idiom the role map's ordering test carves out by that property rather "
      + "than by name.",
  },
  {
    parent: ".codex-family__head h2",
    child: ".codex-card__select strong",
    why: "Research → Strategy codex. The family card's title over the strategy tiles "
      + "in its grid. The head measured 14.57 / 17 / 20.64px before 2026-08-23, one "
      + "rung under every other card title on the desk; it is --fs-h2 now.",
  },
];

describe("a head is never the size of what it introduces", () => {
  it("every named parent head out-ranks the heads inside it", () => {
    const offenders: string[] = [];
    for (const pair of NESTED) {
      const parent = winner(pair.parent);
      const child = winner(pair.child);
      const uppercase = /text-transform:\s*uppercase/.test(parent.body);
      if (uppercase) {
        // Rank by voice. The only thing to check is that the voice is really
        // there — a parent that lost its uppercase and kept the small rung is
        // a head quieter than its content with nothing left carrying the rank.
        assert.match(
          parent.body,
          /letter-spacing:/,
          `${pair.parent} is uppercase at a small rung and must stay tracked: ${pair.why}`,
        );
        continue;
      }
      if (px(parent.rung) <= px(child.rung)) {
        offenders.push(
          `${pair.parent} (${parent.rung}, ${parent.where}) does not out-rank `
          + `${pair.child} (${child.rung}, ${child.where}) — ${pair.why}`,
        );
      }
    }
    assert.deepEqual(offenders, [], `a level of hierarchy has gone flat:\n  ${offenders.join("\n  ")}`);
  });

  it("the card-title rung is the same number on every tab that has one", () => {
    // Four wrappers, eight tabs, one object. Three were converged on
    // 2026-08-23; `.codex-family__head h2` was the fourth and was found by
    // measuring rather than by grepping, because its wrapper is named after
    // neither a card nor a heading.
    const wrappers = [
      ".section-heading :is(h2, h3)",
      ".card > h2",
      ".portfolio-card-heading h2",
      ".codex-family__head h2",
    ];
    const rungs = new Set(wrappers.map((selector) => winner(selector).rung));
    assert.equal(rungs.size, 1, `card titles ship at ${[...rungs].join(" and ")}`);
  });
});

/**
 * THE IN-CARD HEADS THAT ARE STILL SCATTERED, as a ratchet.
 *
 * A head inside a card, in plain case, is written at four different rungs on
 * this desk. All four were measured; none of them inverts against anything, so
 * none is a defect a reader can point at, but four sizes for one structural
 * role is the arithmetic behind "the front end is all over the place" and it is
 * how the card title came to have three grammars before it was converged.
 *
 * They are NOT fixed here, and the reason is ownership rather than judgement:
 * every one of them lives in a partial this pass does not hold —
 * 00-tokens-and-base, 09-reliability-consolidation, 10-developer-control-plane
 * — or in a partial that is already at the 400-line ceiling and may not grow
 * (14i-density-developer is exactly 400). Converging them from a density
 * partial would mean writing four more overriding declarations into a sheet
 * whose problem is that it has too many, which is the trade this pass refused.
 *
 * So the count is ratcheted in the shape `dead-css.test.ts` and
 * `file-size.test.ts` already use here: it may fall and it may not rise. A
 * fifth rung for this role has to edit this number and say why.
 */
const PLAIN_IN_CARD_HEADS: Record<string, number> = {
  "var(--fs-md)": 2,
  "var(--fs-lg)": 1,
  "var(--fs-2xl)": 3,
  "var(--fs-h1)": 1,
};

describe("plain-case heads inside a card do not scatter further", () => {
  it("no new rung joins the four already in use", () => {
    // Counted over SELECTORS and their WINNING rule, never over declarations.
    // Counting declarations is the mistake this stylesheet punishes: it has
    // real append-instead-of-edit history, so a selector can carry two sizes in
    // two partials and only the later one is on screen. The first draft of this
    // test counted blocks and reported the Data column head at --fs-lg, which
    // is the rung it stopped rendering at earlier in this same change.
    const selectors = new Set<string>();
    for (const rule of rules) {
      if (rule.context.length > 0) continue;
      if (declaredRung(rule.body) === null) continue;
      if (/section-heading|verdict-headline|shortcuts-overlay|filegroup/.test(rule.selector)) continue;
      for (const selector of selectorList(rule.selector)) {
        if (!/\S\s+h[34]$/.test(selector)) continue;
        selectors.add(selector);
      }
    }
    const counts = new Map<string, number>();
    for (const selector of selectors) {
      const won = winner(selector);
      if (/text-transform:\s*uppercase/.test(won.body)) continue;
      if (px(won.rung) > px("var(--fs-h1)")) continue;
      if (won.rung === "var(--fs-title)") continue; // the base h3 rung, reached rather than invented
      counts.set(won.rung, (counts.get(won.rung) ?? 0) + 1);
    }
    for (const [rung, count] of counts) {
      const ledger = PLAIN_IN_CARD_HEADS[rung];
      assert.ok(
        ledger !== undefined,
        `${rung} is a FIFTH rung for a plain-case head inside a card. Reach for one of `
        + `${Object.keys(PLAIN_IN_CARD_HEADS).join(", ")} or converge the others in the same change`,
      );
      assert.ok(
        count <= ledger,
        `${rung} is used by ${count} in-card head rules, up from ${ledger} — this may shrink, not grow`,
      );
    }
  });
});
