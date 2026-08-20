/**
 * A status chip whose tone class has no rule behind it.
 *
 * `.pill` styles its tones as `pill--live | pill--stop | pill--warn |
 * pill--info`. Two surfaces spelled them a different way — `pill is-good` /
 * `pill is-warning` in HealthMatrix, `pill data-tone="accent"` in
 * ResearchCorpus — and no rule matched either, so those chips rendered as
 * plain untoned text. The provider-health counts sat under a comment asserting
 * "the colour still comes from the pill tone" while it did not.
 *
 * This is the house's own failure mode: nothing looked broken. The glyph and
 * the word carried the meaning on their own, exactly as the no-colour-only
 * rule requires, so the missing colour was the half nobody misses. The suite
 * cannot see it either — a source-analysis test that checks the class is
 * present passes just as happily on a class that styles nothing.
 *
 * So this checks the join: every tone-shaped class a component renders must
 * resolve to a rule in the stylesheet.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { globalsCss } from "./globals-css";

const root = join(import.meta.dirname, "..");
const globals = globalsCss;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Comments stripped: this file's own prose names the forbidden spellings. */
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const files = sourceFiles(join(root, "components")).map((file) => ({
  path: file.slice(root.length + 1),
  code: strip(readFileSync(file, "utf8")),
}));

describe("every tone a chip claims is a tone the stylesheet renders", () => {
  /**
   * The families whose tone lives in a sibling class rather than a modifier.
   * Each entry is a base class and the tone spellings that must resolve.
   */
  const TONED = [".pill", ".page-status", ".verdict-pill"];

  for (const base of TONED) {
    it(`${base} renders no tone class the sheet has no rule for`, () => {
      const bare = base.slice(1);
      const offenders: string[] = [];
      for (const { path, code } of files) {
        /* Every className string that mentions the base class, in either the
           literal or template form. */
        for (const match of code.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
          const value = match[1] ?? match[2] ?? "";
          const tokens = value.split(/\s+/).filter(Boolean);
          if (!tokens.includes(bare)) continue;
          for (const token of tokens) {
            if (token === bare || token.includes("${") || token.startsWith(`${bare}--`)) continue;
            /* A sibling `is-*` class on a toned base has to have a rule. */
            if (!token.startsWith("is-")) continue;
            if (!globals.includes(`${base}.${token}`)) {
              offenders.push(`${path}: "${bare} ${token}" — no ${base}.${token} rule`);
            }
          }
        }
      }
      assert.deepEqual(
        offenders,
        [],
        `a chip claims a tone the stylesheet does not render, so it draws untoned:\n  ${offenders.join("\n  ")}`,
      );
    });
  }

  it("no component tones a pill through a data-tone the sheet ignores", () => {
    const hasRule = /\.pill\[data-tone/.test(globals);
    const offenders = files
      .filter(({ code }) => /className="[^"]*\bpill\b[^"]*"[^>]*\bdata-tone=/.test(code))
      .map(({ path }) => path);
    if (!hasRule) {
      assert.deepEqual(
        offenders,
        [],
        "`.pill` has no [data-tone] rule, so a data-tone on a pill styles nothing. " +
          "Use the pill--live|--stop|--warn|--info modifiers, or add the rule.",
      );
    }
  });
});
