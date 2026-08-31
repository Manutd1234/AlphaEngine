/** Contracts for the restored 6b7c31c Spectrum instrument. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { gaussianInformation, gaussianSpectrum } from "../lib/coherence/diffusion-model";
import {
  spectrumYDomain,
  spectrumYPosition,
} from "../components/coherence/diffusion/model/spectrum-layout";
import { read, stripNonCode } from "./helpers/workspace-sources";

const source = read("../components/coherence/diffusion/model/SpectrumExplorer.tsx");
const css = readFileSync(join(import.meta.dirname, "../app/globals/10c-diffusion-figures.css"), "utf8");
const modalCss = readFileSync(join(import.meta.dirname, "../app/globals/14z-engine-evidence.css"), "utf8");

describe("the original Spectrum workbench", () => {
  it("keeps the six direct eigenvalue controls and computed identity", () => {
    assert.match(source, /logLambda\.map/);
    assert.match(source, /logMu\.map/);
    assert.match(source, /log λ\{index \+ 1\} — unconditional/);
    assert.match(source, /log μ\{index \+ 1\} — conditional/);
    assert.match(source, /Spectrum area, by quadrature/);
    assert.match(source, /½Σ\(log λ − log μ\), closed form/);
    assert.doesNotMatch(source, /SPECTRUM_MODES|data-spectrum-pair|data-spectrum-centroid-clamped/);
  });

  it("draws the spectrum area, outline and resolution centroid in the shared Figure", () => {
    const code = stripNonCode(source);
    assert.match(code, /<Figure\b/);
    assert.match(code, /<Plot height=\{HEIGHT\}>/);
    assert.match(source, /className="coh-model__area"/);
    assert.match(source, /className="coh-index__line"/);
    assert.match(source, /className="coh-survival__median"/);
    assert.match(source, /coarse ← resolution → fine/);
    assert.match(source, /spectrumYDomain\(density\)/);
    assert.match(source, /spectrumYPosition\(value, domain, MARGIN\.top, plotBottom\)/);
    assert.match(source, /y1=\{baseline\} y2=\{baseline\}/);
    assert.doesNotMatch(source, /const peak = Math\.max/,
      "a positive-only peak scale clips a signed spectrum below the plot");
    assert.doesNotMatch(css, /coh-spectrum__/,
      "replacement-only Spectrum chrome remains after the original workbench was restored");
  });

  it("contains positive and negative lobes on opposite sides of a visible zero axis", () => {
    const values = [0.18, 0.04, 0, -0.32, -0.07];
    const top = 22;
    const bottom = 180;
    const domain = spectrumYDomain(values);
    const baseline = spectrumYPosition(0, domain, top, bottom);
    const positions = values.map((value) => spectrumYPosition(value, domain, top, bottom));

    assert.ok(positions.every((position) => position > top && position < bottom),
      "domain padding did not keep the complete curve inside the plot");
    assert.ok(spectrumYPosition(Math.max(...values), domain, top, bottom) < baseline);
    assert.ok(spectrumYPosition(Math.min(...values), domain, top, bottom) > baseline);
  });

  it("gives positive-only, negative-only and flat spectra finite contained axes", () => {
    for (const values of [[0, 0.4], [-0.4, 0], [0, 0]] as const) {
      const domain = spectrumYDomain(values);
      const positions = values.map((value) => spectrumYPosition(value, domain, 22, 180));
      assert.ok(domain.min < 0 && domain.max > 0);
      assert.ok(positions.every((position) => Number.isFinite(position) && position >= 22 && position <= 180));
    }
  });

  it("keeps the quadrature and closed form numerically paired", () => {
    const low = -12;
    const high = 12;
    const steps = 480;
    const alphas = Array.from({ length: steps + 1 }, (_, index) => low + index * (high - low) / steps);
    const lambda = [1.6, 0.4, -0.9];
    const mu = [0.7, -0.1, -1.2];
    const step = (high - low) / steps;
    const integral = gaussianSpectrum(alphas, lambda, mu).reduce((sum, value) => sum + value * step, 0);
    assert.ok(Math.abs(integral - gaussianInformation(lambda, mu)) < 1e-4);
  });

  it("delegates focused inspection to the bounded shared dialog", () => {
    assert.match(modalCss, /\[data-slot="dialog-content"\]\.coh-figure-dialog[\s\S]*?max-height:\s*calc\(100dvh/);
    assert.match(modalCss, /\.coh-figure-dialog__body[\s\S]*?overflow:\s*auto/);
    assert.doesNotMatch(modalCss, /min\(70dvh|min\(62dvh/);
    assert.doesNotMatch(css, /coh-figure__backdrop|coh-figure\.is-focused/);
  });

  it("keeps the spectrum area fill when the chart is portaled into Focus", () => {
    assert.match(
      css,
      /\.coherence-plane\.diffusion-plane \.coh-model__area,\s*\.coh-figure--dialog \.coh-model__area\s*\{[^}]*fill:\s*color-mix\(/s,
      "the focused Spectrum falls out of the diffusion-only fill scope and defaults to black",
    );
    assert.match(
      css,
      /\.coh-figure--dialog \.coh-model__area ~ \.coh-svg-note\s*\{[^}]*fill:\s*var\(--text-secondary\);[^}]*font-size:\s*var\(--fs-diagram-legend, 14px\);/s,
      "the focused resolution note falls out of the coherence-plane scope and defaults to black",
    );
  });
});
