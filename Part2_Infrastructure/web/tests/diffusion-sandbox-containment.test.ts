import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { read } from "./helpers/workspace-sources";

const sandbox = read("../components/coherence/diffusion/SandboxSection.tsx");
const halfLife = read("../components/coherence/diffusion/model/HalfLifeCalculator.tsx");
const simulator = read("../components/coherence/diffusion/model/DiffusionSimulator.tsx");
const spectrum = read("../components/coherence/diffusion/model/SpectrumExplorer.tsx");
const css = read("../app/globals/14zzc-diffusion-workbench.css");

describe("Diffusion Sandbox containment", () => {
  it("gives all three driven views one explicit bounded owner", () => {
    assert.match(sandbox, /coh-diffusion--sandbox/);
    for (const name of ["HalfLifeCalculator", "DiffusionSimulator", "SpectrumExplorer"]) {
      assert.ok(sandbox.includes(name), `${name} left the bounded Sandbox owner`);
    }
    assert.match(css, /\.coh-diffusion--sandbox \{\s*overflow: hidden;/);
    assert.match(css, /\.coh-diffusion--sandbox \.diff-pane \{[\s\S]*min-block-size:/);
    assert.match(css, /\.coh-figure__plot \{[\s\S]*contain: inline-size paint;/);
  });

  it("fits the half-life y domain to every legal slider extreme", () => {
    assert.match(halfLife, /min=\{-0\.2\}/);
    assert.match(halfLife, /max=\{1\.4\}/);
    assert.match(halfLife, /const low = Math\.min\(\.\.\.absorbed, 0\)/);
    assert.match(halfLife, /const high = Math\.max\(\.\.\.absorbed, 1\)/);
    assert.match(halfLife, /\(value - low\) \/ \(high - low\)/);
  });

  it("keeps every simulator and spectrum slider inside its local control track", () => {
    assert.equal((simulator.match(/type="range"/g) ?? []).length, 5);
    assert.equal((spectrum.match(/type="range"/g) ?? []).length, 2);
    assert.match(css, /input\[type="range"\][\s\S]*inline-size: 100%/);
    assert.match(css, /\.coh-plot > svg \{[\s\S]*max-inline-size: 100%/);
  });
});
