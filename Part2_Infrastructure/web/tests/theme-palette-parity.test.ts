/**
 * The stylesheet's two dark themes, which declare the same palette twice.
 *
 * `@media (prefers-color-scheme: dark)` and `:root[data-theme="dark"]` are two
 * separate declaration blocks holding one palette. The second wins on
 * specificity, so a token added to only the first quietly reverts to its
 * *light* value for every user who has pressed the theme toggle — a bug that is
 * invisible unless you happen to test in the non-default path. It has already
 * been wrong in this stylesheet, and it was not visible in review.
 *
 * This file pins the two blocks to each other, and pins the two-state palette
 * flip that selects between them. It is not an aesthetic assertion: it is the
 * claim that there is exactly one dark palette, expressed twice, and that the
 * two expressions agree.
 *
 * Parsing CSS with a regex is normally a bad idea. Here the input is one
 * hand-written cascade whose custom properties are all simple `--name: value;`
 * declarations, and the alternative is carrying a CSS parser to assert two
 * facts — so the narrowness is deliberate rather than careless. The readers
 * live in `tests/helpers/css-tokens.ts`, shared with the contrast half.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nextThemeMode, resolveThemeMode } from "../lib/theme";

import { globalsCss } from "./globals-css";
import { assertCascadeLoaded, blockAfter, tokensIn } from "./helpers/css-tokens";

const css = globalsCss;

const DARK_BLOCKS = ['@media (prefers-color-scheme: dark)', ':root[data-theme="dark"]'];

describe("the stylesheet these assertions parse was actually read", () => {
  it("holds a non-empty cascade containing both dark blocks", () => {
    // Everything below slices spans out of `css`. Read as an empty string —
    // one unresolved partial path is enough — the parse finds no tokens, and
    // "the two blocks declare the same names" is trivially true of two empty
    // maps. The suite would stay green while checking nothing.
    assertCascadeLoaded(css, DARK_BLOCKS);
  });
});

describe("the two dark palettes cannot drift apart", () => {
  const mediaDark = tokensIn(blockAfter(css, '@media (prefers-color-scheme: dark)'));
  const attrDark = tokensIn(blockAfter(css, ':root[data-theme="dark"]'));

  it("declares the same token names in both blocks", () => {
    const only = (a: Map<string, string>, b: Map<string, string>) =>
      [...a.keys()].filter((k) => !b.has(k)).sort();
    assert.deepEqual(
      only(mediaDark, attrDark),
      [],
      "declared for OS dark but not for the theme toggle — these revert to their light value",
    );
    assert.deepEqual(
      only(attrDark, mediaDark),
      [],
      "declared for the theme toggle but not for OS dark",
    );
  });

  it("gives every shared token the same value in both blocks", () => {
    for (const [name, value] of mediaDark) {
      assert.equal(attrDark.get(name), value, `${name} differs between the two dark blocks`);
    }
  });

  it("still declares the text roles the console renders status with", () => {
    for (const role of ["--success-text", "--warning-text", "--critical-text", "--notice-text"]) {
      assert.ok(attrDark.has(role), `${role} is missing from the dark palette`);
    }
  });
});

describe("the palette has exactly two states, whatever the preference is", () => {
  it("changes the visible palette on every flip", () => {
    // The ⌘K verb. Two states on purpose: it answers "what am I looking at",
    // and it sets an explicit value rather than pretending to preserve System.
    assert.equal(nextThemeMode("light"), "dark");
    assert.equal(nextThemeMode("dark"), "light");
  });

  it("uses the stamped palette, saved choice, then initial OS preference", () => {
    assert.equal(resolveThemeMode("dark", "light", false), "dark");
    assert.equal(resolveThemeMode(undefined, "light", true), "light");
    assert.equal(resolveThemeMode(undefined, "system", true), "dark");
    assert.equal(resolveThemeMode(undefined, null, false), "light");
  });
});
