/**
 * The house stylesheet as RULES, for the suites that ask which rule wins.
 *
 * WHY THIS FILE EXISTS
 * ------------------------------------------------------------------------
 * `globals-css.ts` gives every CSS-reading suite the same 26 partials in the
 * same order, which is what stopped a split from silently emptying a regex.
 * The next layer up had no such home: `tab-chrome-metrics.test.ts` and
 * `seg-metrics.test.ts` each hand-walk that string into rule blocks, because a
 * regex that stops at the first `}` reads a media query's FIRST rule as the
 * whole block. Two copies of a walker is two chances to disagree about what
 * the cascade contains, and a suite that disagrees with the browser is worse
 * than no suite.
 *
 * So the walker lives here once. The two suites above are at their 400-line
 * ceiling and are not rewritten to use it — this is the home for the next
 * reader, not a migration.
 */

/** One declaration block, with the at-rules it is nested inside. */
export interface CssRule {
  /** The at-rules this sits inside, outermost first. */
  readonly context: readonly string[];
  /** The selector group, exactly as written, whitespace collapsed. */
  readonly selector: string;
  /** The block body, whitespace collapsed. */
  readonly body: string;
  /** `app/globals/11-next-step-footer.css:28`. */
  readonly where: string;
}

/**
 * Every declaration block in `text`, in source order.
 *
 * Hand-walked, not matched: `@media`, `@container` and `@supports` blocks nest,
 * and depth is the only thing that tells a rule from its enclosure.
 */
export function cssRules(text: string, locate: (index: number) => string): CssRule[] {
  const out: CssRule[] = [];
  const context: string[] = [];
  let cursor = 0;
  let start = 0;
  while (cursor < text.length) {
    const character = text[cursor];
    if (character !== "{" && character !== "}") { cursor += 1; continue; }
    if (character === "}") { context.pop(); cursor += 1; start = cursor; continue; }
    const selector = text.slice(start, cursor).trim().replace(/\s+/g, " ");
    if (selector.startsWith("@")) {
      context.push(selector);
      cursor += 1;
      start = cursor;
      continue;
    }
    let depth = 1;
    let scan = cursor + 1;
    for (; scan < text.length && depth > 0; scan += 1) {
      if (text[scan] === "{") depth += 1;
      else if (text[scan] === "}") depth -= 1;
    }
    out.push({
      context: [...context],
      selector,
      body: text.slice(cursor + 1, scan - 1).trim().replace(/\s+/g, " "),
      where: locate(cursor),
    });
    cursor = scan;
    start = cursor;
  }
  return out;
}

/**
 * A selector group split into its selectors, at TOP-LEVEL commas only.
 *
 * `String.split(",")` turns `:is(h2, h3)` into `:is(h2` and `h3)`, and every
 * rule in the sheet that uses `:is()` then contributes the same phantom
 * selector `h3)`, which collide with each other and read exactly like a real
 * duplicate. That is not hypothetical: it is what the first measuring pass over
 * this sheet reported.
 */
export function selectorList(group: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of group) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/** The last `font-size` a block declares, or null. Later wins inside one block. */
export function declaredRung(body: string): string | null {
  const declared = [...body.matchAll(/(?:^|;\s*)font-size\s*:\s*([^;]+)/g)];
  return declared.length ? declared[declared.length - 1][1].trim() : null;
}
