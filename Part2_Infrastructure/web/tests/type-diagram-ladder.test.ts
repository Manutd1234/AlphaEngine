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
 *   10    axis ticks and bar labels. Equals --fs-tick, which is the floor of the
 *         whole sheet and the reason `type-ladder-presets.test.ts` keeps prose
 *         at least half a pixel above it.
 *   12    a series label inside the plot.
 *   12.5  a dense series label where 12 collides with its neighbour.
 *   13    a chart's own title or legend, the loudest furniture allowed.
 *   15    one in-chart figure.
 *   25    one donut centre figure, which is a KPI that happens to be drawn in a
 *         circle rather than furniture, and is sanctioned by name in
 *         type-scale.test.ts.
 *
 * MEASURED, AND NOT FIXED HERE: --fs-body at compact is 12px, so the 24 labels
 * at 12.5 and above sit ABOVE reading text for a reader on the smallest setting,
 * which inverts chart furniture against prose. Fixing it means editing 13 chart
 * components, two of which are held by other work in flight, and it moves pixels
 * on every chart on the desk. So it is RATCHETED instead: the count may fall and
 * may not rise, which stops the inversion widening while leaving the repair to a
 * pass that can do all 13 files at once.
 */
const SVG_LADDER = new Set([10, 12, 12.5, 13, 15, 25]);

/** Inline sizes above --fs-body at the compact preset, per value. May shrink. */
const ABOVE_COMPACT_PROSE: Record<string, number> = { "12.5": 16, "13": 6, "15": 1, "25": 1 };

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
