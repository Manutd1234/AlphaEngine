/**
 * Every word drawn inside a plot reads a rung, and none of them guesses.
 *
 * WHY THIS EXISTS, and it is the third instance of one property found from
 * three sides in a day. `coherence-figure-margins.test.ts` scores in-plot
 * labels against a `RUNG` map — and only for text drawn at `y={MARGIN.top - k}`,
 * because its question is whether a label is clipped by the viewBox. A class it
 * does not know is skipped rather than failed, so "green" there means "checked
 * and fine" and "never looked" alike, and nothing distinguishes them.
 *
 * That map is right to be narrow: it exists for one arithmetic. What was
 * missing is the general claim, and this file makes it.
 *
 * WHAT SVG TEXT INHERITS IS NOTHING USEFUL. Prose on this desk inherits `body`
 * and steps with the reader's Text-size preference. A `<text>` inside an
 * `<svg>` inherits the SVG's computed font-size, which — unless a rule sets one
 * — is the document's 16px. On a diagram ladder whose rungs are 13px and 10px,
 * a class with no size renders half again as large as its neighbours and no
 * suite has ever said so. Measured across the engine when this was written: 75
 * distinct in-plot text classes, 68 sized, and the seven left over were four
 * modifiers riding a sized base and THREE REAL DEFECTS —
 * `diff-effect__row` and `diff-effect__tick` carrying only a `fill`, and
 * `diff-time__ticklabel` carrying `fontSize={10}` as an element attribute,
 * which is a px literal bypassing the ladder rather than a rung read off it.
 *
 * TWO RULES, and the second is what stops the first being satisfied by cheating:
 *
 *  1. Every class on an in-plot `<text>` either declares a `font-size` in the
 *     sheet, or is a modifier drawn ALONGSIDE a class that does. A modifier is
 *     legitimate — `coh-tape__tick--end` sets only `text-anchor` — but it has
 *     to arrive with its base rather than instead of it.
 *  2. No `<text>` carries a `fontSize` attribute. An element-level size is a
 *     literal the type ladder cannot see and `type-diagram-ladder` cannot
 *     check, which is exactly how one got to 10px without a rung.
 *
 * DERIVED, NEVER OBSERVED (CLAUDE.md, fact 6). This proves a class reaches a
 * declared size, not that a reader saw 13px.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { globalsCss } from "./globals-css";

const root = fileURLToPath(new URL("..", import.meta.url));

/** Comment bodies blanked, so prose naming a selector is never read as a rule. */
const sheet = globalsCss.replace(/\/\*[\s\S]*?\*\//g, " ");

function figures(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) figures(path, out);
    else if (entry.name.endsWith(".tsx")) out.push(path);
  }
  return out;
}

/** Does any rule mentioning this class set a font-size? */
function sized(name: string): boolean {
  const escaped = name.replace(/-/g, "\\-");
  const rules = new RegExp(`[^{}]*\\.${escaped}(?![\\w-])[^{}]*\\{([^}]*)\\}`, "g");
  for (const match of sheet.matchAll(rules)) {
    if (/font-size:/.test(match[1])) return true;
  }
  return false;
}

/** Every in-plot `<text>` tag on the engine, with the file that draws it. */
function textTags(): Array<{ file: string; tag: string }> {
  const out: Array<{ file: string; tag: string }> = [];
  for (const file of figures(join(root, "components/coherence"))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/<text\b[^>]*?\/?>/gs)) {
      out.push({ file: file.split("/components/")[1], tag: match[0].replace(/\s+/g, " ") });
    }
  }
  return out;
}

const tags = textTags();

describe("in-plot words read the diagram ladder", () => {
  it("finds the engine's figures at all", () => {
    // A walk that found nothing would make both assertions vacuously green,
    // which is the failure mode this whole file is about.
    assert.ok(tags.length > 100, `only ${tags.length} <text> tags found — have the figures moved?`);
  });

  it("every class on a plot label reaches a declared size", () => {
    const orphans = new Set<string>();
    for (const { file, tag } of tags) {
      const names = (/className="([^"]+)"/.exec(tag)?.[1] ?? "")
        .split(/\s+/)
        .filter((name) => name && !name.includes("$"));
      if (!names.length) continue;
      // The TAG is the unit, not the class: a modifier carrying only
      // `text-anchor` is legitimate so long as it arrives beside a base that
      // carries the rung. One sized class on the element is enough.
      if (names.some(sized)) continue;
      orphans.add(`${names.join(" ")}  (${file})`);
    }
    assert.deepEqual(
      [...orphans].sort(),
      [],
      "these plot labels reach no declared font-size, so they inherit the document's 16px on a "
        + `13px ladder:\n  ${[...orphans].sort().join("\n  ")}`,
    );
  });

  it("and none of them carries a size on the element", () => {
    const literals = tags
      .filter(({ tag }) => /fontSize=/.test(tag))
      .map(({ file, tag }) => `${/className="([^"]+)"/.exec(tag)?.[1] ?? "(no class)"}  (${file})`);
    assert.deepEqual(
      [...new Set(literals)].sort(),
      [],
      "a `fontSize` on the element is a literal the type ladder cannot see and "
        + `type-diagram-ladder cannot check:\n  ${[...new Set(literals)].sort().join("\n  ")}`,
    );
  });
});
