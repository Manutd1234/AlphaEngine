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
import { DIAGRAM_LEGEND_PX, advancePx } from "@/lib/coherence/label-metrics";
import type { CoherenceSurface } from "@/lib/coherence/types-lab";
import Figure, { FigureEmpty, Plot } from "./Figure";

const HEIGHT = 188;
/**
 * `top` is 26 and not 16, and the ten pixels are load-bearing.
 *
 * The median's reference line carries its own words — "half crossed by 80299.99"
 * — drawn ABOVE the plot at `MARGIN.top - 8` on the 14px `--fs-diagram-legend`
 * rung. At a top of 16 that put the baseline at y=8, and a 14px face has about
 * eleven pixels of ascender above its baseline, so the text was drawn from y=-3
 * and the viewBox cut its top third off. Screenshotted by the reader on Lattice
 * and reproduced here at 1440px.
 *
 * The rule the number comes from: any text drawn above the plot needs a baseline
 * of at least its own font size, so `MARGIN.top` must clear the rung it draws at
 * plus whatever offset the caller subtracts. 26 − 8 = 18 against a 14px rung.
 * `HEIGHT` grows by the same ten so the plot area itself is unchanged.
 */
const MARGIN = { top: 26, right: 12, bottom: 30, left: 12 };
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
  /** "threshold" read directly, or "ceiling" inverted from a P(X <= k) market. */
  origin: string;
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
    steps.push({
      x, s, strike: probe.strike, survival: probe.survival, label: probe.label, origin: probe.origin,
    });
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
    parts.push(`Read from the ${surface.basis} side of each book, so every level is a price someone is showing.`);
  }
  if (unreadable) {
    parts.push(`${unreadable} probe(s) could not be parsed exactly and were left out, not rounded in.`);
  }
  if (rises) {
    parts.push(`${rises} step(s) rise with the strike, marked ▲. P(X ≥ k) cannot increase, so those are quoted violations, drawn as they arrived.`);
  }
  // Each part is a SENTENCE, so each ends in a stop before they are joined.
  // `surface.detail` arrives from the gateway without one, and the join used to
  // hand the reader "…not a probability of zero Read from the bid side of each
  // book", which is two sentences welded at a capital letter. Adding the stop
  // here rather than at the source keeps the gateway's string its own.
  return parts
    .filter(Boolean)
    .map((part) => (/[.!?]$/.test(part!.trim()) ? part!.trim() : `${part!.trim()}.`))
    .join(" ");
}

export default function SurvivalChart({ surface }: { surface: CoherenceSurface }) {
  if (surface.engine !== "ladder") {
    const named =
      surface.engine === "unavailable"
        ? "This family could not be read"
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
        <FigureEmpty reason={`${steps.length} strike(s) quoted — a survival function needs at least two.`} />
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

  /**
   * The interval that STARTS at each strike, so a scrub can name the mass.
   *
   * Bins are what differencing leaves between consecutive strikes, so the bin a
   * reader wants at strike k is the one whose `low` IS k. Keyed by centicents
   * rather than by the string, because "67600" and "67600.00" are the same
   * strike and different keys.
   */
  const massAt = new Map<number, { mass: string; negative: boolean; label: string }>();
  for (const bin of surface.bins) {
    const low = toCenticents(bin.low);
    if (low != null) massAt.set(low, { mass: bin.mass, negative: bin.negative, label: bin.label });
  }

  return (
    <Figure
      caption={CAPTION}
      ariaLabel={`Survival function sampled at ${steps.length} strikes`}
      reading={
        median
          ? `Survival first falls below a half between ${steps[crossing - 1].strike} and ${median.strike} — the exchange is not quoting a strike inside that gap, so the crossing is bracketed, not located.`
          : medianBelowRange
            ? `Survival is already below a half at ${steps[0].strike}, the lowest strike quoted, so the median sits below the quoted range rather than inside it.`
            : "Survival never falls below a half inside the quoted range, so the median sits above the highest quoted strike."
      }
      missing={missingLine(surface, unreadable, rises.length)}
    >
      <Plot
        height={HEIGHT}
        /**
         * ONE CURSOR OVER THE STRIKE AXIS, and it replaces the per-dot titles
         * rather than joining them. `Plot` gives a figure the mark readout or
         * the shared axis, never both — and a ladder is the case the shared one
         * is for: the reader's question at a strike is not "what is this dot"
         * but "what is true here", which on this figure is four things at once.
         * A per-mark readout answers it four times, once per press, and never
         * lets two be compared.
         *
         * `x0`/`x1` ARE FUNCTIONS OF THE MEASURED WIDTH, which is the trap this
         * hook documents: they are read in the same units as the pointer, and
         * the plot's own gutters are not known until it has been measured.
         * They are derived from the SAME `plotWidth` the drawing uses below, so
         * the cursor cannot land where no step was drawn.
         *
         * THE LINEAR INDEX→POSITION MAP IS EXACT HERE, AND THAT WAS MEASURED
         * RATHER THAN ASSUMED. `useCrosshair` maps the pointer to an index by
         * dividing the axis evenly, which is only the drawn position if the
         * strikes are evenly spaced. Checked against the live ladder on
         * 2026-08-26 — `KXBTCD-26AUG2513`, 124 probes from 67599.99 to
         * 79899.99, a single distinct gap of 100.0 — and the maximum deviation
         * between the value-based and index-based position was 0.000000 of the
         * axis. If a family ever quotes UNEVEN strikes the cursor drifts from
         * the curve, and the fix then is a positional read rather than an
         * index one; nothing invents that until a family needs it.
         *
         * `arriveAt: "first"`, because this axis is ordered rather than
         * temporal. The default is the last position — right for a record of
         * runs, where "now" is what a reader means — and on a 124-strike ladder
         * it is the far tail, where survival is nearest zero and the mass
         * thinnest. A keyboard reader arrives at the lowest strike, where the
         * curve begins; End still reaches the tail in one press.
         */
        sharedX={(width) => {
          const plotWidth = Math.max(1, width - MARGIN.left - MARGIN.right);
          return {
            count: steps.length,
            x0: MARGIN.left,
            x1: MARGIN.left + plotWidth,
            width: 260,
            arriveAt: "first" as const,
            read: (index: number) => {
              const step = steps[index];
              const interval = massAt.get(step.x);
              const rose = index > 0 && step.s > steps[index - 1].s;
              return {
                title: `Strike ${step.strike}`,
                rows: [
                  // The market's own name, which the per-dot `<title>` used to
                  // carry. It moves into the reading rather than being dropped:
                  // the titles go because `Plot` gives a figure the mark
                  // readout or the shared axis and never both, not because
                  // what they said stopped mattering.
                  { label: "Market", value: step.label },
                  { label: "P(X ≥ k)", value: priceLabel(step.survival) },
                  {
                    label: "Read from",
                    value: step.origin === "ceiling" ? "a P(X ≤ k) market, inverted" : "a threshold market",
                  },
                  {
                    label: "Mass to the next strike",
                    value: interval
                      ? `${interval.mass}${interval.negative ? " — negative" : ""}`
                      : "— no interval starts here",
                  },
                  ...(rose
                    ? [{ label: "Monotonicity", value: "▲ rose above a lower strike, which P(X ≥ k) cannot do" }]
                    : []),
                ],
              };
            },
          };
        }}
      >
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
                /* NO `<title>` SINCE 2026-08-26. It said the label, the
                   survival and the strike, and the shared readout says all
                   three at once beside the interval's mass — while a `<title>`
                   left here would give a hovering reader TWO tooltips, the
                   browser's and the figure's, saying overlapping things. */
                <circle key={step.strike} cx={x(step.x)} cy={y(step.s)} r={dotRadius} className="coh-surface__dot" />
              ))}
              {rises.slice(0, 12).map((index) => (
                <text
                  key={`rise-${steps[index].strike}`}
                  x={x(steps[index].x)}
                  y={y(steps[index].s) - 6}
                  textAnchor="middle"
                  className="coh-surface__rise"
                >
                  {/* The mark stays and its title goes: the readout's
                      Monotonicity row says the same thing at the same strike,
                      and two tooltips over one mark is the defect. */}
                  ▲
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
                  {/* A reference line's own words, not a tick numeral — the same
                      distinction DiffusionPane draws for "half still open", so the
                      two tabs treat identical furniture identically. 13px legend
                      rung via coh-figure__key (14q); the true ticks around it
                      ("0.5000", "1.0000", the strike endpoints) stay at the floor. */}
                  {/* Clamped to the plot on both sides. `textAnchor="middle"`
                      centres the words on the line, and the median sits at the
                      right-hand end of most ladders this desk watches — so half
                      the label was drawn past the viewBox and disappeared. The
                      width comes from `advancePx`, which is measured rather
                      than assumed; the old figures in this engine were out by
                      up to 20%. */}
                  {(() => {
                    const words = `half crossed by ${median.strike}`;
                    const half = advancePx(words, DIAGRAM_LEGEND_PX) / 2;
                    const at = Math.min(
                      Math.max(x(median.x), MARGIN.left + half),
                      Math.max(MARGIN.left + half, width - MARGIN.right - half),
                    );
                    return (
                      <text x={at} y={MARGIN.top - 8} textAnchor="middle" className="coh-figure__key">
                        {words}
                      </text>
                    );
                  })()}
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
