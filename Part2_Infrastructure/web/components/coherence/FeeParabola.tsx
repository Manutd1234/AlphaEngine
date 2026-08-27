"use client";

/**
 * The fee against the price it is charged at, and the threshold it moves.
 *
 * Kalshi's trade fee is `rate x C x p x (1 - p)` — Bernoulli variance, so it
 * peaks at fifty cents and collapses toward the tails. That shape is the reason
 * the test everybody writes is the wrong one: `Σ ask < 1` does not approximate
 * the fee-aware threshold conservatively, it approximates it *wrongly*, and it
 * is furthest wrong in the middle of the book where the volume is.
 *
 * So the curve is drawn with the dollar line above it and the fee-aware
 * threshold below, and the gap between them is the band in which the naive test
 * reports arbitrages that do not exist. That band is the whole project's thesis
 * in one shape.
 *
 * WHAT THE CURVE CANNOT SAY IS NOW ITS OWN `missing` LINE. It is drawn at the
 * TAKER rate and models no maker fee, so a resting order's cost is not on it —
 * a fact that used to be a `<p className="coh-event__note">` in `FeesPane`,
 * forty pixels under the figure, with a comment apologising for being there
 * because this component took no `missing` prop. It takes one now: a footnote
 * about a drawing belongs inside the frame that draws it, which is the whole
 * reason `Figure` requires one.
 */

import { DOLLAR_CC, fromCenticents, toCenticents } from "@/lib/coherence/fixed-point";
import Figure, { Plot } from "./Figure";

const HEIGHT = 164;
/**
 * `top` is 26 and not 12, for the defect the reader screenshotted on Fees.
 *
 * The peak carries its own words — "0.0175 per contract" — drawn at
 * `y(peak) - 3`, and `y(peak)` IS `MARGIN.top` by construction, since the peak
 * is what the scale is normalised to. At a top of 12 the baseline was y=9 on
 * the 14px `--fs-svg-note` rung, and a 14px face has about eleven pixels of
 * ascender, so the reading was drawn from y=-2 and the viewBox cut its top off.
 * "Cost shape" was one of the two figures named in "the diagrams are cut off".
 *
 * Same rule as `SurvivalChart`: text above the plot needs a baseline of at
 * least its own font size, so `MARGIN.top` clears the rung plus the caller's
 * offset. 26 − 3 = 23 against a 14px rung. `HEIGHT` grows by the same fourteen
 * so the curve keeps the plot area it had.
 */
const MARGIN = { top: 26, right: 4, bottom: 20, left: 4 };
const SAMPLES = 49;

export default function FeeParabola({
  multiplier,
  taker = 0.07,
  feeAwareThreshold,
  at,
  link,
}: {
  multiplier: string;
  /** The taker rate the curve is drawn at. There is no maker curve to draw. */
  taker?: number;
  feeAwareThreshold: string | null;
  /**
   * The prices to sample, in units, when a caller has a set worth matching.
   *
   * Absent, the curve is its own even sweep of 49ths — which is the honest
   * default and the reason this figure was NOT linked to the measured curve
   * until 2026-08-27: a parabola sampled at 49ths beside a curve drawn on the
   * venue's grid means index three is two different prices, and a shared
   * crosshair would have named one while pointing at the other. Handed the
   * curve's own prices, the two index spaces are the same space.
   */
  at?: readonly number[];
  /** The pair's key, from the caller that draws both halves. */
  link?: string;
}) {
  const mult = Number(multiplier) || 1;
  const rate = mult * taker;

  // Fee per contract at each price, in centicents.
  const feeAt = (p: number) => ({ p, fee: rate * p * (1 - p) * DOLLAR_CC });
  const sampled: Array<{ p: number; fee: number }> = [];
  for (let i = 1; i < SAMPLES; i += 1) sampled.push(feeAt(i / SAMPLES));
  // A line needs two: a caller whose curve refused leaves the even sweep in
  // place rather than drawing a parabola through one point.
  const points = at && at.length >= 2 ? at.map(feeAt) : sampled;
  const peak = Math.max(...points.map((point) => point.fee), 1);

  const base = HEIGHT - MARGIN.bottom;
  /* The one geometry both the curve and the crosshair position through. It was
     a closure over a measured width until 2026-08-26, when this figure came off
     its own `<svg>` and onto `Plot`: the width now arrives per layout pass, so
     the mapping takes it as an argument rather than capturing it. */
  const xOf = (p: number, width: number) => MARGIN.left + p * (width - MARGIN.left - MARGIN.right);
  const y = (fee: number) => base - (fee / peak) * (base - MARGIN.top);

  const threshold = toCenticents(feeAwareThreshold);
  const gap = threshold == null ? null : DOLLAR_CC - threshold;

  return (
    <Figure
      caption="The trade fee across the price range"
      ariaLabel="A parabola over the $0 to $1 price range, peaking mid-range"
      reading={
        gap == null
          ? `The fee is ${fromCenticents(Math.round(peak))} per contract at fifty cents and near zero at both tails — it is Bernoulli variance, not a flat percentage.`
          : `The fee peaks at ${fromCenticents(Math.round(peak))} per contract at fifty cents. A basket priced there is only an arbitrage below ${feeAwareThreshold}, not below $1.0000 — the naive test invents opportunities across a ${fromCenticents(gap)} band.`
      }
      missing={`Drawn at the taker rate of ${taker} times the series multiplier. It models no maker fee, so a resting order's cost is not on this curve.`}
      notes={[
        `The closed form the curve draws: rate x contracts x p x (1 - p), at the ${rate} taker rate. It is `
        + "Bernoulli variance — the fee is largest where the outcome is least certain — which is why the naive "
        + "test is furthest wrong in the middle of the book.",
      ]}
    >
      <Plot
        height={HEIGHT}
        /* THE LAST MARKETS FIGURE ON A BARE `<svg>`, until 2026-08-26. It drew
           into its own element over `useMeasuredWidth`, so it had no tab stop,
           no arrow keys and no live region: its one `<title>` — the closed form
           — was a native tooltip, reachable with a mouse and by nothing else,
           and `figure-arrival-measure.mjs` counted the whole figure as undrawn
           with no reason to give. The formula it named is a fact about the
           CURVE rather than about any price on it, so it is a note now, and
           what the crosshair says at a position is what that position costs.
           NO `positions`: these samples are the one evenly spaced axis on the
           tab — 49ths of a dollar by construction — so the even division the
           hook does is exact. The axis is anchored to the first and last
           SAMPLE and not to the plot edges, because the curve is not drawn at
           $0 or $1: a contract at either is settled rather than quoted. */
        sharedX={(width) => ({
          count: points.length,
          x0: xOf(points[0].p, width),
          x1: xOf(points[points.length - 1].p, width),
          read: (index) => {
            const point = points[index];
            return {
              title: fromCenticents(Math.round(point.p * DOLLAR_CC)) ?? "—",
              rows: [{
                label: "Trade fee, per contract",
                value: fromCenticents(Math.round(point.fee)) ?? "—",
                raw: point.fee,
              }],
            };
          },
          width: 240,
          arriveAt: "first",
          link,
        })}
      >
        {(width) => {
        const x = (p: number) => xOf(p, width);
        const path = points
          .map((point, index) => `${index === 0 ? "M" : "L"}${x(point.p).toFixed(2)},${y(point.fee).toFixed(2)}`)
          .join("");
        return (
          <>
        <line x1={MARGIN.left} x2={width - MARGIN.right} y1={base} y2={base} className="coh-ladder__axis" />
        <path d={path} className="coh-parabola__curve" fill="none" />
        <line x1={x(0.5)} x2={x(0.5)} y1={y(peak)} y2={base} className="coh-parabola__peak" />
        {/* The peak figure is the curve's own reading, not a tick: it takes
            the diagram ladder's 13px note rung (coh-svg-note, 14r) while the
            three dollar ticks below stay on the 10px tick floor. */}
        {/* `MARGIN.top - 3` and not `y(peak) - 3`, although the two are the same
            number: `y` normalises the scale to the peak, so `y(peak)` IS
            `MARGIN.top` by construction. Written the long way the arithmetic
            that decides whether this label fits was invisible — to a reader and
            to `coherence-figure-margins.test.ts`, which reads the margin a
            label is offset from and could not see one here. That is how a
            clipped label survived on the figure the reader screenshotted while
            a guard written for exactly this defect passed. */}
        <text x={x(0.5)} y={MARGIN.top - 3} textAnchor="middle" className="coh-svg-note">
          {fromCenticents(Math.round(peak))} per contract
        </text>
        <text x={MARGIN.left} y={HEIGHT - 5} className="coh-ladder__tick">
          $0.00
        </text>
        <text x={x(0.5)} y={HEIGHT - 5} textAnchor="middle" className="coh-ladder__tick">
          $0.50
        </text>
        <text x={width - MARGIN.right} y={HEIGHT - 5} textAnchor="end" className="coh-ladder__tick">
          $1.00
        </text>
          </>
        );
        }}
      </Plot>
    </Figure>
  );
}
