/**
 * One selector, one rung.
 *
 * WHAT THIS CATCHES, AND WHY IT IS THE ROOT OF "why is everything changing so
 * much"
 * ------------------------------------------------------------------------
 * The desk sizes its type in 26 partials concatenated in manifest order. Adding
 * a rule to a later partial silently beats an identical selector in an earlier
 * one, so the cheapest way to change a size is to APPEND rather than to EDIT.
 * Nine selectors had accumulated two `font-size` declarations that way, in two
 * different files, with DISAGREEING rungs:
 *
 *   .section-heading :is(h2, h3)         01 --fs-h1     dead   12 --fs-h2    ships
 *   .section-heading.compact :is(h2, h3) 01 --fs-h2     dead   12 --fs-title ships
 *   .next-step-footer__kicker            11 --fs-body   dead   12 --fs-2xs   ships
 *   .next-step-footer__title             11 --fs-h2     dead   12 --fs-xl    ships
 *   .next-step-footer__hint              11 --fs-2xl    dead   12 --fs-sm    ships
 *   .portfolio-statusbar > div           01 --fs-2xs    dead   12 --fs-md    ships
 *   .developer-cp-section-hero h2        10 --fs-title  dead   10 --fs-h1    ships
 *   .banner                              00 --fs-xl     dead   12 --fs-lg    ships
 *   .seg button                          00 --fs-lg     dead   12 --fs-sm    ships
 *
 * Every dead declaration still carried the comment that argued for its value.
 * That is worse than a wrong number: it is a file that states one thing and a
 * browser that does another, and no reader can tell which is true without
 * concatenating 26 files in order and walking the cascade by hand.
 *
 * It is not a hypothetical cost. A cross-tab review of the whole desk read the
 * dead `--fs-h2` off `11-next-step-footer.css` and reported, in writing, that
 * the footer's `<h3>` outranked every card `<h2>` above it on six tabs. It does
 * not: the footer title ships at `--fs-xl`, 15.5px, and always has. A careful
 * reader spent a pass measuring a defect that only existed in a dead line.
 *
 * All nine are converged, so this suite is green on the day it lands and the
 * SANCTIONED map below is empty. That is the intended resting state.
 *
 * WHAT IT DOES NOT CATCH, said plainly
 * ------------------------------------------------------------------------
 * Two DIFFERENT selectors matching the same element (`.card > h2` against
 * `.section-heading :is(h2, h3)`) are invisible here, because resolving them
 * needs a DOM this repository has never had — `npm test` is plain Node, no
 * jsdom, no browser, and no new dependency may be added. That half is held by
 * `tests/type-role-map.test.ts`, which pins the rung a ROLE reads and so
 * catches the case where two selectors for one object disagree.
 *
 * The brace-walker and the paren-aware comma splitter both live in
 * `tests/globals-rules.ts` rather than here. `tab-chrome-metrics.test.ts:62-94`
 * derived the walker first and its reasoning is the reason it is shared: a
 * second, subtly different walker would disagree with the first about what the
 * cascade contains, and neither would say so.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { globalsCss, locateInGlobals } from "./globals-css";
import { cssRules, declaredRung, selectorList } from "./globals-rules";

/** Comment bodies blanked, newlines kept, so prose is never read as a rule. */
const css = globalsCss.replace(/\/\*[\s\S]*?\*\//g, (block) =>
  block.replace(/[^\n]/g, " "));

/**
 * Pairs that MAY disagree, each mapped to the reason they may.
 *
 * The value is a REASON, not a name, and that is the whole design: an entry
 * costs a sentence someone has to be willing to write, which is the price of
 * saying "these two contradictory statements of one rule are deliberate".
 *
 * Empty on the day this landed. `.seg button` was the one candidate — 00 gives
 * the segment its flex behaviour and chip radius, 12 gives it the house size,
 * and `type-scale.test.ts:199-244` sanctions that split — but the sanction is
 * about the two RULES, not about two font sizes, so 00's dead `--fs-lg` was
 * deleted and the rule kept. A sanction should be needed for a duplicate that
 * cannot be removed, and none of the nine turned out to be one.
 */
const SANCTIONED = new Map<string, string>();

/** Everything the walker found, one entry per selector per at-rule context. */
const declarations = (() => {
  const out = new Map<string, { where: string; value: string; selector: string }[]>();
  for (const rule of cssRules(css, locateInGlobals)) {
    const value = declaredRung(rule.body);
    if (value === null) continue;
    for (const selector of selectorList(rule.selector)) {
      const key = `${rule.context.join(" && ")}||${selector}`;
      out.set(key, [...(out.get(key) ?? []), { where: rule.where, value, selector }]);
    }
  }
  return out;
})();

describe("a selector states its rung once", () => {
  it("no selector declares font-size twice in one at-rule context", () => {
    // Keyed on (context, selector) rather than on selector alone: a duplicate
    // inside one @media block is the same defect one scope down, and scoping
    // the check to context-free rules would have missed it. Zero today at both
    // levels, so the stronger form costs nothing and is what is pinned.
    const offenders: string[] = [];
    for (const [key, found] of declarations) {
      if (found.length < 2) continue;
      const values = new Set(found.map((entry) => entry.value));
      const selector = found[0].selector;
      if (SANCTIONED.has(selector)) continue;
      const trail = found
        .map((entry, index) => `${entry.where} -> ${entry.value}${index === found.length - 1 ? "  (WINS)" : "  (dead)"}`)
        .join("\n      ");
      offenders.push(
        `${key.split("||").pop()}${values.size > 1 ? "" : "  [same value twice]"}\n      ${trail}`,
      );
    }
    assert.deepEqual(
      offenders,
      [],
      "a selector is sized in two places, and only the later one renders. Delete the "
        + "dead declaration (converging onto the value that already ships moves nothing "
        + "on screen), or add the pair to SANCTIONED with the reason it must stay:\n\n  "
        + offenders.join("\n\n  "),
    );
  });

  it("every sanctioned pair still exists, and still says why", () => {
    // A sanction outliving the duplicate it excuses is how an allow-list turns
    // into a list of things nobody dares delete. Same shape as
    // `dead-css.test.ts`'s retired-selector check.
    for (const [selector, reason] of SANCTIONED) {
      const found = [...declarations.entries()]
        .filter(([key]) => key.endsWith(`||${selector}`))
        .flatMap(([, entries]) => entries);
      assert.ok(
        found.length >= 2,
        `${selector} is sanctioned as a duplicate but is declared ${found.length} time(s) — retire the entry`,
      );
      assert.ok(
        reason.trim().length >= 40,
        `${selector}'s sanction is a label, not a reason: "${reason}"`,
      );
    }
  });
});
