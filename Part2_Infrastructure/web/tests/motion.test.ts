/**
 * The motion contract.
 *
 * This stylesheet spent a year with two `prefers-reduced-motion` blocks that
 * disagreed: a nuclear `* { animation: none !important }` and, ten thousand
 * lines later, a correct 1ms-duration block it made unreachable. `none` is the
 * wrong verb — it discards `both`-filled end-states and strips `animationend`,
 * so JS sequenced on animation completion silently never fires for exactly the
 * users the media query exists to serve. 1ms runs every animation to its final
 * frame instantly and every event still lands.
 *
 * So this file pins three rules:
 *
 *  1. **One reduce block**, and it collapses durations rather than deleting
 *     animations.
 *  2. **Durations are tokens.** A literal `150ms` inside a `transition:` is
 *     invisible to a global timing change — which is how the file accumulated
 *     seven of them at six different values.
 *  3. **The one rAF animation (NumberTicker) honours the same contract** the
 *     CSS block cannot reach, and never animates on mount — a page counting up
 *     from zero on load is a slot machine, which is the gamification boundary.
 *
 * Regex over one hand-written stylesheet, per the justification in
 * `theme.test.ts` and `layering.test.ts`.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const cssPath = fileURLToPath(new URL("../app/globals.css", import.meta.url));
const css = readFileSync(cssPath, "utf8");

/** Comment bodies blanked, newlines kept — declarations only, lines intact. */
const declarations = css.replace(/\/\*[\s\S]*?\*\//g, (block) =>
  block.replace(/[^\n]/g, " "));

/** Line number for a character offset, for a failure message you can click. */
function lineOf(index: number): number {
  return css.slice(0, index).split("\n").length;
}

/** The `{ … }` body of the media block starting at `index`, brace-matched. */
function blockBody(index: number): string {
  const open = declarations.indexOf("{", index);
  let depth = 0;
  for (let i = open; i < declarations.length; i++) {
    if (declarations[i] === "{") depth += 1;
    if (declarations[i] === "}") {
      depth -= 1;
      if (depth === 0) return declarations.slice(open, i + 1);
    }
  }
  assert.fail("unclosed media block");
}

// --------------------------------------------------------------------------
// 1 — one reduce block
// --------------------------------------------------------------------------

describe("one reduced-motion contract", () => {
  const matches = [...declarations.matchAll(/@media \(prefers-reduced-motion: reduce\)/g)];

  it("declares exactly one reduce block", () => {
    assert.equal(
      matches.length,
      1,
      "reduce blocks at: "
        + matches.map((m) => `globals.css:${lineOf(m.index)}`).join(", ")
        + " — two blocks is how the nuclear one shadowed the correct one for a year",
    );
  });

  it("collapses durations to 1ms rather than deleting animations", () => {
    const body = blockBody(matches[0].index);
    assert.match(body, /animation-duration:\s*1ms\s*!important/);
    assert.match(body, /transition-duration:\s*1ms\s*!important/);
    assert.doesNotMatch(
      body,
      /animation:\s*none/,
      "`animation: none` discards end-states and animationend — collapse durations instead",
    );
  });

  it("zeroes delays so staggered reveals collapse to one paint", () => {
    const body = blockBody(matches[0].index);
    assert.match(body, /animation-delay:\s*0m?s\s*!important/);
    assert.match(body, /transition-delay:\s*0m?s\s*!important/);
  });
});

// --------------------------------------------------------------------------
// 2 — durations are tokens
// --------------------------------------------------------------------------

describe("the motion ladder", () => {
  it("declares every rung in :root", () => {
    for (const token of [
      "--dur-fast", "--dur", "--dur-slow", "--dur-reveal", "--dur-draw",
      "--dur-pulse", "--dur-flash", "--dur-shimmer",
      "--ease", "--ease-out", "--ease-emphasized", "--ease-pop",
    ]) {
      assert.match(
        declarations,
        new RegExp(`${token}:\\s*[^;]+;`),
        `${token} is missing from the ladder`,
      );
    }
  });

  it("no transition hardcodes a duration", () => {
    const offenders: string[] = [];
    for (const match of declarations.matchAll(/transition:[^;]*;/g)) {
      // A literal duration is a number wearing a unit; cubic-bezier control
      // points are bare numbers and never match.
      if (/\d(?:\.\d+)?(?:ms|s)\b/.test(match[0])) {
        offenders.push(`globals.css:${lineOf(match.index)} — ${match[0].trim()}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `transitions timed outside the token ladder:\n  ${offenders.join("\n  ")}`,
    );
  });

  it("no animation hardcodes a duration", () => {
    // The transition ratchet above never covered `animation:` shorthands, and
    // six literals accumulated in its blind spot — three copies of the
    // live-pulse loop, both tick flashes and the skeleton shimmer.
    const offenders: string[] = [];
    for (const match of declarations.matchAll(/animation:[^;]*;/g)) {
      if (/\d(?:\.\d+)?(?:ms|s)\b/.test(match[0])) {
        offenders.push(`globals.css:${lineOf(match.index)} — ${match[0].trim()}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `animations timed outside the token ladder:\n  ${offenders.join("\n  ")}`,
    );
  });

  it("the shared pulse and flash read the ladder and rest quiet", () => {
    // .pulse-live is the generic live halo; .value-tick the one-shot wash.
    // Both must reuse the existing keyframes at token pace, and live-pulse
    // must end at opacity 0 so the reduce clamp rests it as a static dot.
    assert.match(
      declarations,
      /\.pulse-live::after \{[^}]*animation: live-pulse var\(--dur-pulse\)/,
      ".pulse-live must reuse the live-pulse keyframes at the pulse rung",
    );
    assert.match(
      declarations,
      /\.value-tick\[data-tick="changed"\] \{[^}]*animation: tick-flash var\(--dur-flash\)/,
      ".value-tick must flash once at the flash rung",
    );
    const keyframes = declarations.indexOf("@keyframes live-pulse");
    assert.notEqual(keyframes, -1);
    assert.match(
      declarations.slice(keyframes, keyframes + 400),
      /(100%|to)[^}]*opacity:\s*0/,
      "live-pulse must rest at opacity 0",
    );
  });

  it("the overshoot stays scarce", () => {
    // --ease-pop is reserved for the promotion gate clearing; a second caller
    // dilutes the one moment the overshoot exists to mark.
    const uses = [...declarations.matchAll(/var\(--ease-pop\)/g)];
    assert.equal(
      uses.length,
      1,
      "var(--ease-pop) callers at: "
        + uses.map((m) => `globals.css:${lineOf(m.index)}`).join(", "),
    );
  });
});

// --------------------------------------------------------------------------
// 3 — NumberTicker
// --------------------------------------------------------------------------

describe("NumberTicker honours the contract CSS cannot reach", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../components/common/NumberTicker.tsx", import.meta.url)),
    "utf8",
  );

  it("renders the final value instantly under reduced motion", () => {
    assert.match(source, /prefers-reduced-motion:\s*reduce/);
  });

  it("never animates on mount", () => {
    // The previous-value ref starts null and the null case takes the
    // no-animation path; losing either half of that turns first paint into a
    // count-up from nothing.
    assert.match(source, /previous\.current\s*=\s*value/);
    assert.match(source, /from === null/);
  });

  it("reserves its width so counting never reflows neighbours", () => {
    assert.match(source, /--ticker-w/);
    const rule = declarations.indexOf(".number-ticker");
    assert.notEqual(rule, -1, ".number-ticker has no stylesheet rule");
    assert.match(
      declarations.slice(rule, declarations.indexOf("}", rule)),
      /min-width:\s*var\(--ticker-w/,
    );
  });

  it("times its count at the reveal rung", () => {
    // DURATION_MS claims to match --dur-reveal; a JS constant and a CSS token
    // can only drift silently, so both halves of the pair are pinned here and
    // either edit alone goes red.
    assert.match(source, /DURATION_MS = 420/);
    assert.match(declarations, /--dur-reveal:\s*420ms/);
  });
});
