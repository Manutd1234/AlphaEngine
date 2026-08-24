/**
 * THE DIAGRAM LADDER — split out of `type-role-map.test.ts` on 2026-08-23.
 *
 * It moved rather than shrank. The role map reached exactly 400 lines, which is
 * the house ceiling `file-size.test.ts` enforces, and the standardisation pass
 * that measured the desk's third navigation level needed to ADD two roles to
 * it. Shaving the reasons to buy the lines would have deleted the one part of
 * that file that stops the next pass re-tuning what this one tuned, so the
 * file was split at the banner it already carried.
 *
 * The seam is the honest one: everything above it is PROSE type, which steps
 * with the reader's Text-size preference; everything here is SVG type, which
 * does not. The two ladders were never one ladder — the banner below has said
 * so since it was written — and now they are not one file either.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { globalsCss } from "./globals-css";

const root = fileURLToPath(new URL("..", import.meta.url));

/** Comment bodies blanked, newlines kept, so prose is never read as a rule. */
const declarations = globalsCss.replace(/\/\*[\s\S]*?\*\//g, (block) =>
  block.replace(/[^\n]/g, " "));

/** The first `:root` block: the ladder itself. */
const rootBlock = declarations.slice(
  declarations.indexOf(":root {"),
  declarations.indexOf("\n}\n", declarations.indexOf(":root {")),
);

/**
 * A rung in px at step 1: the plain rem literal, or a clamp's MINIMUM.
 *
 * Eight lines duplicated from `type-role-map.test.ts` rather than exported from
 * it. The alternative — importing one `.test.ts` from another — makes this
 * suite run that suite's assertions a second time under a different file name,
 * so a single broken anchor would be reported twice and `--test-name-pattern`
 * would no longer address one of them. A shared `tests/globals-rules.ts` helper
 * is where this belongs the next time either file is opened for other reasons.
 */
function minPx(token: string): number {
  const fixed = rootBlock.match(new RegExp(`${token}:\\s*(\\d+)px;`));
  if (fixed) return Number(fixed[1]);
  const match = rootBlock.match(new RegExp(`${token}:\\s*calc\\((?:clamp\\()?([\\d.]+)rem`));
  assert.ok(match, `${token} is not in :root`);
  return Number(match![1]) * 16;
}

/**
 * THE DIAGRAM LADDER, and how it relates to the prose one.
 *
 * SVG text is drawn in USER UNITS. It does not inherit the reader's Text-size
 * preference and it does not scale with the ladder, so a chart label written as
 * `fontSize={13}` is 13px at every preset while the prose beside it is 13px at
 * comfortable, 11.14px at compact and 15.79px at large. A shared number is not
 * a shared rung, and folding chart text into the prose ladder would state a
 * relationship that only holds at one setting.
 *
 * Four rungs, smallest first, and the relation is stated at the COMPACT preset
 * because that is where prose is smallest and the inversion is worst:
 *
 *   10    true axis NUMERALS. Equals --fs-tick, which is the floor of the whole
 *         sheet and the reason `type-ladder-presets.test.ts` keeps prose at
 *         least half a pixel above it.
 *   12    words inside a plot that are not a series label: an edge caption, a
 *         direction word, a missing-value mark, a secondary sub-label.
 *   13    a series or row label inside the plot, and the roomier charts' own
 *         axis numerals.
 *   14    a chart's own title, legend or in-plot note — the loudest furniture
 *         allowed.
 *   15    one in-chart figure.
 *   25    one donut centre figure, which is a KPI that happens to be drawn in a
 *         circle rather than furniture, and is sanctioned by name in
 *         type-scale.test.ts.
 *
 * THE LADDER MOVED ON 2026-08-24, and the arithmetic is the whole argument. A
 * reader said three times that the words inside these figures were too small;
 * three passes had lifted PROSE, which is not what he was reading. So 12 → 13,
 * 12.5 → 13 and 13 → 14, and the words that had been drawn at the NUMERAL rung
 * came up to the 12 the labels vacated — a rung is re-tenanted rather than
 * added, so the ladder keeps its shape and loses its half-pixel step.
 *
 * WHAT CAPS IT. Reading prose on this desk is `body { font-size: var(--fs-title) }`
 * — 1.0625rem × 16 × --type-step, so 14.571 / 17.000 / 20.643px at compact /
 * comfortable / large. Compact binds, because that is where prose is smallest
 * and SVG text does not shrink with it. The sheet already owns a separation
 * constant for exactly this relation, at the other end of the ladder:
 * `type-ladder-presets.test.ts` requires --fs-2xs at compact to sit ≥ 0.5px
 * above --fs-tick. Applied at the top, 14.571 − 0.5 = 14.071px, so 14 is the
 * loudest rung the ladder may hold. REJECTED: 14.5, which clears compact prose
 * by 0.071px and therefore claims a separation no reader can see; and 15 for
 * legends, which is 0.43px ABOVE compact reading prose and would deepen the
 * inversion the ledger below exists to shrink. REJECTED at the floor: 11 for
 * the numerals — --fs-2xs at compact is 10.714px, the same 0.5px separation
 * caps --fs-tick at 10.214, and the guard requires a whole number, so 10 is
 * the only value left and the ladder's floor cannot move at all.
 *
 * MEASURED, AND NOT FIXED HERE: --fs-body at compact is 12px — the CAPTION
 * rung, one under the reading rung, and the stricter of the two references, so
 * it is kept as the ledger's yardstick rather than re-pointed at --fs-title.
 * 34 labels now sit above it, up from 24, because 26 sites landed on 13 where
 * 16 were at 12.5. That is the inversion widening against captions in order to
 * close it against READING prose, which is the comparison the reader was
 * making, and it is recorded here rather than argued away. The ratchet still
 * bites: each count is an exact cap that may fall and may not rise.
 */
const SVG_LADDER = new Set([10, 12, 13, 14, 15, 25]);

/** Inline sizes above --fs-body at the compact preset, per value. May shrink. */
const ABOVE_COMPACT_PROSE: Record<string, number> = { "13": 26, "14": 6, "15": 1, "25": 1 };

function componentFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...componentFiles(full));
    else if (/\.tsx$/.test(full)) out.push(full);
  }
  return out;
}

const inlineSizes = (() => {
  const counts = new Map<number, number>();
  for (const file of [...componentFiles(join(root, "components")), ...componentFiles(join(root, "app"))]) {
    for (const [, size] of readFileSync(file, "utf8").matchAll(/fontSize=\{([\d.]+)\}/g)) {
      counts.set(Number(size), (counts.get(Number(size)) ?? 0) + 1);
    }
  }
  return counts;
})();

describe("diagram text has its own ladder", () => {
  it("every inline SVG size is on it, and its floor is the tick", () => {
    const offenders = [...inlineSizes.keys()].filter((size) => !SVG_LADDER.has(size));
    assert.deepEqual(offenders, [], `off the diagram ladder: ${offenders.join(", ")}`);
    assert.equal(Math.min(...SVG_LADDER), minPx("--fs-tick"), "the ladder's floor is --fs-tick");
  });

  it("chart furniture does not get louder against prose than it already is", () => {
    // The ratchet, in the shape `dead-css.test.ts` and `file-size.test.ts`
    // already use here: a count that may fall and may not rise. Compact is
    // --fs-body times 6/7 = 12px, and every size above that out-shouts the
    // sentence beside it for a reader on the smallest setting.
    const compactProse = minPx("--fs-body") * (6 / 7);
    for (const [size, count] of inlineSizes) {
      if (size <= compactProse) continue;
      const ledger = ABOVE_COMPACT_PROSE[String(size)];
      assert.ok(
        ledger !== undefined,
        `fontSize={${size}} is a NEW inline size above the ${compactProse}px compact prose rung`,
      );
      assert.ok(
        count <= ledger,
        `fontSize={${size}} is used ${count} times, up from ${ledger} — the inversion may shrink, not grow`,
      );
    }
  });
});
