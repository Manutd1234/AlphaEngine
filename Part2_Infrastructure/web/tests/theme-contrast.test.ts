/**
 * The contrast of anything this stylesheet renders as text.
 *
 * These are not aesthetic assertions. The fact they pin has already been wrong
 * in this stylesheet and was not visible in review: graphical status steps
 * and status text had been treated as interchangeable roles. The console
 * renders status as icon + word + colour, so the word keeps a text step. The
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

  it("never dims whole workspace sections in scroll-linked motion", () => {
    assert.match(css, /animation:\s*rise-in-view linear;/);
    assert.match(
      css,
      /@keyframes\s+rise-in-view\s*\{\s*from\s*\{\s*transform:\s*translateY\(14px\);\s*\}\s*to\s*\{\s*transform:\s*none;\s*\}\s*\}/,
    );
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
  "surface-0": "#f5efe9",
  "surface-1": "#ffffff",
  "surface-2": "#f2ebe5",
  "surface-3": "#e4d6ca",
  "text-primary": "#1f1b18",
  "text-secondary": "#463d37",
  "text-muted": "#5d524b",
  "grid": "#c3b3a8",
  "axis": "#78665b",
  "border": "#a38f82",
  "status-good": "#0b7652",
  "status-warning": "#985100",
  "status-critical": "#b03445",
  "success-text": "#086548",
  "warning-text": "#854400",
  "critical-text": "#942f3e",
  "notice-text": "#7a351d",
  "json-accent": "#075985",
  "series-1": "#075985",
  "series-2": "#942f3e",
  "series-3": "#086548",
  "diverging-pos": "#6f3820",
  "diverging-neg": "#942f3e",
  "diverging-mid": "#e4d6ca",
  "focus-ring": "#075985",
  "on-accent": "#ffffff",
  "state-good-bg": "#dcefe5",
  "state-warning-bg": "#f7e5c7",
  "state-critical-bg": "#f4dfe2",
  "state-info-bg": "#d9eaf3",
} as const;

const DARK = {
  "surface-0": "#0b0e12",
  "surface-1": "#151a21",
  "surface-2": "#202832",
  "surface-3": "#2d3845",
  "text-primary": "#f7f9fc",
  "text-secondary": "#ccd3dc",
  "text-muted": "#a7b2bf",
  "grid": "#46515f",
  "axis": "#8996a6",
  "border": "#56616f",
  "status-good": "#5bdbab",
  "status-warning": "#f3c565",
  "status-critical": "#ff7f86",
  "success-text": "#7ce5bc",
  "warning-text": "#f7ce79",
  "critical-text": "#ffa0a5",
  "notice-text": "#f1ad7a",
  "json-accent": "#82bdff",
  "series-1": "#6db2ff",
  "series-2": "#ff9a84",
  "series-3": "#5bdbab",
  "diverging-pos": "#6db2ff",
  "diverging-neg": "#ff7f86",
  "diverging-mid": "#202832",
  "focus-ring": "#6db2ff",
  "on-accent": "#07131f",
  "state-good-bg": "#19382f",
  "state-warning-bg": "#3d3019",
  "state-critical-bg": "#402329",
  "state-info-bg": "#1a2d42",
} as const;

const TEXT_ROLES = [
  "text-primary",
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
      for (const surface of ["surface-0", "surface-1", "surface-2", "surface-3"] as const) {
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
    const light = tokensIn(blockAfter(css, ":root {"));
    const attrDark = tokensIn(blockAfter(css, ':root[data-theme="dark"]'));
    for (const [name, expected] of [["light", LIGHT], ["dark", DARK]] as const) {
      const parsed = name === "light" ? light : attrDark;
      for (const [role, value] of Object.entries(expected)) {
        assert.equal(parsed.get(`--${role}`), value, `${name} --${role} changed without updating its contrast contract`);
      }
      for (const surface of ["surface-0", "surface-1", "surface-2", "surface-3"] as const) {
        assert.ok(contrast(expected.axis, expected[surface]) >= 3, `${name} axis disappears on ${surface}`);
        // Ordinary rules group already-distinct planes and deliberately stay
        // quieter than controls. Interactive boundaries use --border-strong,
        // which aliases the 3:1 axis step and is asserted below.
        assert.ok(contrast(expected.border, expected[surface]) >= 1.75, `${name} border disappears on ${surface}`);
        assert.ok(contrast(expected.grid, expected[surface]) >= 1.25, `${name} grid disappears on ${surface}`);
        assert.ok(contrast(expected["focus-ring"], expected[surface]) >= 3, `${name} focus ring disappears on ${surface}`);
        for (const role of ["status-good", "status-warning", "status-critical"] as const) {
          assert.ok(contrast(expected[role], expected[surface]) >= 3, `${name} ${role} disappears on ${surface}`);
        }
        for (const role of ["series-1", "series-2", "series-3"] as const) {
          assert.ok(contrast(expected[role], expected[surface]) >= AA_NORMAL, `${name} ${role} text on ${surface}`);
        }
      }
    }
  });
});

describe("saturated controls use a foreground that flips with the palette", () => {
  for (const [themeName, palette] of [["light", LIGHT], ["dark", DARK]] as const) {
    for (const fill of ["series-1", "series-2", "series-3", "diverging-pos", "diverging-neg"] as const) {
      it(`${themeName}: --on-accent on --${fill}`, () => {
        const value = contrast(palette["on-accent"], palette[fill]);
        assert.ok(value >= AA_NORMAL, `${themeName} ${fill} foreground is ${value.toFixed(2)}:1`);
      });
    }
  }

  it("publishes the tested foreground in both palette blocks", () => {
    const light = tokensIn(blockAfter(css, ":root {"));
    const dark = tokensIn(blockAfter(css, ':root[data-theme="dark"]'));
    assert.equal(light.get("--on-accent"), LIGHT["on-accent"]);
    assert.equal(dark.get("--on-accent"), DARK["on-accent"]);
  });

  it("keeps disabled controls legible without reducing whole-control opacity", () => {
    const cases = [
      [LIGHT["text-muted"], LIGHT["surface-2"], LIGHT.axis],
      [DARK["text-muted"], DARK["surface-2"], DARK.axis],
    ] as const;
    for (const [ink, background, boundary] of cases) {
      assert.ok(contrast(ink, background) >= AA_NORMAL);
      assert.ok(contrast(boundary, background) >= 3);
    }
    const light = tokensIn(blockAfter(css, ":root {"));
    const dark = tokensIn(blockAfter(css, ':root[data-theme="dark"]'));
    assert.equal(light.get("--disabled-border"), "var(--axis)");
    assert.equal(dark.get("--disabled-border"), "var(--axis)");
  });

  it("reserves the strong boundary for interactive controls", () => {
    const light = tokensIn(blockAfter(css, ":root {"));
    const dark = tokensIn(blockAfter(css, ':root[data-theme="dark"]'));
    assert.equal(light.get("--border-strong"), "var(--axis)");
    assert.equal(dark.get("--border-strong"), "var(--axis)");
    assert.match(css, /select,[\s\S]*?border:\s*1px solid var\(--border-strong\);/);
    assert.match(css, /button\s*\{[\s\S]*?border:\s*1px solid var\(--border-strong\);/);
  });

  it("keeps destructive white labels readable in resting and hover states", () => {
    const light = tokensIn(blockAfter(css, ":root {"));
    const foreground = light.get("--critical-action-fg");
    assert.equal(foreground, "#ffffff");
    for (const token of ["--critical-action-bg", "--critical-action-hover"] as const) {
      const fill = light.get(token);
      assert.ok(fill, `${token} is missing`);
      assert.ok(contrast(foreground!, fill!) >= AA_NORMAL, `${token} does not carry white action text`);
    }
    assert.match(css, /\.handoff-fire:not\(:disabled\)[^{]*\{[^}]*color:\s*var\(--critical-action-fg\)/);
  });
});

describe("decision-loop state washes retain readable ink and visible keylines", () => {
  const states = [
    ["success-text", "status-good", "state-good-bg"],
    ["series-1", "series-1", "state-info-bg"],
    ["warning-text", "status-warning", "state-warning-bg"],
    ["critical-text", "status-critical", "state-critical-bg"],
  ] as const;

  for (const [themeName, palette] of [["light", LIGHT], ["dark", DARK]] as const) {
    for (const [ink, keyline, wash] of states) {
      it(`${themeName}: --${ink} and --${keyline} remain distinct on --${wash}`, () => {
        assert.ok(contrast(palette[ink], palette[wash]) >= AA_NORMAL);
        assert.ok(contrast(palette[keyline], palette[wash]) >= 3);
      });
    }
  }
});

// --------------------------------------------------------------------------
// Fill steps stay fill steps
// --------------------------------------------------------------------------

describe("the console keeps graphical status and status-text roles separate", () => {
  it("no --status-* token is used as a `color:` value in the console section", () => {
    const section = css.slice(css.indexOf("Systems console — developer surface"));
    // `(?<![\w-])` so `border-color:` does not match — a border is a graphical
    // object at a 3:1 bar, not text at 4.5:1, and the fill steps clear that.
    const offenders = [...section.matchAll(/(?<![\w-])color:\s*var\(--status-(good|warning|critical)\)/g)]
      .map((m) => m[0]);
    assert.deepEqual(
      offenders,
      [],
      "use the matching --*-text role so graphical and textual semantics stay independently tunable",
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
  const plane = "#0d1117";
  const boundary = "#7f8c9c";
  /** Level colours and body ink, from the .console-log family. */
  const ink: Record<string, string> = {
    message: "#f7f9fc",
    fields: "#b8c2ce",
    debug: "#b8c2ce",
    info: "#82bdff",
    warn: "#f3c565",
    error: "#ffa0a5",
    source: "#5bdbab",
  };

  it("paints the plane the ratios below assume", () => {
    // Anchored to the line start: `.workspace-subtab-panel .console-log {`
    // appears earlier in the sheet and carries only sizing.
    const rule = css.slice(css.indexOf("\n.console-log {"));
    assert.match(rule.slice(0, 900), new RegExp(`background:\\s*${plane};`));
    assert.match(rule.slice(0, 900), new RegExp(`border:\\s*1px solid ${boundary};`));
    const ratio = contrast(boundary, plane);
    assert.ok(ratio >= 3, `console boundary is ${ratio.toFixed(2)}:1 on ${plane}`);
  });

  for (const [role, hex] of Object.entries(ink)) {
    it(`${role} clears AA on the console plane`, () => {
      const ratio = contrast(hex, plane);
      assert.ok(ratio >= AA_NORMAL, `${role} is ${ratio.toFixed(2)}:1 on ${plane}`);
    });
  }

  it("the origin chip's own text clears AA on the chip, not just on the plane", () => {
    // The chip sits a step above the plane, so the plane's ratio flatters it.
    const ratio = contrast("#ccd3dc", "#26303c");
    assert.ok(ratio >= AA_NORMAL, `origin text is ${ratio.toFixed(2)}:1 on its chip`);
  });

  it("the other terminal block shares the plane rather than inventing one", () => {
    const rule = css.slice(css.indexOf(".handoff-request {"));
    assert.match(rule.slice(0, 500), new RegExp(`background:\\s*${plane};`));
    assert.match(rule.slice(0, 500), new RegExp(`border:\\s*1px solid ${boundary};`));
  });
});
