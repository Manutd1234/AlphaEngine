/**
 * The Coherence density partial, held to the same shape as the other nine.
 *
 * "increase the font size for words and headers, follow the example from the
 *  other 8 tabs to make it look good"
 *
 * `app/globals/14r-coherence-density.css` is checked against the FILE, by path,
 * rather than through the concatenated cascade. It was written that way while
 * the partial was outside the manifest and it is kept that way for a better
 * reason: a per-tab density partial's properties are properties of the FILE —
 * where a rule sits relative to the first `@media`, whether the file ends in a
 * newline — and the cascade cannot see any of them.
 *
 * The five it checks are the five that have gone wrong on this desk before, and
 * each is recorded at the site of the failure it prevents:
 *
 *  1. It ends in a newline. A dropped one welds the last line of this partial
 *     onto the first line of `15-navigator-and-trailing-layer.css`, which at a
 *     section boundary silently rewrites a selector.
 *  2. Every selector is scoped to `.coherence-plane`, the class BOTH consoles
 *     render, and every rule that can only ever match one tab additionally
 *     names `.proofs-plane` — the one tab class this file owns. The seam
 *     between the two partials is CONCERN, not tab, and that has been settled
 *     the other way twice: the first split of 2026-08-24 scoped 14q to
 *     `.markets-plane` and this file to `.proofs-plane`, one file per tab, and
 *     the two then declared `.coh-table`, `.coh-figure__caption`, the chips,
 *     `.coh-event__meta` and `.coh-svg-note` separately in two scopes with
 *     `.coh-surface__tick` disagreeing outright. Both tabs draw the same
 *     figures out of one component library, so their density pass is ONE pass:
 *     14q owns the prose ladder, 14r the diagram ladder plus packing, and no
 *     selector STRING is declared in both. That last invariant is
 *     `markets-sections.test.ts`'s to check, because it needs both files; this
 *     one holds the scope and the tab class.
 *  3. Nothing here sizes the seg. Four suites forbid a second selector doing
 *     that by name; the whole record is `nav-type-markets-coherence.test.ts`.
 *  4. Every size reads a token, and `--fs-tick` is untouched — it is SVG
 *     chart furniture in user units, and several figures on this tab derive
 *     their own label-truncation budgets from its value. The text rungs are
 *     the house ROLES since the third pass of 2026-08-24: reading prose at
 *     --fs-title (what `body` gives the other eight tabs), furniture at
 *     --fs-body, table cells at --fs-lg. Since the second
 *     pass of 2026-08-24 the partial also DECLARES two px tokens of its own,
 *     `--fs-diagram-label` (12px) and `--fs-diagram-legend` (13px): the
 *     diagram ladder's series-label and legend rungs, for the SVG text the
 *     review of that day called too small. They are pinned to those two
 *     values below, because a px token is the sheet's one sanctioned way to
 *     write a px size (`--fs-tick` is the precedent) and an unpinned one is a
 *     literal with extra steps.
 *  5. Every packing rule sits inside a `min-width` query, so a phone keeps the
 *     single-column flow. Same split as `14g-density-data.css`, which is the
 *     partial this one is modelled on.
 *
 * Derived, never observed: there is no browser in this suite, so nothing here
 * says the type looks right — only that it reads the rung it claims to.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { declaredSelectors } from "./helpers/css-selectors";

const root = join(import.meta.dirname, "..");
const read = (relative: string) => readFileSync(join(root, relative), "utf8");

const PARTIAL = "app/globals/14r-coherence-density.css";
const partial = read(PARTIAL);
const console_ = read("components/CoherenceConsole.tsx");
const prices = read("components/MarketsConsole.tsx");
/** Comment bodies out: several of them name a rung they are arguing against. */
const body = partial.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * Every selector the partial declares, one per RULE.
 *
 * `declaredSelectors` is paren-aware, so a `:is()` list of twenty class names
 * counts once instead of nineteen times as an unscoped selector — which is what
 * the local comma split here used to do, and it made the scoping assertion
 * below report the entire file.
 */
const selectors = declaredSelectors(partial);

describe("the coherence density partial", () => {
  it("ends in a newline, so it cannot weld onto the next partial", () => {
    assert.ok(partial.endsWith("\n"), `${PARTIAL} does not end in a newline`);
  });

  it("declares at least one rule, so these assertions measure something", () => {
    // Rules, not comma-parts: see `declaredSelectors`. The floor moved from 20
    // to 12 when the splitter stopped counting each name inside an `:is()`.
    assert.ok(selectors.length >= 12, `only ${selectors.length} selectors — is the partial empty?`);
  });

  it("is scoped to the plane both consoles render", () => {
    // A rule that reached nothing is the quietest way a density pass dies, so
    // the class list on BOTH roots is checked here rather than assumed: each
    // console renders the shared engine plane plus a tab class of its own.
    assert.match(console_, /className="coherence-plane proofs-plane"/);
    assert.match(prices, /className="coherence-plane markets-plane"/);
    const unscoped = selectors.filter((selector) => !selector.includes(".coherence-plane"));
    assert.deepEqual(unscoped, [], `these rules are not scoped to the plane:\n  ${unscoped.join("\n  ")}`);
  });

  it("owns exactly one tab class, and it is this tab's", () => {
    // One tab class per partial. A `.markets-plane` rule here would be a rule
    // about the other tab living in this file, which is how the first split's
    // two partials each ended up maintaining half of the other's ladder.
    assert.ok(body.includes(".proofs-plane"), "the partial spends no tab class at all");
    assert.doesNotMatch(body, /\.markets-plane/,
      "14r reaches into the Prices plane; that rule belongs in 14q");
  });

  it("sizes nothing that names the seg", () => {
    const offenders = body.split("}").filter((rule) => /\bseg\b/.test(rule) && /font-size/.test(rule));
    assert.deepEqual(offenders, [], "the seg is sized once, in 12-workspace-standardisation.css");
  });

  it("reads every size off the ladder", () => {
    const off = [...partial.matchAll(/font-size:\s*([^;]+);/g)]
      .map((match) => match[1].trim())
      .filter((value) => !/^var\(--fs-[a-z0-9-]+\)$/.test(value));
    assert.deepEqual(off, [], `font sizes off the scale: ${off.join(", ")}`);
  });

  it("spends the three house text rungs and the two diagram rungs, nothing else", () => {
    // Three passes, each narrowing toward the role map. The first split
    // prose over --fs-body and --fs-sm; the second killed the --fs-sm tier;
    // the third review ("increase the body text size for all tabs in
    // markets and coherance") landed each element on its house ROLE rung:
    // reading prose at --fs-title, the rung the other eight tabs inherit
    // from `body` (the "body prose" role in type-role-map); captions, chips
    // and micro-labels one rung under at --fs-body; table cells at --fs-lg,
    // the bare `table` rule's own rung, with `th` deliberately unsized here
    // so headers read the house `th` rule. The two diagram tokens are this
    // partial's own and are pinned next; --fs-2xs stays banned as the
    // reading floor, and --fs-tick is not prose.
    const rungs = [...body.matchAll(/font-size:\s*var\((--fs-[a-z0-9-]+)\)/g)].map((match) => match[1]);
    assert.ok(rungs.length > 0, "no rung is declared at all");
    assert.deepEqual(
      [...new Set(rungs)]
        .filter((rung) => ![
          "--fs-title", "--fs-body", "--fs-lg", "--fs-diagram-label", "--fs-diagram-legend",
        ].includes(rung))
        .sort(),
      [],
      "prose at --fs-title, furniture at --fs-body, cells at --fs-lg, SVG at the two diagram tokens; a sixth rung is a decision to record",
    );
  });

  it("never sizes .coh-table th, so headers keep the house th rung", () => {
    // The bare `th` rule in 00 IS the "table header" role — one rung under
    // the cells it labels, uppercase and tracked. Restating a size on
    // `.coh-table th` here is how the second pass accidentally put headers
    // and cells on one rung; this holds the deletion.
    const sized = body
      .split("}")
      .filter((rule) => rule.includes(".coh-table th") && /font-size/.test(rule));
    assert.deepEqual(sized, [], "headers read the desk-wide th rule; size cells via .coh-table/.coh-table td");
  });

  it("pins the diagram tokens to the ladder, and leaves --fs-tick alone", () => {
    // SVG text does not step with the Text-size preference, so its rungs are
    // px tokens the way :root's --fs-tick is — and they may only hold values
    // type-diagram-ladder.test.ts already sanctions: 13 is the series/row
    // label rung, 14 the chart-title/legend rung, the loudest allowed. A
    // token drifting off those values would move every diagram at once with
    // nothing else failing, which is why the value is pinned here and not
    // only argued for in the partial's comment.
    //
    // RE-PINNED 2026-08-24, from 12 and 13. The ladder lifted a rung because a
    // reader could not read the words inside these figures; the ceiling is
    // compact --fs-title (14.571px) less the sheet's own 0.5px prose/furniture
    // separation, so 14.071px, and 14 is the last rung under it. Still an
    // exact equality on both tokens, not a range: the failure this catches is
    // a token drifting, and a range would not catch it.
    assert.match(body, /\.coherence-plane\s*{[^}]*--fs-diagram-label:\s*13px;/,
      "--fs-diagram-label must be 13px, the ladder's series-label rung, scoped to the plane");
    assert.match(body, /\.coherence-plane\s*{[^}]*--fs-diagram-legend:\s*14px;/,
      "--fs-diagram-legend must be 14px, the ladder's legend rung, scoped to the plane");
    assert.doesNotMatch(body, /--fs-tick\s*:/,
      "--fs-tick is :root's and is the ladder's floor; redefining it here would move every axis at once");
  });

  it("keeps every packing rule inside a min-width query", () => {
    const at = body.indexOf("@media");
    assert.notEqual(at, -1, "no media query at all — the packing half is missing");
    const outside = body.slice(0, at);
    for (const property of ["display:", "grid-template-columns:", "padding", "gap:"]) {
      assert.ok(
        !outside.includes(property),
        `${property} is declared before the first @media — a packing rule outside a width `
          + "query reaches a phone, where this tab is a single column",
      );
    }
    for (const query of body.match(/@media \([^)]*\)/g) ?? []) {
      assert.match(query, /min-width/, `${query} is not a min-width query`);
    }
  });

  it("adds no grid, so no grid of its own needs a start alignment", () => {
    // The house rule is that a `display: grid` added to a subtab-panel element
    // needs `align-content: start` or spare height inflates its rows. This
    // partial adds none — it only re-gaps and re-pads grids 10a already
    // declares with that alignment — so the rule is satisfied by not applying.
    const grids = body.split("}").filter((block) => /display:\s*grid/.test(block));
    assert.deepEqual(grids, [], "a grid was added; give it align-content: start");
  });
});
