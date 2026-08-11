/**
 * The stylesheet's two dark themes, and the contrast of anything read as text.
 *
 * These are not aesthetic assertions. Both facts they pin have already been
 * wrong in this file and neither was visible in review:
 *
 *  1. **Two dark blocks.** `@media (prefers-color-scheme: dark)` and
 *     `:root[data-theme="dark"]` declare the same palette twice. The second wins
 *     on specificity, so a token added to only the first quietly reverts to its
 *     *light* value for every user who has pressed the theme toggle — a bug that
 *     is invisible unless you happen to test in the non-default path.
 *
 *  2. **Fill steps used as text.** `--status-good/-warning/-critical` are 3.0–3.8:1
 *     on white: correct for a dot or a meter fill, below AA for a word. The
 *     console renders status as icon + word + colour, so the word needs a text
 *     step. Contrast is arithmetic, so it can be checked rather than eyeballed.
 *
 * Parsing CSS with a regex is normally a bad idea. Here the input is one
 * hand-written file whose custom properties are all simple `--name: value;`
 * declarations, and the alternative is carrying a CSS parser to assert two
 * facts — so the narrowness is deliberate rather than careless.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { nextThemeMode, resolveThemeMode } from "../lib/theme";

const css = readFileSync(
  fileURLToPath(new URL("../app/globals.css", import.meta.url)),
  "utf8",
);

/** Custom properties declared inside the block that starts at `startIndex`. */
function tokensIn(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [, name, value] of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out.set(name, value.trim());
  }
  return out;
}

function blockAfter(marker: string): string {
  const start = css.indexOf(marker);
  assert.notEqual(start, -1, `stylesheet no longer contains ${marker}`);
  const open = css.indexOf("{", start);
  // Both target blocks are flat (no nested braces beyond the media wrapper),
  // so the first closing brace of the inner rule ends the declaration list.
  const end = css.indexOf("}", open);
  return css.slice(open, end);
}

// --------------------------------------------------------------------------
// Theme parity
// --------------------------------------------------------------------------

describe("the two dark palettes cannot drift apart", () => {
  const mediaDark = tokensIn(blockAfter('@media (prefers-color-scheme: dark)'));
  const attrDark = tokensIn(blockAfter(':root[data-theme="dark"]'));

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

describe("the theme control has exactly two direct states", () => {
  it("changes the visible palette on every click", () => {
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

// --------------------------------------------------------------------------
// Contrast
// --------------------------------------------------------------------------

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const channels = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const AA_NORMAL = 4.5;

/** Resolved palettes, kept here rather than re-parsed so the expectation is explicit. */
const LIGHT = {
  "surface-1": "#ffffff",
  // Zinc, since the graphite repaint. Every role below is re-checked against
  // it — --json-accent clears AA here by 0.20, so this value is not free to
  // drift darker without moving the accent with it.
  "surface-2": "#f4f4f5",
  "success-text": "#087552",
  "warning-text": "#85570b",
  "critical-text": "#b3242e",
  "notice-text": "#9a4415",
  "text-secondary": "#52525b",
  "text-muted": "#65656e",
  "json-accent": "#2563eb",
} as const;

const DARK = {
  "surface-1": "#131316",
  "surface-2": "#1a1a1f",
  "success-text": "#0ca30c",
  "warning-text": "#e8ab3d",
  "critical-text": "#f0737c",
  "notice-text": "#f08a5a",
  "text-secondary": "#b1b1b9",
  "text-muted": "#8a8a94",
  "json-accent": "#5a9ceb",
} as const;

const TEXT_ROLES = [
  "success-text",
  "warning-text",
  "critical-text",
  "notice-text",
  "text-secondary",
  "text-muted",
  "json-accent",
] as const;

describe("every colour rendered as text clears AA on the surfaces it lands on", () => {
  for (const [themeName, palette] of [["light", LIGHT], ["dark", DARK]] as const) {
    for (const role of TEXT_ROLES) {
      // --surface-1 is the card plane; --surface-2 is the <details> and inset
      // plane the JSON tree and skip chips sit on. Both are reachable for every
      // one of these roles.
      for (const surface of ["surface-1", "surface-2"] as const) {
        it(`${themeName}: --${role} on --${surface}`, () => {
          const value = contrast(palette[role], palette[surface]);
          assert.ok(
            value >= AA_NORMAL,
            `--${role} on --${surface} in ${themeName} is ${value.toFixed(2)}:1, below AA ${AA_NORMAL}:1`,
          );
        });
      }
    }
  }

  it("the parsed stylesheet agrees with the palette asserted above", () => {
    const attrDark = tokensIn(blockAfter(':root[data-theme="dark"]'));
    for (const role of ["warning-text", "critical-text", "notice-text", "json-accent"] as const) {
      assert.equal(
        attrDark.get(`--${role}`),
        DARK[role],
        `--${role} changed in the stylesheet without this test being updated`,
      );
    }

    // The light surfaces were only ever asserted as literals here, so the beige
    // repaint could have moved them without a single test noticing. They are
    // read from the stylesheet now, which is what makes the contrast maths
    // above a check rather than a restatement.
    const light = tokensIn(blockAfter(":root {"));
    for (const surface of ["surface-1", "surface-2"] as const) {
      assert.equal(
        light.get(`--${surface}`),
        LIGHT[surface],
        `--${surface} changed in the stylesheet without this test being updated`,
      );
    }
  });
});

// --------------------------------------------------------------------------
// Fill steps stay fill steps
// --------------------------------------------------------------------------

describe("the console never renders a fill-step status colour as text", () => {
  it("no --status-* token is used as a `color:` value in the console section", () => {
    const section = css.slice(css.indexOf("Systems console — developer surface"));
    // `(?<![\w-])` so `border-color:` does not match — a border is a graphical
    // object at a 3:1 bar, not text at 4.5:1, and the fill steps clear that.
    const offenders = [...section.matchAll(/(?<![\w-])color:\s*var\(--status-(good|warning|critical)\)/g)]
      .map((m) => m[0]);
    assert.deepEqual(
      offenders,
      [],
      "use the matching --*-text role: the fill steps are 3.0–3.8:1 on white",
    );
  });
});
