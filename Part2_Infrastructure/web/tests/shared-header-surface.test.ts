import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const topbar = read("app/globals/14w-engine-topbar.css");
const density = read("app/globals/14zzh-interface-density.css");
const markets = read("app/globals/14zza-markets-quant-workbench.css");
const diffusion = read("components/DiffusionConsole.tsx");

describe("shared analytical header and plot surfaces", () => {
  it("frames Diffusion's direct PageHead with the same authored surface as the engine top bar", () => {
    assert.match(diffusion, /className="coherence-plane diffusion-plane"[\s\S]*?<PageHead/);
    assert.match(topbar, /\.coherence-plane > \.page-heading\s*\{[^}]*padding:\s*var\(--space-3\) var\(--space-4\);[^}]*border:\s*1px solid var\(--border\);[^}]*background:\s*var\(--surface-1\);/s);
  });

  it("keeps workbench plots on a clean surface rather than a full graph-paper field", () => {
    const plotRule = density.match(/:is\([\s\S]*?\.markets-plane,[\s\S]*?\.proofs-plane,[\s\S]*?\.diffusion-plane[\s\S]*?\) \.coh-figure__plot \{([\s\S]*?)\}/);
    assert.ok(plotRule, "missing shared workbench plot surface");
    assert.match(plotRule[1], /background-color:\s*var\(--surface-1\);/);
    assert.match(plotRule[1], /background-image:\s*none;/);
    assert.doesNotMatch(plotRule[1], /linear-gradient|background-size/);
    const marketsOverride = markets.match(/\.markets-plane \[data-market-section\] \.coh-plot > svg \{([\s\S]*?)\}/);
    assert.ok(marketsOverride, "missing Markets plot surface override");
    assert.match(marketsOverride[1], /background:\s*var\(--surface-1\);/);
    assert.doesNotMatch(marketsOverride[1], /linear-gradient|background-size/);
  });
});
