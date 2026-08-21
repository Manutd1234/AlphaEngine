/**
 * The preference, which is not the palette.
 *
 * A palette has two states; the preference has three, and the third is
 * `System`. That asymmetry is the whole subject of this file, because every
 * way of getting `System` wrong is silent:
 *
 *  - Stamp it on the document and the page renders *light* on a dark machine.
 *    `data-theme="system"` matches neither palette block, so the setting reads
 *    as a no-op — the loudest-looking no-op there is.
 *  - Resolve it once and store the answer, and it stops following the OS while
 *    still looking correct on the day you set it.
 *  - Narrow it to `light | dark` on the way in from the account, and it syncs
 *    perfectly and never repaints: the row correct, the merge correct, every
 *    test green, the screen wrong.
 *
 * So this file pins two things that must agree — what the preference means as
 * a value, and how that value reaches the document. Its counterparts pin the
 * palettes themselves (`theme-palette-parity`) and their contrast
 * (`theme-contrast`).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_THEME_PREFERENCE,
  THEME_PREFERENCES,
  isThemePreference,
  nextThemePreference,
  paletteForPreference,
  resolveThemePreference,
} from "../lib/theme";

import { globalsCss } from "./globals-css";
import { assertCascadeLoaded } from "./helpers/css-tokens";

const css = globalsCss;

describe("the sources these assertions read were actually read", () => {
  it("holds non-empty text for the stylesheet and the three modules below", () => {
    // The `doesNotMatch` assertions further down are the reason this exists:
    // they are green against an empty haystack, so a path that stops resolving
    // turns "the string 'system' never reaches the attribute" into a claim
    // about nothing at all, with no failure to notice.
    assertCascadeLoaded(css, [':root:where(:not([data-theme="light"]))']);
    for (const relative of ["../lib/theme.ts", "../app/layout.tsx", "../components/ThemeToggle.tsx"]) {
      const text = readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
      assert.ok(text.trim().length > 0, `${relative} read as empty`);
    }
  });
});

/**
 * `System` is the state this file exists to protect, because every way of
 * getting it wrong is silent. Stamp it on the document and the page renders
 * *light* on a dark machine — `data-theme="system"` matches neither palette
 * block, so it reads as "the setting does nothing". Resolve it once and store
 * the answer and it stops following the OS while still looking correct on the
 * day you set it. Narrow it on the way in from the account and it syncs
 * perfectly and never repaints.
 */
describe("the preference has three states and System is not a palette", () => {
  it("offers exactly light, dark and system", () => {
    assert.deepEqual([...THEME_PREFERENCES], ["light", "dark", "system"]);
  });

  it("cycles through all three, unlike the two-state palette flip", () => {
    assert.equal(nextThemePreference("light"), "dark");
    assert.equal(nextThemePreference("dark"), "system");
    assert.equal(nextThemePreference("system"), "light");
  });

  it("treats an unset or unrecognised value as System", () => {
    // Not a new default: `resolveThemeMode` already fell through to
    // prefers-color-scheme when nothing was stored. This only names it.
    assert.equal(DEFAULT_THEME_PREFERENCE, "system");
    assert.equal(resolveThemePreference(null), "system");
    assert.equal(resolveThemePreference("sepia"), "system");
    assert.equal(resolveThemePreference("light"), "light");
    assert.equal(resolveThemePreference("dark"), "dark");
  });

  it("guards the value arriving from another device", () => {
    assert.ok(isThemePreference("system"));
    assert.ok(isThemePreference("light"));
    assert.ok(isThemePreference("dark"));
    assert.ok(!isThemePreference("System"));
    assert.ok(!isThemePreference(null));
    assert.ok(!isThemePreference(undefined));
  });

  it("resolves System against the OS every time it is asked, never once", () => {
    assert.equal(paletteForPreference("system", true), "dark");
    assert.equal(paletteForPreference("system", false), "light");
    // An explicit choice ignores the machine entirely — that is what makes it
    // a third state rather than a synonym for one of the other two.
    assert.equal(paletteForPreference("light", true), "light");
    assert.equal(paletteForPreference("dark", false), "dark");
  });
});

describe("System reaches the document by removing the attribute, not stamping it", () => {
  const theme = readFileSync(fileURLToPath(new URL("../lib/theme.ts", import.meta.url)), "utf8");
  const layout = readFileSync(fileURLToPath(new URL("../app/layout.tsx", import.meta.url)), "utf8");
  const toggle = readFileSync(
    fileURLToPath(new URL("../components/ThemeToggle.tsx", import.meta.url)),
    "utf8",
  );
  const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

  it("deletes data-theme for System rather than writing the word", () => {
    assert.match(strip(theme), /delete root\.dataset\.theme/);
    // The string "system" must never reach the attribute. It matches neither
    // palette block, so it renders light — the loudest-looking no-op there is.
    assert.doesNotMatch(strip(theme), /dataset\.theme\s*=\s*["']system["']/);
  });

  it("the pre-paint bootstrap stamps only an explicit choice", () => {
    // Stamping a *resolved* palette here would freeze System at whatever the
    // OS said during this one page load, so a machine that switches at sunset
    // would need a reload to catch up.
    const bootstrap = layout.slice(layout.indexOf("const THEME_BOOTSTRAP"));
    const body = bootstrap.slice(0, bootstrap.indexOf("`;"));
    assert.match(body, /savedTheme === 'light' \|\| savedTheme === 'dark'/);
    assert.doesNotMatch(body, /prefers-color-scheme/);
  });

  it("the stylesheet lets an explicit light choice beat a dark machine", () => {
    // Without the :not() guard, removing the attribute for System and choosing
    // Light on a dark laptop would render dark — the media block would win.
    assert.match(css, /:root:where\(:not\(\[data-theme="light"\]\)\) \{/);
  });

  it("the control reads the stored preference on mount and never writes it", () => {
    // The bug this replaced: `applyDocumentThemeMode(resolveDocumentThemeMode())`
    // on mount resolved System to an explicit palette and pushed it to the
    // account, so opening the panel destroyed the preference it was showing.
    assert.match(strip(toggle), /resolveDocumentThemePreference\(\)/);
    assert.doesNotMatch(strip(toggle), /applyDocumentThemeMode|resolveDocumentThemeMode/);
  });

  it("the control follows a change that alters no attribute", () => {
    // Dark → System on a dark machine leaves data-theme absent either way, so
    // a MutationObserver never fires and the segments would keep showing Dark.
    assert.match(strip(toggle), /onPrefChange\(/);
    assert.doesNotMatch(strip(toggle), /MutationObserver/);
  });

  it("offers every preference as its own segment, pressed-state and all", () => {
    assert.match(strip(toggle), /THEME_PREFERENCES\.map/);
    assert.match(strip(toggle), /aria-pressed=\{preference === candidate\}/);
  });

  it("the account sync applies all three, not just the two palettes", () => {
    // Narrowed to light|dark, a synced "system" stored and never repainted:
    // the row correct, the merge correct, every test green, the screen wrong.
    const engine = readFileSync(
      fileURLToPath(new URL("../lib/user-prefs.ts", import.meta.url)),
      "utf8",
    );
    assert.match(strip(engine), /isThemePreference\(value\)/);
    assert.match(strip(engine), /applyDocumentThemePreference\(value\)/);
  });
});
