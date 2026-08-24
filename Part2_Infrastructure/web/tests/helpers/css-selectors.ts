/**
 * Every selector a partial declares, one per comma-separated part.
 *
 * Written out of two suites that each had their own copy and each got it
 * subtly wrong, in the same two ways:
 *
 *  1. A NAIVE COMMA SPLIT BREAKS `:is()`. `.plane :is(.a, .b)` split on every
 *     comma yields `.b` as a selector of its own, which then fails a "is every
 *     rule scoped to the plane" check for a rule that is perfectly scoped. Both
 *     density partials are written almost entirely in `:is()` lists, so the
 *     check was reporting the whole file. `selectorList` in `globals-rules.ts`
 *     is the paren-aware splitter the type suites already share, and it is
 *     reused here rather than re-derived — a second splitter that disagrees
 *     with the first is worse than no splitter.
 *  2. THE FIRST RULE INSIDE AN `@media` BLOCK WAS INVISIBLE. Splitting the file
 *     on `}` and taking the text before the FIRST `{` reads the at-rule prelude
 *     for that fragment and skips it as an at-rule, so the rule it opens was
 *     never checked at all. Taking the LAST group before the final `{` of the
 *     fragment reads the selector in both shapes.
 *
 * Comments are removed first: several rules in these files are argued for in a
 * comment that names the selector it is arguing against.
 */

import { selectorList } from "../globals-rules";

export function declaredSelectors(css: string): string[] {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("}")
    .flatMap((fragment) => {
      const parts = fragment.split("{");
      // One part means no rule opened in this fragment — the tail after a
      // block's closing brace, or the whitespace before an at-rule's.
      if (parts.length < 2) return [];
      return selectorList(parts[parts.length - 2]);
    })
    .map((selector) => selector.trim())
    .filter((selector) => selector.length > 0 && !selector.startsWith("@"));
}
