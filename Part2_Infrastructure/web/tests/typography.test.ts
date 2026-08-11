/**
 * The typography contract.
 *
 * The workspace type is two self-hosted variable fonts — Inter on `--sans`,
 * JetBrains Mono on `--mono` — loaded by next/font in `app/layout.tsx` and
 * consumed through exactly one binding point: the two token lines in
 * `app/globals.css`. Every failure mode of that arrangement is silent. A font
 * loaded but never referenced renders the system stack and nothing errors. A
 * token that loses its `var()` head does the same. A stray
 * `fonts.googleapis.com` link reintroduces the third-party request next/font
 * exists to eliminate, and the page still looks right. So this file pins the
 * chain end to end:
 *
 *  1. **The layout loads both fonts** from `next/font/google`, with
 *     `display: "swap"` (text never invisible while the WOFF2 arrives) and the
 *     `variable` names the stylesheet expects — and publishes both on <html>,
 *     because a variable declared but never mounted is also silent.
 *  2. **The tokens actually consume them.** `--sans` leads with
 *     `var(--font-sans, …)` and `--mono` with `var(--font-mono, …)`, each with
 *     a same-slot fallback and a trailing generic family, so an absent
 *     variable degrades to the system stack instead of collapsing the
 *     declaration.
 *  3. **Nothing else loads type.** No `@font-face`, no Google Fonts host in
 *     the sources next/font does not own.
 *
 * Regex over hand-written sources, per the justification in `theme.test.ts`.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const layout = read("../app/layout.tsx");
const css = read("../app/globals.css");
const tailwind = read("../app/tailwind.css");

/** The `{ … }` config object of a next/font call, brace-matched. */
function fontConfig(source: string, fontName: string): string {
  const call = source.indexOf(`${fontName}(`);
  assert.notEqual(call, -1, `layout.tsx never calls ${fontName}()`);
  const open = source.indexOf("{", call);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  assert.fail(`unclosed ${fontName}() config`);
}

// --------------------------------------------------------------------------
// 1 — the layout loads both fonts, and mounts them
// --------------------------------------------------------------------------

describe("layout loads the two fonts", () => {
  it("imports Inter and JetBrains_Mono from next/font/google", () => {
    assert.match(
      layout,
      /import\s*\{[^}]*\bInter\b[^}]*\bJetBrains_Mono\b[^}]*\}\s*from\s*"next\/font\/google"/s,
      "the self-hosting guarantee lives in next/font/google — both families come from it",
    );
  });

  for (const [font, variable] of [
    ["Inter", "--font-sans"],
    ["JetBrains_Mono", "--font-mono"],
  ] as const) {
    it(`${font}: display swap, variable ${variable}`, () => {
      const config = fontConfig(layout, font);
      assert.match(
        config,
        /display:\s*"swap"/,
        `${font} must keep text visible on the fallback while loading`,
      );
      assert.match(
        config,
        new RegExp(`variable:\\s*"${variable}"`),
        `${font} must publish ${variable} — the name globals.css consumes`,
      );
    });
  }

  it("mounts both variables on <html>", () => {
    // A font configured but never mounted publishes no CSS variable — the
    // tokens fall back to the system stack and nothing fails visibly.
    assert.match(
      layout,
      /<html[^>]*className=\{`\$\{inter\.variable\} \$\{jetBrainsMono\.variable\}`\}/s,
      "<html> must carry both .variable classes",
    );
  });
});

// --------------------------------------------------------------------------
// 2 — the tokens consume the variables, and degrade instead of collapsing
// --------------------------------------------------------------------------

describe("the token stacks bind the fonts", () => {
  const stacks = [
    { token: "--sans", variable: "--font-sans", generic: "sans-serif" },
    { token: "--mono", variable: "--font-mono", generic: "monospace" },
  ];

  for (const { token, variable, generic } of stacks) {
    it(`${token} leads with var(${variable}, …) and ends with ${generic}`, () => {
      const line = css
        .split("\n")
        .find((l) => l.trim().startsWith(`${token}:`));
      assert.ok(line, `globals.css must define ${token}`);
      assert.match(
        line,
        new RegExp(`${token}:\\s*var\\(${variable},\\s*[^)]+\\)`),
        `${token} must consume ${variable} — with a same-slot fallback, because `
          + "an undefined variable without one invalidates the whole declaration "
          + "at computed-value time and the stack collapses to the inherited font",
      );
      assert.match(
        line,
        new RegExp(`${generic};\\s*$`),
        `${token} must end on the generic ${generic} family`,
      );
    });
  }
});

// --------------------------------------------------------------------------
// 3 — nothing else loads type
// --------------------------------------------------------------------------

describe("next/font owns font delivery", () => {
  it("no @font-face, no Google Fonts host, in the sources we own", () => {
    for (const [name, source] of [
      ["app/layout.tsx", layout],
      ["app/globals.css", css],
      ["app/tailwind.css", tailwind],
    ] as const) {
      assert.doesNotMatch(
        source,
        /@font-face|fonts\.googleapis\.com|fonts\.gstatic\.com/,
        `${name} must not load fonts itself — next/font generates the `
          + "@font-face rules and serves the files from this origin",
      );
    }
  });
});
