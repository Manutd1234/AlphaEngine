/**
 * The house rules that were written down and never enforced.
 *
 * Two planning notes, both kept outside this repository, listed them:
 * no new npm dependencies, no emoji in UI, no colour-only meaning, honest
 * provenance labels, `prefers-reduced-motion` respected everywhere. Four of
 * those have tests. "No emoji" did not, and by the time this file was written
 * four had shipped — 🟢/🟡 in the provider health counts and 🟢/🔴 in the kill
 * switch, which are the two most safety-critical surfaces in the product.
 *
 * A rule documented in two plans and enforced by neither is a preference.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const files = [...sources(join(root, "components")), ...sources(join(root, "app"))];

/**
 * Pictographic emoji and the coloured geometric shapes that do the same job.
 *
 * Deliberately NOT the typographic glyphs this codebase uses as its status
 * vocabulary — ● ▲ ✕ ○ ◌ ✓ ✗ → are marks, not pictures, they inherit the text
 * colour, and they render in the app's own font rather than in a vendor's
 * emoji set. The distinction is the whole rule: one is typography, the other
 * is a picture of a traffic light.
 */
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F0FF}\u{2B00}-\u{2BFF}\u{FE0F}]|[\u{26A0}-\u{27BF}]\u{FE0F}/u;

describe("no emoji in the UI", () => {
  it("ships none in any component or route", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      source.split("\n").forEach((line, index) => {
        // Comments may name the emoji they are explaining the absence of.
        const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
        if (EMOJI.test(code)) {
          offenders.push(`${file.slice(root.length)}:${index + 1} — ${line.trim().slice(0, 80)}`);
        }
      });
    }
    assert.deepEqual(
      offenders,
      [],
      `emoji in the UI, against the documented house rule:\n  ${offenders.join("\n  ")}`,
    );
  });

  it("still allows the typographic status glyphs", () => {
    // Guard against the check above being tightened into uselessness: the
    // house vocabulary must keep passing, or someone will silence the rule
    // rather than the emoji.
    for (const glyph of ["●", "▲", "✕", "○", "◌", "✓", "→"]) {
      assert.equal(EMOJI.test(glyph), false, `${glyph} is house typography, not an emoji`);
    }
  });
});

describe("motion decorates, text means", () => {
  /**
   * The live-pulse halo says "this dot is fed by a live poll" — but a pulse
   * is colour-and-motion, both of which forced-colors and reduced-motion may
   * strip. So the dot is decoration by contract: every element carrying
   * `pulse-live` must be `aria-hidden`, with the word beside it carrying the
   * state. Vacuously green until the first caller lands, red the day someone
   * hangs meaning on the halo itself.
   */
  it("every pulse-live element is aria-hidden decoration", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      source.split("\n").forEach((line, index) => {
        if (line.includes("pulse-live") && !line.includes("aria-hidden")) {
          offenders.push(`${file.slice(root.length)}:${index + 1} — ${line.trim().slice(0, 80)}`);
        }
      });
    }
    assert.deepEqual(
      offenders,
      [],
      `pulse-live carrying meaning without aria-hidden decoration contract:\n  ${offenders.join("\n  ")}`,
    );
  });
});

describe("an empty result is reported, not hidden", () => {
  /**
   * `no-dead-ends.test.ts` already forbids `return null` on a provenance test.
   * A count is the same defect wearing a different condition: the card
   * vanishes, and the reader cannot tell "the check ran and found nothing"
   * from "the check never ran".
   */
  it("OutageIncidents renders its own absence", () => {
    const source = readFileSync(join(root, "components/systems/OutageIncidents.tsx"), "utf8");
    assert.doesNotMatch(
      source.replace(/\/\*[\s\S]*?\*\//g, ""),
      /if \(outages\.length === 0\) return null/,
      "an absent card and a card reporting an absence mean different things",
    );
    assert.match(source, /No provider is under a simulated outage/);
    // And it says what the absence does NOT prove, which is the honest half.
    // JSX wraps its copy, so match across the line break the formatter inserts.
    // The sentence was shortened in a copy-reduction pass ("the providers
    // themselves" → "the providers"); the claim it makes is unchanged.
    assert.match(source, /says nothing\s+about whether the providers\s+are healthy/);
  });
});
