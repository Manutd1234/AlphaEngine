"use client";

/**
 * The survival function a strike ladder samples, drawn as the steps it is.
 *
 * A Kalshi strike ladder is not a set of independent markets. "BTC at or above
 * $77,600" and "BTC at or above $77,700" are two readings of one distribution,
 * and the price of each IS a survival probability, P(X >= k). Put in strike
 * order they are the survival function itself, sampled wherever the exchange
 * happens to be quoting.
 *
 * Steps, never a curve. Between two quoted strikes the exchange says nothing,
 * so the function is held flat and dropped at the next strike it does quote. A
 * smooth interpolation would draw probability at levels nobody has published —
 * the same error `LadderChart` refuses one panel over, for the same reason.
 *
 * Monotonicity is checked rather than assumed. P(X >= k) cannot rise as k
 * rises; where the quotes say it does, the rise is drawn as it arrived and
 * marked with a glyph and a word, because that violation is the thing the
 * certificate prices, not something to smooth away in a chart.
 */

import { DOLLAR_CC, priceLabel, toCenticents } from "@/lib/coherence/fixed-point";
import type { CoherenceSurface } from "@/lib/coherence/types-lab";
import Figure, { FigureEmpty, Plot } from "./Figure";

const HEIGHT = 178;
const MARGIN = { top: 16, right: 12, bottom: 30, left: 12 };
const HALF_CC = DOLLAR_CC / 2;
const CAPTION = "The survival function, P(X ≥ k), at every strike the exchange quotes";

interface Step {
  /** Strike in centicents of the underlying's unit — exact, never a float. */
  x: number;
  /** Survival in centicents of a dollar: 10,000 is certainty. */
  s: number;
  strike: string;
  survival: string;
  label: string;
}

function readProbes(surface: CoherenceSurface): { steps: Step[]; unreadable: number } {
  const steps: Step[] = [];
  let unreadable = 0;
  for (const probe of surface.probes) {
    const x = toCenticents(probe.strike);
    const s = toCenticents(probe.survival);
    // A strike or a survival this desk cannot parse exactly is dropped and
    // counted, never coerced: a mis-parsed strike would move a step sideways
    // and a mis-parsed survival would invent a probability.
    if (x == null || s == null) {
      unreadable += 1;
      continue;
    }
    steps.push({ x, s, strike: probe.strike, survival: probe.survival, label: probe.label });
  }
  steps.sort((a, b) => a.x - b.x);
  return { steps, unreadable };
}

function stepPath(steps: Step[], x: (v: number) => number, y: (v: number) => number): string {
  let d = `M${x(steps[0].x).toFixed(2)},${y(steps[0].s).toFixed(2)}`;
  for (let index = 1; index < steps.length; index += 1) {
    // Along at the previous level, then down at the strike that repriced it.
    d += `L${x(steps[index].x).toFixed(2)},${y(steps[index - 1].s).toFixed(2)}`;
    d += `L${x(steps[index].x).toFixed(2)},${y(steps[index].s).toFixed(2)}`;
  }
  return d;
}

function missingLine(surface: CoherenceSurface, unreadable: number, rises: number): string {
  const parts = [surface.detail];
  if (surface.basis) {
    parts.push(`Read from the ${surface.basis} side of each book, so every level here is a price someone is actually showing.`);
  }
  if (unreadable) {
    parts.push(`${unreadable} probe(s) arrived with a strike or a survival this desk could not parse exactly and were left out rather than rounded in.`);
  }
  if (rises) {
    parts.push(`${rises} step(s) rise with the strike, marked ▲ rising. P(X ≥ k) cannot increase as k increases, so those are quoted violations, drawn as they arrived.`);
  }
  return parts.filter(Boolean).join(" ");
}

export default function SurvivalChart({ surface }: { surface: CoherenceSurface }) {
  if (surface.engine !== "ladder") {
    const named =
      surface.engine === "unavailable"
        ? "This family could not be read at all"
        : `This family is priced as ${surface.engine} intervals, one market per outcome, not as a ladder of thresholds`;
    return (
      <Figure
        caption={CAPTION}
        ariaLabel="No survival function: this family is not priced as a strike ladder"
        missing={surface.detail}
      >
        <FigureEmpty
          reason={`${named}, so there is no survival curve to sample — the mass is quoted directly and is drawn beside this instead.`}
        />
      </Figure>
    );
  }

  const { steps, unreadable } = readProbes(surface);
  if (steps.length < 2) {
    return (
      <Figure
        caption={CAPTION}
        ariaLabel="No survival function: fewer than two strikes are quoted"
        missing={missingLine(surface, unreadable, 0)}
      >
        <FigureEmpty reason={`${steps.length} strike(s) on this ladder are quoted. A survival function needs at least two.`} />
      </Figure>
    );
  }

  const rises: number[] = [];
  for (let index = 1; index < steps.length; index += 1) {
    if (steps[index].s > steps[index - 1].s) rises.push(index);
  }

  const lo = steps[0].x;
  const hi = steps[steps.length - 1].x;
  const span = Math.max(1, hi - lo);
  // Three cases, not two. `findIndex` returns -1 when the curve never falls
  // below a half, and 0 when it is ALREADY below one at the lowest quoted
  // strike — and those put the median on opposite sides of the ladder. Treating
  // index 0 as "no crossing" made the figure say the median sat above the
  // highest strike on a ladder where it sits below the lowest, which is the
  // reverse of the truth and the kind of sentence a reader acts on.
  const crossing = steps.findIndex((step) => step.s < HALF_CC);
  const median = crossing > 0 ? steps[crossing] : null;
  const medianBelowRange = crossing === 0;
  const dotRadius = steps.length > 60 ? 1 : 1.9;

  return (
    <Figure
      caption={CAPTION}
      ariaLabel={`Survival function sampled at ${steps.length} strikes, from ${steps[0].strike} at ${priceLabel(steps[0].survival)} down to ${steps[steps.length - 1].strike} at ${priceLabel(steps[steps.length - 1].survival)}`}
      reading={`Survival runs from ${priceLabel(steps[0].survival)} at ${steps[0].strike} to ${priceLabel(steps[steps.length - 1].survival)} at ${steps[steps.length - 1].strike}.${
        median
          ? ` It first falls below a half between ${steps[crossing - 1].strike} and ${median.strike} — the exchange is not quoting a strike inside that gap, so the crossing is bracketed, not located.`
          : medianBelowRange
            ? ` It is already below a half at ${steps[0].strike}, the lowest strike quoted, so the median sits below the quoted range rather than inside it.`
            : " It never falls below a half inside the quoted range, so the median sits above the highest strike anyone is quoting."
      }`}
      missing={missingLine(surface, unreadable, rises.length)}
    >
      <Plot height={HEIGHT}>
        {(width) => {
          const plotWidth = Math.max(1, width - MARGIN.left - MARGIN.right);
          const base = HEIGHT - MARGIN.bottom;
          const x = (value: number) => MARGIN.left + ((value - lo) / span) * plotWidth;
          const y = (value: number) => base - (value / DOLLAR_CC) * (base - MARGIN.top);
          return (
            <>
              <line x1={MARGIN.left} x2={width - MARGIN.right} y1={base} y2={base} className="coh-surface__axis" />
              <path d={stepPath(steps, x, y)} className="coh-surface__step" fill="none" />
              {steps.map((step) => (
                <circle key={step.strike} cx={x(step.x)} cy={y(step.s)} r={dotRadius} className="coh-surface__dot">
                  <title>{`${step.label}: survival ${priceLabel(step.survival)} at strike ${step.strike}`}</title>
                </circle>
              ))}
              {rises.slice(0, 12).map((index) => (
                <text
                  key={`rise-${steps[index].strike}`}
                  x={x(steps[index].x)}
                  y={y(steps[index].s) - 6}
                  textAnchor="middle"
                  className="coh-surface__rise"
                >
                  ▲
                  <title>{`${steps[index].label}: survival rises to ${priceLabel(steps[index].survival)} above a lower strike — a monotonicity violation, not a drawing artefact`}</title>
                </text>
              ))}
              {/* The half line and the bracketed median are drawn over the data:
                  they are the references the reader is asked to judge against. */}
              <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(HALF_CC)} y2={y(HALF_CC)} className="coh-surface__half" />
              <text x={width - MARGIN.right} y={y(HALF_CC) - 3} textAnchor="end" className="coh-surface__tick">
                0.5000
              </text>
              {median ? (
                <>
                  <line x1={x(median.x)} x2={x(median.x)} y1={MARGIN.top - 6} y2={base} className="coh-surface__median" />
                  <text x={x(median.x)} y={MARGIN.top - 8} textAnchor="middle" className="coh-surface__tick">
                    {`half crossed by ${median.strike}`}
                  </text>
                </>
              ) : null}
              <text x={MARGIN.left} y={MARGIN.top - 4} className="coh-surface__tick">
                1.0000
              </text>
              <text x={MARGIN.left} y={HEIGHT - 8} className="coh-surface__tick">
                {`strike ${steps[0].strike}`}
              </text>
              <text x={width - MARGIN.right} y={HEIGHT - 8} textAnchor="end" className="coh-surface__tick">
                {`strike ${steps[steps.length - 1].strike}`}
              </text>
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}
