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

import {
  DEFAULT_THEME_PREFERENCE,
  THEME_PREFERENCES,
  isThemePreference,
  nextThemeMode,
  nextThemePreference,
  paletteForPreference,
  resolveThemeMode,
  resolveThemePreference,
} from "../lib/theme";

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

// --------------------------------------------------------------------------
// The preference, which is not the palette
// --------------------------------------------------------------------------

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
  // Zinc-900 and up, since the palette moved off near-black. The two roles below
  // that carry a comment moved WITH the planes rather than being left behind:
  // lightening a surface reduces the contrast of everything on it, and both were
  // inside 0.15 of the AA floor at the new values before they were nudged.
  "surface-1": "#1f1f23",
  "surface-2": "#27272a",
  "success-text": "#0ca50c",
  "warning-text": "#e8ab3d",
  "critical-text": "#f0737c",
  "notice-text": "#f08a5a",
  "text-secondary": "#b1b1b9",
  "text-muted": "#8d8d97",
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

// --------------------------------------------------------------------------
// The fixed planes
// --------------------------------------------------------------------------

/**
 * The hero and the log console are theme-invariant surfaces: they hold their
 * own dark palette in light mode as well as dark, which is why their tokens
 * live in `:root` alone and never appear in either dark block. That also meant
 * nothing above checked them — the contrast contract covered the roles that
 * flip with the theme and silently skipped the two planes that cannot.
 *
 * These assertions close that gap. They are the reason the planes could be
 * lifted off near-black at all: every ratio below was recomputed against the
 * new values rather than assumed to have survived.
 */
const HERO_PLANE = "#18181B";

/** Every token the hero renders as text or as a status word. */
const HERO_INK: Record<string, string> = {
  "--hero-text": "#f4f4f5",
  "--hero-text-dim": "#a9b0bd",
  "--hero-accent": "#9ec9fb",
  "--hero-accent-2": "#82b6f7",
  "--hero-muted": "#8f939c",
  "--hero-info": "#86adf5",
  "--hero-good": "#35c48f",
  "--hero-warn": "#e8ab3d",
  "--hero-critical": "#f0737c",
};

describe("the command-centre hero is legible on its own plane", () => {
  const root = tokensIn(blockAfter(":root {"));

  it("declares the plane the ratios below are measured against", () => {
    assert.equal(
      root.get("--hero-plane"),
      HERO_PLANE,
      "--hero-plane moved in the stylesheet without this test being updated",
    );
  });

  for (const [token, expected] of Object.entries(HERO_INK)) {
    it(`${token} still matches the stylesheet and clears AA on the plane`, () => {
      assert.equal(root.get(token), expected, `${token} changed without re-checking its contrast`);
      const ratio = contrast(expected, HERO_PLANE);
      assert.ok(
        ratio >= AA_NORMAL,
        `${token} is ${ratio.toFixed(2)}:1 on ${HERO_PLANE}, below ${AA_NORMAL}`,
      );
    });
  }

  it("stays out of both dark blocks, since it does not flip with the theme", () => {
    // A hero token declared in a dark block would take the light value for
    // anyone who has pressed the toggle — the failure the plane comment warns
    // about, and the reason these live in :root alone.
    for (const marker of ['@media (prefers-color-scheme: dark)', ':root[data-theme="dark"]']) {
      const block = tokensIn(blockAfter(marker));
      for (const token of ["--hero-plane", ...Object.keys(HERO_INK)]) {
        assert.equal(block.has(token), false, `${token} must not be redeclared in ${marker}`);
      }
    }
  });
});

describe("the log console is legible on its own plane", () => {
  const plane = "#16161c";
  /** Level colours and body ink, from the .console-log family. */
  const ink: Record<string, string> = {
    message: "#d4d4d8",
    fields: "#8a8a94",
    debug: "#85858f",
    info: "#5a9ceb",
    warn: "#e8ab3d",
    error: "#f0737c",
    source: "#35c48f",
  };

  it("paints the plane the ratios below assume", () => {
    // Anchored to the line start: `.workspace-subtab-panel .console-log {`
    // appears earlier in the sheet and carries only sizing.
    const rule = css.slice(css.indexOf("\n.console-log {"));
    assert.match(rule.slice(0, 900), new RegExp(`background:\\s*${plane};`));
  });

  for (const [role, hex] of Object.entries(ink)) {
    it(`${role} clears AA on the console plane`, () => {
      const ratio = contrast(hex, plane);
      assert.ok(ratio >= AA_NORMAL, `${role} is ${ratio.toFixed(2)}:1 on ${plane}`);
    });
  }

  it("the origin chip's own text clears AA on the chip, not just on the plane", () => {
    // The chip sits a step above the plane, so the plane's ratio flatters it.
    const ratio = contrast("#9a9aa4", "#24242b");
    assert.ok(ratio >= AA_NORMAL, `origin text is ${ratio.toFixed(2)}:1 on its chip`);
  });

  it("the other terminal block shares the plane rather than inventing one", () => {
    const rule = css.slice(css.indexOf(".handoff-request {"));
    assert.match(rule.slice(0, 500), new RegExp(`background:\\s*${plane};`));
  });
});
