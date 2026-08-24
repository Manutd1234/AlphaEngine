"use client";

/**
 * Set the absorbed curve on the real grid, and read back what the estimator says.
 *
 * The half-life is the number this whole arm reports, and it is not a
 * measurement of a moment — it is an INTERPOLATION between the two horizons that
 * bracket a crossing, on a grid that is roughly geometric. Two properties follow
 * that a reader cannot get from a printed figure, and can get from a slider in
 * about ten seconds:
 *
 *  1. THE GRID IS COARSE WHERE THE CURVE IS FLAT. Drag the 15-minute point just
 *     under a half and the crossing jumps to somewhere between 15m and 30m —
 *     a cell that spans a doubling. That is why the interpolation is in LOG x;
 *     a linear reading would place it at 22m 30s, which is the arithmetic
 *     midpoint of a doubling and belongs to nothing.
 *  2. THREE OF THE FOUR OUTCOMES ARE REFUSALS. Push the first horizon past a
 *     half and it says `at_or_before_first` rather than "60 seconds": the
 *     crossing is not resolved by this grid, and reporting the first horizon
 *     would report the sampler's resolution as a finding. Pull the curve down
 *     and it says `never_reached` rather than the window length.
 *
 * The arithmetic is `lib/coherence/diffusion-model`, which is the browser twin
 * of `modules/coherence/diffusion/decay.py` and is held to it by
 * `diffusion-model-parity.test.ts`. Nothing is re-derived here — a third
 * implementation would be a third answer.
 *
 * The curve is drawn on a LOG x axis, because that is the axis the crossing is
 * computed on and a reader comparing the drawing to the number should be looking
 * at the same geometry the estimator used.
 */

import { useState } from "react";

import { halfLife } from "@/lib/coherence/diffusion-model";
import Figure from "../../Figure";
import { useMeasuredWidth } from "@/components/chart-kit";

/** The v2 horizon grid, in seconds: 1m, 2m, 5m, 10m, 15m, 30m. */
const GRID = [60, 120, 300, 600, 900, 1800] as const;
const GRID_LABELS = ["1m", "2m", "5m", "10m", "15m", "30m"] as const;

/** A curve that crosses a half between the third and fourth horizon. */
const OPENING = [0.1, 0.3, 0.55, 0.7, 0.85, 1];

const HEIGHT = 190;
const MARGIN = { top: 14, right: 12, bottom: 26, left: 34 };

function seconds(value: number): string {
  return value >= 120 ? `${(value / 60).toFixed(1)} min` : `${value.toFixed(1)}s`;
}

/** The reading for each state, in the words the reference uses. */
function verdict(state: string, value: number | null): { mark: string; text: string } {
  if (state === "ok" && value != null) {
    return { mark: "✓", text: `Half the move had arrived by ${seconds(value)}.` };
  }
  if (state === "at_or_before_first") {
    return {
      mark: "▲",
      text: "The first measured horizon was already past a half, so the crossing is not resolved by this "
        + "grid. Reporting 60s here would report the sampler's resolution as a measurement.",
    };
  }
  if (state === "never_reached") {
    return {
      mark: "◌",
      text: "The path never reached half its terminal move inside the window. That is a bound, not a "
        + "half-life, and it is not reported as one.",
    };
  }
  return { mark: "◌", text: "Fewer than two measured horizons is not a curve." };
}

export default function HalfLifeCalculator() {
  const [absorbed, setAbsorbed] = useState<number[]>(OPENING);
  const [plotRef, plotW] = useMeasuredWidth<HTMLDivElement>(720);

  const result = halfLife([...GRID], absorbed);
  const reading = verdict(result.state, result.value);

  const set = (index: number, value: number) =>
    setAbsorbed((current) => current.map((entry, i) => (i === index ? value : entry)));

  // Log x, because that is the axis the crossing is interpolated on.
  const logLow = Math.log(GRID[0]);
  const logHigh = Math.log(GRID[GRID.length - 1]);
  const plotWidth = Math.max(1, plotW - MARGIN.left - MARGIN.right);
  const base = HEIGHT - MARGIN.bottom;
  const top = Math.max(...absorbed, 1);
  const x = (value: number) => MARGIN.left + ((Math.log(value) - logLow) / (logHigh - logLow)) * plotWidth;
  const y = (value: number) => base - (value / top) * (base - MARGIN.top);

  const path = GRID.map((horizon, index) => `${index ? "L" : "M"}${x(horizon).toFixed(2)},${y(absorbed[index]).toFixed(2)}`).join("");

  return (
    <div className="diff-pane">
      <p className="coh-event__note">
        The absorbed fraction at each horizon on the study&rsquo;s own grid. Drag a point past a half and the
        crossing moves; drag the first one past it and the estimator refuses, because a crossing this grid
        cannot resolve is not a fast absorption.
      </p>

      <div className="coh-model__controls">
        {GRID.map((horizon, index) => (
          <label key={horizon}>
            <span className="field">
              {GRID_LABELS[index]} — absorbed {absorbed[index].toFixed(2)}
            </span>
            <input
              type="range"
              min={-0.2}
              max={1.4}
              step={0.01}
              value={absorbed[index]}
              onChange={(event) => set(index, Number(event.target.value))}
            />
          </label>
        ))}
      </div>

      <Figure
        caption="The absorbed curve on a log horizon axis, with the crossing the estimator found"
        ariaLabel={`Absorbed fraction at six horizons; the estimator reports ${result.state}`}
        reading={reading.text}
        missing={
          result.state === "ok" && result.lower != null && result.upper != null
            ? `Interpolated between ${seconds(result.lower)} and ${seconds(result.upper)} — that cell spans a `
              + "doubling, so how much of the figure is measurement and how much is interpolation is worth knowing."
            : result.reason
        }
      >
        <div ref={plotRef} style={{ width: "100%" }}>
          <svg viewBox={`0 0 ${plotW} ${HEIGHT}`} width={plotW} height={HEIGHT}>
            <line x1={MARGIN.left} x2={plotW - MARGIN.right} y1={base} y2={base} className="coh-ladder__axis" />
            {/* The level being crossed. It is the figure's whole subject, so it
                is drawn over the data rather than under it. */}
            <line x1={MARGIN.left} x2={plotW - MARGIN.right} y1={y(0.5)} y2={y(0.5)} className="coh-survival__half">
              <title>Half the terminal move</title>
            </line>
            <text x={MARGIN.left} y={y(0.5) - 3} className="coh-svg-note">half</text>

            <path d={path} fill="none" className="coh-index__line">
              <title>{`Absorbed fraction across ${GRID.length} horizons`}</title>
            </path>

            {GRID.map((horizon, index) => (
              <circle key={horizon} cx={x(horizon)} cy={y(absorbed[index])} r={3} className="coh-model__point">
                <title>{`${GRID_LABELS[index]}: ${absorbed[index].toFixed(2)} absorbed`}</title>
              </circle>
            ))}

            {result.state === "ok" && result.value != null ? (
              <line
                x1={x(result.value)}
                x2={x(result.value)}
                y1={MARGIN.top}
                y2={base}
                className="coh-survival__median"
              >
                <title>{`Half-life ${seconds(result.value)}`}</title>
              </line>
            ) : null}

            {GRID.map((horizon, index) => (
              <text key={horizon} x={x(horizon)} y={HEIGHT - 8} textAnchor="middle" className="coh-ladder__tick">
                {GRID_LABELS[index]}
              </text>
            ))}
          </svg>
        </div>
      </Figure>

      <div className="coh-status__chips">
        <span className="coh-chip is-muted">
          <span className="coh-chip__mark" aria-hidden="true">{reading.mark}</span>
          <span className="coh-chip__word">State</span>
          <span className="coh-chip__value">{result.state}</span>
        </span>
        <span className="coh-chip is-muted">
          <span className="coh-chip__mark" aria-hidden="true">→</span>
          <span className="coh-chip__word">Half-life</span>
          <span className="coh-chip__value">{result.value == null ? "—" : seconds(result.value)}</span>
        </span>
      </div>
    </div>
  );
}
