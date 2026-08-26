/**
 * The contrast of anything this stylesheet renders as text.
 *
 * These are not aesthetic assertions. The fact they pin has already been wrong
 * in this stylesheet and was not visible in review: `--status-good`,
 * `--status-warning` and `--status-critical` are 3.0–3.8:1 on white, which is
 * correct for a dot or a meter fill and below AA for a word. The console
 * renders status as icon + word + colour, so the word needs a text step. The
 * two rules that follow are that every colour used as text clears AA on every
 * surface it can land on, and that a fill step is never used as a `color:`.
 *
 * Contrast is arithmetic, so it can be checked rather than eyeballed — which
 * is the only reason this is a test and not a review note.
 *
 * The theme-invariant planes are here too. The log console holds its own dark
 * palette in light mode as well as dark, so its tokens never appear in either
 * dark block, and the palette parity suite next door cannot see it. It is
 * checked against its own fixed plane instead.
 *
 * Parsing CSS with a regex is normally a bad idea. Here the input is one
 * hand-written cascade whose custom properties are all simple `--name: value;`
 * declarations, and the alternative is carrying a CSS parser to assert two
 * facts — so the narrowness is deliberate rather than careless. The readers
 * live in `tests/helpers/css-tokens.ts`, shared with the palette parity half.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { globalsCss } from "./globals-css";
import { assertCascadeLoaded, blockAfter, tokensIn } from "./helpers/css-tokens";

const css = globalsCss;

/** Every span this file slices out of the cascade before asserting on it. */
const SCANNED_MARKERS = [
  ':root[data-theme="dark"]',
  ":root {",
  "Systems console — developer surface",
  "\n.console-log {",
  ".handoff-request {",
];

describe("the stylesheet these assertions parse was actually read", () => {
  it("holds a non-empty cascade containing every span this file slices", () => {
    // `css.slice(css.indexOf(marker))` on a miss returns the last character,
    // and "collect the offenders in that span, expect none" then passes for
    // the wrong reason. An unresolved partial path is enough to cause it, and
    // nothing about the run would look different.
    assertCascadeLoaded(css, SCANNED_MARKERS);
  });
});

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
  // SLATE since 2026-08-26, zinc before it. The move is a HUE shift at matched
  // luminance — every neutral kept its lightness to within 0.01 and the two
  // that moved more (--axis, --border) carry no text — so every ratio below is
  // the ratio it was, and none of them was recomputed to fit. Re-run rather
  // than assumed: --json-accent still clears AA here by 0.20, so this value is
  // not free to drift darker without moving the accent with it.
  "surface-2": "#f1f5f9",
  "success-text": "#087552",
  "warning-text": "#85570b",
  "critical-text": "#b3242e",
  "notice-text": "#9a4415",
  "text-secondary": "#4e5764",
  "text-muted": "#616a79",
  "json-accent": "#2563eb",
} as const;

const DARK = {
  // Slate-900 and up since 2026-08-26, zinc before it, near-black before that.
  // The two roles below that carry a comment moved WITH the planes rather than
  // being left behind: lightening a surface reduces the contrast of everything
  // on it, and both were inside 0.15 of the AA floor before they were nudged.
  // The slate move lifted dark text-secondary and text-muted slightly, which
  // in dark mode is MORE contrast against the plane, not less.
  "surface-1": "#1c222b",
  "surface-2": "#232a34",
  // LIFTED with the slate move, and it is the only role that needed it.
  // #0ca50c cleared AA on zinc's --surface-2 by 0.041 — 4.541 against a floor
  // of 4.5, which the note above already called "inside 0.15". Slate's
  // --surface-2 is a hair lighter, and a hair was all it had: 4.409. So the
  // token moved rather than the ramp, which is the rule this palette is
  // changed under. #12b312 clears by 0.65 on the inset and 1.20 on the card,
  // so it is not sitting on the edge any more.
  "success-text": "#12b312",
  "warning-text": "#e8ab3d",
  "critical-text": "#f0737c",
  "notice-text": "#f08a5a",
  "text-secondary": "#aeb8c6",
  "text-muted": "#8b94a4",
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
    const attrDark = tokensIn(blockAfter(css, ':root[data-theme="dark"]'));
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
    const light = tokensIn(blockAfter(css, ":root {"));
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
 * The log console is a theme-invariant surface: it holds its own dark palette
 * in light mode as well as dark, which is why its tokens live in `:root` alone
 * and never appear in either dark block. That also meant nothing above checked
 * it — the contrast contract covers the roles that flip with the theme and
 * silently skipped the one plane that cannot.
 *
 * The command-centre hero used to be the second such plane, with a nine-token
 * `--hero-*` ink ramp asserted here against a fixed #18181B. It is gone: the
 * overview renders through PageHead on ordinary surfaces now, so its colours
 * are the theme-flipping roles checked above and there is no second palette
 * left to special-case. A terminal is still a terminal, so this one stays.
 */
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
