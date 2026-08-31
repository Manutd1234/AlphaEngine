/**
 * Windows High Contrast removes the washes this interface normally uses for
 * grouping. Pin the structural fallback, and keep authored colour exceptions
 * limited to the two plots where hue is the measured value.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { globalsCss } from "./globals-css";

const css = globalsCss;
const declarations = css.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
  comment.replace(/[^\n]/g, " "));

function blockBody(index: number): string {
  const open = declarations.indexOf("{", index);
  let depth = 0;
  for (let cursor = open; cursor < declarations.length; cursor += 1) {
    if (declarations[cursor] === "{") depth += 1;
    if (declarations[cursor] === "}") {
      depth -= 1;
      if (depth === 0) return declarations.slice(open, cursor + 1);
    }
  }
  assert.fail("unclosed forced-colors block");
}

describe("the forced-colors contract", () => {
  const queries = [...declarations.matchAll(/@media \(forced-colors: active\)/g)];

  it("has one authoritative media block", () => {
    assert.equal(queries.length, 1);
  });

  it("replaces meaning-bearing washes with system-colour borders", () => {
    const block = blockBody(queries[0].index);
    for (const selector of [
      ".verdict-pill",
      ".codex-chip",
      ".market-watchlist__price[data-tick]",
      ".ladder-row > span[aria-hidden]",
      ".pill",
      ".page-status",
      ".promotion-list > li",
    ]) {
      assert.ok(block.includes(selector), `${selector} has no forced-colors fallback`);
    }
    assert.match(block, /border:\s*1px solid CanvasText/);
    assert.match(block, /border-color:\s*CanvasText/);
  });

  it("uses currentColor for ordinary chart strokes", () => {
    const block = blockBody(queries[0].index);
    assert.match(block, /svg path\[stroke\][\s\S]*stroke:\s*currentColor/);
    assert.match(block, /svg line\[stroke\][\s\S]*stroke:\s*currentColor/);
  });

  it("preserves authored colour only on the heatmap and ladder depth field", () => {
    const rules = [...declarations.matchAll(/([^{}]+)\{([^{}]*forced-color-adjust:\s*none[^{}]*)\}/g)];
    assert.equal(rules.length, 1, "forced-color-adjust: none must live in one allow-list rule");
    const selectors = rules[0][1]
      .split(",")
      .map((selector) => selector.trim())
      .sort();
    assert.deepEqual(selectors, [".heatmap-cell", ".ladder-row > span[aria-hidden]"]);
  });

  it("keeps the named older-history gap visible after decorative fills are removed", () => {
    const block = blockBody(queries[0].index);
    assert.match(block, /\.diff-fan__unmeasured-ground\s*\{\s*fill:\s*Canvas;/);
    assert.match(block, /\.diff-fan__unmeasured\s*\{[^}]*fill:\s*none;[^}]*stroke:\s*CanvasText;[^}]*stroke-dasharray:\s*4 3;/s);
    assert.match(block, /\.diff-fan__history-label, \.diff-fan__history-range\s*\{\s*fill:\s*CanvasText;/);
  });
});

/**
 * The heatmap's five neighbourhood kinds are the exact case the no-colour-only
 * rule exists for: plateau, slope, cliff, dead and isolated are distinguished
 * in the cells by fill, and in the legend by a glyph beside each fill. The
 * component says so itself — "these five are exactly the sort of set colour
 * alone cannot carry" — and nothing enforced it. Delete the glyphs and the
 * suite stayed green with colour-only meaning shipping, on the one surface
 * whose own comment predicted it.
 */
describe("the heatmap's kind legend never relies on colour alone", () => {
  const heatmap = readFileSync(
    fileURLToPath(new URL("../components/Heatmap.tsx", import.meta.url)),
    "utf8",
  );

  const kinds = [...heatmap.matchAll(
    /^\s{2}(plateau|slope|cliff|dead|isolated):\s*\{[^}]*?glyph:\s*"([^"]*)"/gm,
  )].map(([, kind, glyph]) => ({ kind, glyph }));

  it("defines all five kinds with a glyph each", () => {
    assert.equal(kinds.length, 5, "KIND_STYLE stopped matching, or lost a kind");
    for (const { kind, glyph } of kinds) {
      assert.notEqual(glyph, "", `${kind} carries a fill but no mark`);
    }
  });

  it("gives each kind a distinct mark, not just a distinct colour", () => {
    const marks = new Set(kinds.map((k) => k.glyph));
    assert.equal(marks.size, 5,
      "two kinds share a glyph, so telling them apart is back to being colour's job");

    assert.match(heatmap, /showKinds \? "var\(--border\)" : "none"/,
      "categorical cells need a boundary as well as a glyph when adjacent fills converge");
  });

  it("renders the glyph beside the label", () => {
    assert.match(heatmap, /<span aria-hidden>\{KIND_STYLE\[kind\]\.glyph\}/,
      "the legend stopped drawing the mark it defines");
  });
});
