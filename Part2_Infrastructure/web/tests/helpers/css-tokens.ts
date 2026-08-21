/**
 * Reading custom properties back out of the house stylesheet.
 *
 * Parsing CSS with a regex is normally a bad idea. Here the input is one
 * hand-written cascade whose custom properties are all simple `--name: value;`
 * declarations, and the alternative is carrying a CSS parser to assert a
 * handful of facts — so the narrowness is deliberate rather than careless.
 *
 * These live here rather than beside one suite because the theme contract is
 * split by concern — palette parity in one file, contrast in another — and
 * both read the same blocks. Two copies of `blockAfter` would be two
 * definitions of where a declaration list ends, and the day one is fixed the
 * other keeps quietly reading the wrong span.
 */

import assert from "node:assert/strict";

/** Custom properties declared inside a declaration block. */
export function tokensIn(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [, name, value] of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out.set(name, value.trim());
  }
  return out;
}

/** The declaration list of the rule introduced by `marker`. */
export function blockAfter(css: string, marker: string): string {
  const start = css.indexOf(marker);
  assert.notEqual(start, -1, `stylesheet no longer contains ${marker}`);
  const open = css.indexOf("{", start);
  // Both target blocks are flat (no nested braces beyond the media wrapper),
  // so the first closing brace of the inner rule ends the declaration list.
  const end = css.indexOf("}", open);
  return css.slice(open, end);
}

/**
 * That the cascade under test was actually read, before anything asserts on it.
 *
 * `app/globals.css` is an `@import` manifest over `app/globals/*.css`, so the
 * text these suites scan is assembled at import time from sixteen files on
 * disk. A path that stops resolving does not throw here — it yields an empty
 * string, and `assert.doesNotMatch(css, /…/)` is green on an empty haystack,
 * as is every "collect the offenders and expect none" assertion. That failure
 * mode is silent and looks exactly like a passing suite, so each CSS-reading
 * file calls this first with the markers it depends on.
 */
export function assertCascadeLoaded(css: string, markers: readonly string[]): void {
  assert.ok(
    css.trim().length > 1_000,
    `the stylesheet read as ${css.length} characters — the assertions that scan it `
      + "would pass against an empty haystack without checking anything",
  );
  for (const marker of markers) {
    assert.ok(
      css.includes(marker),
      `the stylesheet no longer contains ${JSON.stringify(marker)}, which this suite `
        + "slices from — a miss here reads as `no offenders found`",
    );
  }
}
