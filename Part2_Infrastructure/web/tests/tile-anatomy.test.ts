/**
 * One file owns the stat tile's markup.
 *
 * `MonteCarloDistribution` and `OracleVarPanel` each hand-typed StatTile's
 * exact output — the label div, the `num stat-tile__value` with its data-tone,
 * the note div — seven tiles between them, while sibling panels in the same
 * directories imported the component. Nothing was visibly wrong, so nothing
 * flagged it: the copies rendered identically right up until someone changed
 * the component and only two thirds of the desk moved.
 *
 * This is the same ratchet shape `portfolio-section-panes-cross-link.test.ts`
 * uses for CrossLinkTile: an allow-list of remaining hand-rolled copies that
 * may shrink and must not grow.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { globalsCss } from "./globals-css";

const root = join(import.meta.dirname, "..");
const tooltipSource = readFileSync(join(root, "components/common/QuantEducationalTooltip.tsx"), "utf8");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

/** Comments stripped: the prose in these files names the classes it describes. */
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("the stat tile has one implementation", () => {
  it("only StatTile.tsx declares the tile's anatomy", () => {
    const claimants: string[] = [];
    for (const file of [...sourceFiles(join(root, "components")), ...sourceFiles(join(root, "app"))]) {
      const code = strip(readFileSync(file, "utf8"));
      if (!/stat-tile__(label|value|note)/.test(code)) continue;
      claimants.push(file.slice(root.length + 1));
    }
    assert.deepEqual(
      claimants.sort(),
      ["components/StatTile.tsx"],
      "a surface is reimplementing StatTile by hand. Import it — it takes label, value, " +
        "note, tone and an optional `explain`, which is everything the copies were spelling out.",
    );
  });

  it("StatTile is imported where the copies used to be", () => {
    for (const path of ["components/risk/MonteCarloDistribution.tsx", "components/portfolio/OracleVarPanel.tsx"]) {
      const code = readFileSync(join(root, path), "utf8");
      assert.match(
        code,
        /import StatTile from "@\/components\/StatTile"/,
        `${path} held hand-rolled tiles; it must reach them through the component now`,
      );
    }
  });

  it("reserves one label row whether or not the tile has an info control", () => {
    const css = globalsCss.replace(/\/\*[\s\S]*?\*\//g, "");
    assert.match(
      css,
      /\.stat-tile__label\s*\{[^}]*min-block-size:\s*var\(--control-h\);/s,
      "tooltip-bearing labels must not push their values below plain-label tiles",
    );
  });

  it("lets a click pin the info panel and dismisses it outside or with Escape", () => {
    assert.match(tooltipSource, /const \[pinned, setPinned\] = useState\(false\);/);
    assert.match(tooltipSource, /onClick=\{\(\) => \{[\s\S]*?const nextPinned = !pinned;[\s\S]*?setPinned\(nextPinned\);[\s\S]*?setOpen\(nextPinned\);/);
    assert.match(tooltipSource, /document\.addEventListener\("pointerdown", onPointerDown, true\);/);
    assert.match(tooltipSource, /event\.key === "Escape"\) close\(\)/);
  });

  it("clamps the explainer into short as well as narrow viewports", () => {
    assert.match(tooltipSource, /window\.innerHeight - height - margin/);
    assert.match(globalsCss, /\.quant-tooltip\s*\{[^}]*max-height:\s*calc\(100svh - 16px\);[^}]*overflow-y:\s*auto;/s);
  });
});
