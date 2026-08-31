/**
 * THE RECORD OF ONE 1px, AND WHY IT COST TEN TABS INSTEAD OF TWO.
 *
 * "for markets and coherence subtabs and subsubtabs, standardize the font size
 *  to 14 and follow the example from the other 8 tabs to make it look good"
 *
 * WHAT WAS ALREADY TRUE, so the next reader does not re-fix it
 * ------------------------------------------------------------------------
 * Half the ask needed no change. The SUBTAB rail — the section rail under the
 * page head — has read `--fs-body` since the same reader asked for that in
 * those words ("subtab headers can be bigger to 14px and bigger for comfortable
 * setting"). It is declared once, on the box that owns the rail's metrics, in
 * `15-navigator-and-trailing-layer.css`, and it is NOT scoped to a tab, so
 * Markets and Coherence were already at 14px there. A pass that "fixed" it
 * anyway would have opened a second authority for one object, which is the
 * defect `type-role-map.test.ts` exists to prevent.
 *
 * WHAT WAS NOT, and the wrong turn taken first
 * ------------------------------------------------------------------------
 * The SUB-SUBTAB — a `.seg` pane switcher inside one panel — was `--fs-sm`.
 * That is the 1px in the report, and it is 1px only at the middle preset:
 *
 *   rung        compact (6/7)   comfortable   large (17/14)
 *   --fs-sm      11.14px          13px          15.79px
 *   --fs-body    12.00px          14px          17.00px
 *
 * The ask names two tabs, so the first attempt was a scoped override —
 * `.coherence-plane .seg button { font-size: var(--fs-body) }` in its own
 * partial. It was WRONG, and three suites said so independently, by name:
 *
 *   - `seg-metrics.test.ts` allows only `.seg`, `.seg button` and the seam to
 *     carry a metric at all: "a per-tab seg size is back; converge it in 12".
 *   - `tab-chrome-metrics.test.ts`: "a second home for a metric has opened".
 *   - `type-scale.test.ts` asserts the selector list is exactly
 *     `[".seg button"]`: "a second selector sizes the segmented control — that
 *     is how it ended up with three rungs."
 *
 * Their shared reason, quoted from `seg-metrics`, is the thing worth keeping:
 * four rules once sized this control and disagreed, and anything else would be
 * "a fifth size arriving the way the first four did — locally, reasonably, and
 * invisibly to the tab next door." A scoped exception IS that fifth size.
 *
 * SO THE CHANGE IS DESK-WIDE, and that is a real widening of the ask
 * ------------------------------------------------------------------------
 * The rung moved in `12-workspace-standardisation.css`, the one place the
 * control is sized, so the seg is 14px across every workspace tab and every
 * component that renders one. That is more than two tabs were asked for. It is
 * also the only way to satisfy the ask without re-opening the defect those
 * three suites were written against — and it is what "standardize" means: the
 * level keeps ONE size, which is the property it had before and still has.
 *
 * The pins moved with it rather than being loosened, per the house rule that an
 * assertion may be added to but never weakened: `type-scale` still pins the
 * rung exactly (to `--fs-body`), `type-role-map`'s `sub-subtab` role still
 * names one rung, and its ordering assertion still forbids a switcher LARGER
 * than the rail that opened it — it reads `>=` because the invariant was always
 * "does not out-shout", never "is smaller".
 *
 * DERIVED, NEVER OBSERVED. `npm test` is plain Node with no jsdom and no
 * browser, and no dependency may be added, so nothing here has ever seen a
 * pixel. Every figure below is the sheet's own arithmetic read back out of
 * `:root`. Whether 14px is right for a pane switcher, and whether a rail and a
 * switcher at ONE size still read as two levels, are outside what a string
 * comparison can reach — they want a human at a viewport.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { globalsCss, locateInGlobals } from "./globals-css";
import { cssRules, declaredRung, selectorList } from "./globals-rules";

/** Comment bodies blanked, newlines kept, so prose is never read as a rule. */
const declarations = globalsCss.replace(/\/\*[\s\S]*?\*\//g, (block) =>
  block.replace(/[^\n]/g, " "));

const rules = cssRules(declarations, locateInGlobals);

/** The `:root` block, for reading a rung's own definition back. */
const rootBlock = declarations.slice(
  declarations.indexOf(":root {"),
  declarations.indexOf("\n}\n", declarations.indexOf(":root {")),
);

/** The winning `font-size` for an exact selector: the LAST context-free rule. */
function shipped(selector: string): { rung: string; where: string } | null {
  let found: { rung: string; where: string } | null = null;
  for (const rule of rules) {
    if (rule.context.length > 0) continue;
    if (!selectorList(rule.selector).includes(selector)) continue;
    const rung = declaredRung(rule.body);
    if (rung !== null) found = { rung, where: rule.where };
  }
  return found;
}

/** A rung's rem multiplier, so the three presets can be computed from it. */
function remOf(token: string): number {
  const match = rootBlock.match(new RegExp(`${token}:\\s*calc\\(([\\d.]+)rem`));
  assert.ok(match, `${token} is not a calc() rung in :root`);
  return Number(match![1]);
}

/** The Text-size presets, as `00-tokens-and-base.css` writes them. */
const STEPS: ReadonlyArray<readonly [string, number]> = [
  ["compact", 6 / 7],
  ["comfortable", 1],
  ["large", 17 / 14],
];

const SUBTAB = '.workspace-subtabs__rail[data-scroll-affordance="horizontal"] > button';
const SUB_SUBTAB = ".seg button";

describe("the two navigation levels a reader asked to be 14px", () => {
  it("the subtab rail reads --fs-body, desk-wide and un-scoped", () => {
    const rail = shipped(SUBTAB);
    assert.ok(rail, "the subtab rail declares no size of its own any more");
    assert.equal(rail!.rung, "var(--fs-body)", `the rail reads ${rail!.rung} at ${rail!.where}`);
  });

  it("the seg reads the same rung, so the two levels agree", () => {
    const seg = shipped(SUB_SUBTAB);
    assert.ok(seg, "the shared .seg button rule declares no size any more");
    assert.equal(
      seg!.rung,
      "var(--fs-body)",
      `the sub-subtab reads ${seg!.rung} at ${seg!.where} — if that was deliberate, `
      + "type-role-map's sub-subtab role and type-scale's pin are what should move with it",
    );
  });

  it("computes to one size for both levels at all three presets", () => {
    // Both read the SAME token, so this is arithmetic rather than a coincidence
    // two rules have to keep agreeing on. Stated in px anyway, because "14" is
    // the number in the report and it is only the middle of three.
    const body = remOf("--fs-body") * 16;
    const seen: Record<string, number> = {};
    for (const [name, step] of STEPS) seen[name] = Number((body * step).toFixed(2));
    assert.deepEqual(
      seen,
      { compact: 12, comfortable: 14, large: 17 },
      "the type ladder moved under this file; re-derive the table in the banner",
    );
  });

  it("steps with the Text-size preference rather than pinning a literal", () => {
    // A fixed 14px would out-shout a 12px rail for every reader on Compact,
    // which is the inversion type-role-map's ordering assertion forbids.
    assert.match(rootBlock, /--fs-body:\s*calc\(/, "--fs-body must multiply --type-step");
  });
});

describe("the scoped override that was refused stays refused", () => {
  /**
   * The half of this file worth having.
   *
   * The wrong turn is easy to retake: the ask names two tabs, a scoped rule is
   * the obvious diff, and it passes a casual reading of the role map because
   * `type-role-map` resolves its anchor through the last CONTEXT-FREE rule
   * naming `.seg button` and never sees a descendant selector. Three other
   * suites catch it — this one states the rule in one place so the next reader
   * meets the reason before the failure.
   */
  /**
   * Every rule that names the seg AND declares a size.
   *
   * `:not(...)` selectors are skipped, the way `type-scale.test.ts` skips them:
   * `.blotter-toolbar button:not(.seg button)` names the seg only to exclude
   * itself from a toolbar rule, so it sizes everything EXCEPT a segment. Reading
   * it as a second sizer is a false positive, and it was this file's own first
   * failure.
   */
  const segSizers = rules
    .filter((rule) => declaredRung(rule.body) !== null)
    .filter((rule) => selectorList(rule.selector).some((selector) =>
      /\.seg\b/.test(selector) && !/:not\([^)]*\.seg/.test(selector)));

  it("exactly one selector in the whole sheet sizes a segment", () => {
    assert.deepEqual(
      segSizers.map((rule) => rule.selector),
      [".seg button"],
      "a second selector sizes the seg. That is a per-tab size arriving the way the "
      + "first four did — locally, reasonably, and invisibly to the tab next door. "
      + `Converge it in 12 instead:\n  ${segSizers.map((r) => `${r.where} — ${r.selector}`).join("\n  ")}`,
    );
  });

  it("and it is in 12, not in a partial named for one tab", () => {
    // The specific shape that was tried and reverted — a per-tab partial
    // reaching for the seg — named separately from the rule above so the
    // failure says WHICH mistake was made. 12 is the canonical home and is the
    // one file allowed to appear here.
    const strays = segSizers
      .filter((rule) => !rule.where.startsWith("app/globals/12-workspace-standardisation.css"))
      .map((rule) => `${rule.where} — ${rule.selector}`);
    assert.deepEqual(strays, [], `the seg is sized outside 12:\n  ${strays.join("\n  ")}`);
  });
});
