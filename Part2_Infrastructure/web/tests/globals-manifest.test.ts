/**
 * The stylesheet's concatenation order is the stylesheet.
 *
 * `app/globals.css` was 17,416 lines. It is now sixteen partials under
 * `app/globals/` and a manifest of `@import` statements. That split is safe
 * only while the concatenation stays exactly what it was, because CSS resolves
 * same-specificity ties by SOURCE ORDER and this sheet depends on that in at
 * least eleven documented places — `.drift-legend i` beating `.legend i`, a
 * `(0,1,0)` rule beating a shared `min-width: 0` from further down, the
 * standardisation layer resolving the surfaces above it, the trailing
 * `prefers-contrast` block staying trailing.
 *
 * Reordering two `@import` lines changes what renders. It produces no error,
 * no failing type and no build warning. So it is pinned here:
 *
 *  1. The manifest holds NOTHING but comments and imports. A rule written into
 *     the entry file would jump ahead of all sixteen partials.
 *  2. Every partial is imported exactly once, and every import exists.
 *  3. The import order equals the partials' numeric filename prefixes, so the
 *     order is visible in a directory listing and cannot be changed quietly.
 *  4. Every partial ends in a newline. A dropped one welds the last line of
 *     one partial onto the first line of the next — which, at a section
 *     boundary, silently rewrites a selector.
 *  5. No partial imports anything itself, so the manifest is the whole order.
 *  6. The concatenation still brace-balances, and the two order dependencies
 *     quoted above still read in the right sequence.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GLOBALS_ENTRY,
  globalsCss,
  globalsPartials,
  globalsPartialsOnDisk,
  readGlobalsEntry,
  readGlobalsPartial,
} from "./globals-css";

const entry = readGlobalsEntry();
const declared = globalsPartials();
const onDisk = globalsPartialsOnDisk();

describe("the globals manifest", () => {
  it("holds no rule of its own", () => {
    const withoutComments = entry.replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(
      withoutComments,
      /\{/,
      `${GLOBALS_ENTRY} has grown a declaration block. A rule here lands ahead of every ` +
      "partial and silently wins or loses a cascade tie — put it in the partial it belongs to",
    );
    const stray = withoutComments
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !/^@import "\.\/globals\/[^"]+";$/.test(line));
    assert.deepEqual(stray, [], `${GLOBALS_ENTRY} may hold only comments and @import lines`);
  });

  it("imports every partial exactly once, and nothing that is missing", () => {
    assert.deepEqual(
      [...declared].sort(),
      onDisk,
      "the manifest and app/globals/ disagree — a partial is unimported (its rules are gone) " +
      "or an import names a file that does not exist (the build fails)",
    );
    assert.equal(new Set(declared).size, declared.length, "a partial is imported twice");
  });

  it("declares them in the order their numeric prefixes state", () => {
    assert.deepEqual(
      declared,
      onDisk,
      "the @import order no longer matches the filename prefixes. The prefixes ARE the " +
      "cascade order: renaming is how you reorder, so that the change is visible in a listing",
    );
  });

  it("ends every partial with a newline", () => {
    const welded = declared.filter((path) => !readGlobalsPartial(path).endsWith("\n"));
    assert.deepEqual(
      welded, [],
      "these partials do not end in a newline, so their last line welds onto the first line " +
      `of the next partial when the sheet is concatenated:\n  ${welded.join("\n  ")}`,
    );
    const empty = declared.filter((path) => readGlobalsPartial(path).trim() === "");
    assert.deepEqual(empty, [], `these partials are empty:\n  ${empty.join("\n  ")}`);
  });

  it("keeps the whole order in the manifest — no partial imports another", () => {
    const nested = declared.filter((path) => /@import/.test(readGlobalsPartial(path)));
    assert.deepEqual(
      nested, [],
      "a partial imports something, so the manifest is no longer the whole order:\n  " +
      nested.join("\n  "),
    );
  });
});

describe("the concatenated cascade", () => {
  it("is the whole sheet, not the manifest", () => {
    // The trap this file exists for: a suite reading the entry file passes
    // while asserting against 122 lines of comments.
    assert.ok(
      globalsCss.length > 400_000,
      `the concatenation is only ${globalsCss.length} bytes — the suites reading it are ` +
      "asserting against almost nothing",
    );
    assert.ok(globalsCss.split("\n").length > 17_000, "the concatenation lost most of the sheet");
  });

  it("brace-balances", () => {
    const declarations = globalsCss.replace(/\/\*[\s\S]*?\*\//g, (block) =>
      block.replace(/[^\n]/g, " "));
    let depth = 0;
    for (const character of declarations) {
      if (character === "{") depth += 1;
      else if (character === "}") depth -= 1;
      assert.ok(depth >= 0, "an unmatched } in the concatenated sheet");
    }
    assert.equal(depth, 0, `${depth} unclosed block(s) at the end of the concatenated sheet`);
  });

  it("still reads `.drift-legend i` after `.legend i`", () => {
    // Equal specificity; the later one wins, and the comment above the rule
    // says so. This is the cheapest possible check that order survived.
    const base = globalsCss.indexOf("\n.legend i {");
    const drift = globalsCss.indexOf("\n.drift-legend i {");
    assert.notEqual(base, -1, ".legend i is gone");
    assert.notEqual(drift, -1, ".drift-legend i is gone");
    assert.ok(drift > base, ".drift-legend i now loses to .legend i — the cascade order moved");
  });

  it("keeps the prefers-contrast block trailing", () => {
    const declarations = globalsCss.replace(/\/\*[\s\S]*?\*\//g, (block) =>
      block.replace(/[^\n]/g, " "));
    const contrast = declarations.lastIndexOf("@media (prefers-contrast: more)");
    assert.notEqual(contrast, -1, "the prefers-contrast block is gone");
    // Walk its braces to the block's real end, then assert nothing but
    // whitespace follows. Slicing to the last `}` would compare an empty
    // string against /\S/ and pass on any input, which is the shape of
    // assertion this codebase has already caught four times.
    let depth = 0;
    let end = -1;
    for (let cursor = declarations.indexOf("{", contrast); cursor < declarations.length; cursor += 1) {
      if (declarations[cursor] === "{") depth += 1;
      else if (declarations[cursor] === "}") {
        depth -= 1;
        if (depth === 0) { end = cursor + 1; break; }
      }
    }
    assert.notEqual(end, -1, "the prefers-contrast block never closes");
    const after = declarations.slice(end);
    assert.doesNotMatch(
      after,
      /\S/,
      `${after.trim().split("\n")[0]} now follows the prefers-contrast block; it is last on purpose`,
    );
    assert.equal(
      declared[declared.length - 1],
      "app/globals/15-navigator-and-trailing-layer.css",
      "the trailing layer is no longer the last import",
    );
  });

  it("still opens on the light :root palette", () => {
    // theme.test.ts and tailwind-bridge.test.ts both locate the light palette
    // as the first `:root {` in the sheet.
    const root = globalsCss.indexOf(":root {");
    const dark = globalsCss.indexOf(':root[data-theme="dark"]');
    assert.notEqual(root, -1, "the sheet no longer opens with a :root block");
    assert.ok(root < dark, "a dark block now precedes the light palette");
    assert.equal(declared[0], "app/globals/00-tokens-and-base.css", "the tokens are no longer first");
  });
});
