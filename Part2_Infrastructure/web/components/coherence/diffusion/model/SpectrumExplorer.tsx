"use client";

/**
 * The information spectrum, drawn in closed form and integrating to its own total.
 *
 * This is the instrument the diffusion study is built on, and it is the one part
 * of the model a reader is least likely to have met. `i(x;c)` is usually
 * presented as a NUMBER — how much one text tells you about another — and the
 * project's claim is that the number is the less interesting half. The integrand
 * is a density over RESOLUTION: mass at low α means the conditioning explains
 * structure that survives heavy noise, the coarse headline-shaped part; mass at
 * high α means it explains detail that appears only once the noise is nearly
 * gone. The centroid says at what resolution one text explains another, which is
 * a different question from how much.
 *
 * WHY IT CAN BE DRAWN HERE AT ALL, with no network and no torch: for jointly
 * Gaussian (x, c) the spectrum has an exact closed form and its integral is
 * exactly the mutual information. `gaussian.py` calls that identity "a real
 * feature" rather than a convenience — the spectrum's centroid can be computed
 * for every event before any model is trained, which is why the instrument ships
 * before the model does.
 *
 * THE IDENTITY IS COMPUTED, NOT PRINTED. The figure shows ∫g dα by quadrature
 * beside ½Σ(log λ − log μ) in closed form, and the two agree to the pixel because
 * they are the same quantity. Printing a literal would ASSERT the identity; this
 * demonstrates it, and demonstrating it is the reason the view exists.
 *
 * THE WHITENING WARNING IS THE FOOTNOTE, and it is the sharpest thing in the
 * reference module: whitening the latent sends every log λᵢ to zero, which
 * collapses the spectrum to a single bump at α = 0 and destroys the resolution
 * axis the whole instrument reads. It is the natural thing to reach for and it
 * deletes the measurement. Drag the three unconditional eigenvalues together and
 * the drawing does exactly that, which is a faster way to understand the warning
 * than reading it.
 *
 * Arithmetic from `lib/coherence/diffusion-model`, the twin held to
 * `gaussian.py` by the parity fixture.
 */

import { useMemo, useState } from "react";

import { gaussianInformation, gaussianSpectrum } from "@/lib/coherence/diffusion-model";
import Figure from "../../Figure";
import { StateChip } from "../../Figure";
import { useMeasuredWidth } from "@/components/chart-kit";

const HEIGHT = 200;
const MARGIN = { top: 16, right: 12, bottom: 26, left: 40 };
/** Wide enough that the tails contribute nothing at these eigenvalues. */
const ALPHA_LOW = -12;
const ALPHA_HIGH = 12;
const STEPS = 480;

const ALPHAS = Array.from({ length: STEPS + 1 }, (_, index) => ALPHA_LOW + (index * (ALPHA_HIGH - ALPHA_LOW)) / STEPS);
const STEP = (ALPHA_HIGH - ALPHA_LOW) / STEPS;

export default function SpectrumExplorer() {
  const [logLambda, setLogLambda] = useState([1.6, 0.4, -0.9]);
  const [logMu, setLogMu] = useState([0.7, -0.1, -1.2]);
  const [plotRef, plotW] = useMeasuredWidth<HTMLDivElement>(720);

  const { density, integral, exact, centroid } = useMemo(() => {
    const values = gaussianSpectrum(ALPHAS, logLambda, logMu);
    const total = values.reduce((sum, value) => sum + value * STEP, 0);
    const weighted = values.reduce((sum, value, index) => sum + value * ALPHAS[index] * STEP, 0);
    return {
      density: values,
      integral: total,
      exact: gaussianInformation(logLambda, logMu),
      centroid: Math.abs(total) > 1e-9 ? weighted / total : null,
    };
  }, [logLambda, logMu]);

  const setAt = (which: "lambda" | "mu", index: number, value: number) => {
    const update = (current: number[]) => current.map((entry, i) => (i === index ? value : entry));
    if (which === "lambda") setLogLambda(update);
    else setLogMu(update);
  };

  const plotWidth = Math.max(1, plotW - MARGIN.left - MARGIN.right);
  const base = HEIGHT - MARGIN.bottom;
  const peak = Math.max(...density, 1e-6);
  const x = (alpha: number) => MARGIN.left + ((alpha - ALPHA_LOW) / (ALPHA_HIGH - ALPHA_LOW)) * plotWidth;
  const y = (value: number) => base - (value / peak) * (base - MARGIN.top);
  const path = density.map((value, index) => `${index ? "L" : "M"}${x(ALPHAS[index]).toFixed(2)},${y(value).toFixed(2)}`).join("");
  const area = `${path}L${x(ALPHA_HIGH).toFixed(2)},${base}L${x(ALPHA_LOW).toFixed(2)},${base}Z`;

  const flat = Math.abs(exact) < 1e-9;

  return (
    <div className="diff-pane">
      <p className="coh-event__note">
        The unconditional eigenvalues describe the data; the conditional ones what is left once the
        conditioning is known. The gap between them at each resolution IS the information.
      </p>

      <div className="coh-model__controls">
        {logLambda.map((value, index) => (
          <label key={`lambda-${index}`}>
            <span className="field">log λ{index + 1} — unconditional — {value.toFixed(2)}</span>
            <input type="range" min={-3} max={3} step={0.05} value={value}
                   onChange={(event) => setAt("lambda", index, Number(event.target.value))} />
          </label>
        ))}
        {logMu.map((value, index) => (
          <label key={`mu-${index}`}>
            <span className="field">log μ{index + 1} — conditional — {value.toFixed(2)}</span>
            <input type="range" min={-3} max={3} step={0.05} value={value}
                   onChange={(event) => setAt("mu", index, Number(event.target.value))} />
          </label>
        ))}
      </div>

      <div className="coh-status__chips">
        <StateChip mark="∫" word="Spectrum area, by quadrature" value={`${integral.toFixed(6)} nats`} tone="muted" />
        <StateChip mark="=" word="½Σ(log λ − log μ), closed form" value={`${exact.toFixed(6)} nats`} tone="good" />
        <StateChip
          mark={centroid == null ? "◌" : "◇"}
          word="Centroid, on the resolution axis"
          value={centroid == null ? "no information to locate" : centroid.toFixed(3)}
          tone={centroid == null ? "warn" : "muted"}
        />
      </div>

      <Figure
        caption="g(α), the information density over log signal-to-noise"
        ariaLabel={`Information spectrum over log-SNR, integrating to ${exact.toFixed(4)} nats`}
        reading={
          flat
            ? "The conditional eigenvalues match the unconditional ones exactly, so the conditioning explains nothing and the density is flat zero at every resolution — the honest reading of no information, rather than a small positive number."
            : centroid != null && centroid < 0
              ? `Mass sits at LOW α (centroid ${centroid.toFixed(2)}): the conditioning explains structure that survives heavy noise — the coarse, headline-shaped part.`
              : `Mass sits at HIGH α (centroid ${centroid?.toFixed(2)}): the conditioning explains detail that only appears once the noise is nearly gone.`
        }
        missing="Whitening the latent would send every log λ to zero, collapse this curve to one bump at α = 0 and destroy the resolution axis the instrument reads. Drag the three unconditional sliders together to see it happen — it is the natural thing to reach for and it deletes the measurement."
      >
        <div ref={plotRef} style={{ width: "100%" }}>
          <svg viewBox={`0 0 ${plotW} ${HEIGHT}`} width={plotW} height={HEIGHT}>
            <line x1={MARGIN.left} x2={plotW - MARGIN.right} y1={base} y2={base} className="coh-ladder__axis" />
            <path d={area} className="coh-model__area">
              <title>{`Area ${integral.toFixed(6)} nats, which is I(x;c)`}</title>
            </path>
            <path d={path} fill="none" className="coh-index__line">
              <title>{`g(α) over ${ALPHA_LOW} to ${ALPHA_HIGH} log-SNR`}</title>
            </path>
            {centroid != null ? (
              <line x1={x(centroid)} x2={x(centroid)} y1={MARGIN.top} y2={base} className="coh-survival__median">
                <title>{`Centroid at α = ${centroid.toFixed(3)}`}</title>
              </line>
            ) : null}
            <text x={MARGIN.left} y={HEIGHT - 8} className="coh-ladder__tick">α = {ALPHA_LOW}</text>
            <text x={plotW - MARGIN.right} y={HEIGHT - 8} textAnchor="end" className="coh-ladder__tick">
              α = {ALPHA_HIGH}
            </text>
            <text x={MARGIN.left} y={MARGIN.top - 4} className="coh-svg-note">coarse ← resolution → fine</text>
          </svg>
        </div>
      </Figure>
    </div>
  );
}
