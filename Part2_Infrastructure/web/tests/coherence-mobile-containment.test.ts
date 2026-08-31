import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const css = readFileSync(join(import.meta.dirname, "../app/globals/10a-coherence-plane.css"), "utf8");
const topbar = readFileSync(join(import.meta.dirname, "../app/globals/14w-engine-topbar.css"), "utf8");

describe("the analytical plane shrinks its direct grid items on phones", () => {
  it("lets every direct child shrink below its min-content width", () => {
    const rule = css.match(/\.coherence-plane\s*>\s*\*\s*\{([\s\S]*?)\}/);
    assert.ok(rule, "the shared Markets, Proofs and Diffusion grid has no direct-child containment rule");
    assert.match(rule[1], /min-width:\s*0/);
  });

  it("does not conceal a wider implicit track with clipping", () => {
    const base = css.match(/\.coherence-plane\s*\{([\s\S]*?)\}/);
    assert.ok(base);
    assert.doesNotMatch(base[1], /overflow(?:-x)?:\s*hidden/);
  });

  it("contains both shared top-bar rows and their poll controls on phones", () => {
    const mobile = topbar.match(/@media \(max-width: 620px\)\s*\{([\s\S]*?)\n\}/);
    assert.ok(mobile);
    assert.match(mobile[1], /\.coherence-plane \.engine-topbar-status__row,[\s\S]*?\.coherence-plane \.engine-topbar-status \.coh-live--markets\s*\{[\s\S]*?max-inline-size:\s*100%/,
      "a shared status row can still widen the top-bar card");
    assert.match(topbar, /\.coherence-plane \.engine-topbar-status\s*\{[^}]*min-inline-size:\s*0;/s);
    assert.match(topbar, /\.coherence-plane \.engine-topbar-status__row\s*\{[^}]*min-inline-size:\s*0;[^}]*flex-wrap:\s*wrap;/s);
    assert.match(topbar, /\.coherence-plane \.coh-live\s*\{[^}]*flex-wrap:\s*wrap;[^}]*min-inline-size:\s*0;/s);
  });
});
