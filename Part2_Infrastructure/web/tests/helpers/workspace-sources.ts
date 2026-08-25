/**
 * Reading the workspace's own source, for the suites that assert on it.
 *
 * `tests/workspace-routing-sections.test.ts` was 663 lines and became five files on
 * 2026-08-21, one per concern: `workspace-routing-nav`,
 * `workspace-routing-sections`, `workspace-routing-hook-order`,
 * `workspace-routing-shared-fetch` and `workspace-routing-page-head`. These three
 * helpers were declared once at the top of that file and are used by more than
 * one successor, so they live here rather than in copies.
 *
 * `stripNonCode` in particular must not be duplicated: every scan that uses it
 * only means what it claims if a `return` inside prose really is invisible to it,
 * and a second copy is a second definition of "code" for the same tree.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The `tests/` directory, used as the base for every relative path below.
 *
 * The callers pass paths like `"../components/WorkspaceHeader.tsx"`, written when
 * `read` lived in `tests/workspace-routing-page-head.test.ts`. Resolving them against this
 * directory rather than against this file keeps every one of those strings
 * meaning exactly what it meant before the split — without it they would climb
 * one level too few and read `tests/components/…`, which does not exist.
 */
const TESTS_DIR = new URL("../", import.meta.url);

export function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, TESTS_DIR)), "utf8");
}

/**
 * Strips comments and string literals so a `return` inside prose or a hook name
 * inside a comment cannot register as code.
 *
 * IT DID NOT RECOGNISE TEMPLATE LITERALS UNTIL 2026-08-26, and that was a hole
 * around a hundred suites read the tree through. It blanked block comments,
 * line comments, "double" and 'single' quoted strings — so an apostrophe inside
 * a backtick ("the venue's bounds") was a live `'` to the single-quote pattern.
 * It paired with the next apostrophe anywhere in the file and everything
 * between the two was replaced. A guard reading the result could not see that
 * span, and a ban over blanked text always passes.
 *
 * NOT THEORETICAL. `proofs-figures.test.ts` bans `useCoherenceRead|Route\(` in
 * the figures it names. `ParlayLegs.tsx` is in that table and carried a
 * 1,592-character blanked span, so injecting a real read into it left the ban
 * green. Measured across the tree by diffing this against a correct strip and
 * counting constructs a guard looks for — `<Component`, `useX(`, `className=`,
 * `return` — EIGHT files were hiding SEVENTY-FOUR of them: `lib/gateway.ts`
 * (21), `components/auth/AuthCallback.tsx` (16), `components/auth/LoginScreen.tsx`
 * (13), `MarginAxis.tsx` (11), `ParlayLegs.tsx` (6), `PayoffByState.tsx` (4),
 * `lib/export-python.ts` (2), `lib/quant/stability.ts` (1).
 *
 * The odd-apostrophe COUNT is a proxy and reports about thirty-six. It
 * over-counts four-fold, because a stray apostrophe usually pairs with another
 * one still inside the same literal and swallows nothing. Eight is the number
 * that was measured; thirty-six is the number that was guessed.
 *
 * TWO FIXES WERE TRIED AND THE NARROW ONE WON. Blanking the TEXT of a template
 * literal while keeping its `${…}` is the tempting one — but an id built as
 * `markets-subtab-${next}` has its prefix in that text, and two rail guards pin
 * exactly that string, so it costs two assertions and reopens the question of
 * whether prose inside a backtick is code. This keeps the contents and
 * neutralises only the QUOTE CHARACTERS inside a template region, so a quote in
 * there can no longer pair with one out here. The apostrophe bug goes, the 74
 * constructs come back, no existing guard changes, and nothing has to be
 * decided about prose.
 *
 * A REGEX CANNOT DO THIS, and reaching for one produced a confidently wrong
 * answer on the way here: "blank a backtick span containing no `${`" skips
 * every literal that HAS one, leaves its backticks unpaired, and lets a later
 * backtick pair across a huge span — `publish ? null : (` vanished from
 * `Figure.tsx`, nowhere near a template literal, and the suite showed eleven
 * failures that were the patch rather than the tree. Template literals nest
 * through `${}`, so this tracks frames.
 *
 * The scanner is `developer-analyst-1c`'s, written to measure the alternative
 * honestly and verified green on the full suite before it was offered.
 */
export function stripNonCode(source: string): string {
  let out = "";
  let i = 0;
  const n = source.length;
  // One frame per template literal we are inside, so a `${...}` substitution
  // returns to the right one. A regex cannot do this: template literals nest,
  // and the previous implementation did not recognise them at all.
  const frames: string[] = [];
  while (i < n) {
    const c = source[i];
    const d = source[i + 1];
    if (c === "/" && d === "*") { const e = source.indexOf("*/", i + 2); i = e === -1 ? n : e + 2; continue; }
    if (c === "/" && d === "/" && source[i - 1] !== ":") { const e = source.indexOf("\n", i); i = e === -1 ? n : e; continue; }
    if (c === '"' || c === "'") {
      const quote = c;
      out += quote + quote;
      i++;
      while (i < n && source[i] !== quote) { if (source[i] === "\\") i++; i++; }
      i++;
      continue;
    }
    if (c === "`") {
      out += c; i++;
      while (i < n) {
        if (source[i] === "\\") { out += source.slice(i, i + 2); i += 2; continue; }
        if (source[i] === "`") { out += "`"; i++; break; }
        if (source[i] === "$" && source[i + 1] === "{") { out += "${"; i += 2; frames.push("tmpl"); break; }
        // Kept, not dropped: an id or a class is built from this text, and
        // several guards read it. What changes is only that a quote in here
        // can no longer pair with one out there.
        out += source[i] === "'" || source[i] === '"' ? " " : source[i];
        i++;
      }
      continue;
    }
    if (c === "{" && frames.length) { frames.push("code"); out += c; i++; continue; }
    if (c === "}" && frames.length) {
      const top = frames.pop();
      out += c; i++;
      if (top === "tmpl") {
        while (i < n) {
          if (source[i] === "\\") { out += source.slice(i, i + 2); i += 2; continue; }
          if (source[i] === "`") { out += "`"; i++; break; }
          if (source[i] === "$" && source[i + 1] === "{") { out += "${"; i += 2; frames.push("tmpl"); break; }
          out += source[i] === "'" || source[i] === '"' ? " " : source[i];
          i++;
        }
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

/** Nav ids, in declaration order, from the single NAV_ITEMS literal. */
/**
 * The tab ids, in rail order, read from wherever `NAV_ITEMS` is DECLARED.
 *
 * The argument is ignored as of 2026-08-25 and the parameter is kept so the
 * callers did not have to change: `NAV_ITEMS` moved to `lib/workspace-nav.ts`
 * when the eleventh tab would have pushed `WorkspaceHeader` past the line
 * ceiling, and the component re-exports it. A scan of the re-export finds the
 * `export {` line and no entries — which returns an EMPTY list rather than
 * failing, so every caller would have asserted happily against nothing.
 */
export function navIds(_source?: string): string[] {
  const source = read("../lib/workspace-nav.ts");
  const start = source.indexOf("export const NAV_ITEMS");
  const block = source.slice(start, source.indexOf("];", start) + 2);
  return [...block.matchAll(/\{\s*id:\s*"([a-z]+)"/g)].map((match) => match[1]);
}
