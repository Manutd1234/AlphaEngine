/**
 * Windows High Contrast removes the washes this interface normally uses for
 * grouping. Pin the structural fallback, and keep authored colour exceptions
 * limited to the two plots where hue is the measured value.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const css = readFileSync(
  fileURLToPath(new URL("../app/globals.css", import.meta.url)),
  "utf8",
);
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
});
