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

import { useMeasuredWidth } from "@/components/chart-kit";
import { DOLLAR_CC, fromCenticents, toCenticents } from "@/lib/coherence/fixed-point";
import Figure from "./Figure";

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
}: {
  multiplier: string;
  /** The taker rate the curve is drawn at. There is no maker curve to draw. */
  taker?: number;
  feeAwareThreshold: string | null;
}) {
  const [plotRef, plotW] = useMeasuredWidth<HTMLDivElement>(720);
  const mult = Number(multiplier) || 1;
  const rate = mult * taker;

  // Fee per contract at each price, in centicents.
  const points: Array<{ p: number; fee: number }> = [];
  for (let i = 1; i < SAMPLES; i += 1) {
    const p = i / SAMPLES;
    points.push({ p, fee: rate * p * (1 - p) * DOLLAR_CC });
  }
  const peak = Math.max(...points.map((point) => point.fee), 1);

  const plotWidth = plotW - MARGIN.left - MARGIN.right;
  const base = HEIGHT - MARGIN.bottom;
  const x = (p: number) => MARGIN.left + p * plotWidth;
  const y = (fee: number) => base - (fee / peak) * (base - MARGIN.top);

  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${x(point.p).toFixed(2)},${y(point.fee).toFixed(2)}`)
    .join("");

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
    >
      <div ref={plotRef} style={{ width: "100%" }}>
        <svg viewBox={`0 0 ${plotW} ${HEIGHT}`} width={plotW} height={HEIGHT} className="coh-parabola">
        <line x1={MARGIN.left} x2={plotW - MARGIN.right} y1={base} y2={base} className="coh-ladder__axis" />
        <path d={path} className="coh-parabola__curve" fill="none">
          <title>{`rate x C x p x (1 - p) at the ${rate} taker rate`}</title>
        </path>
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
        <text x={plotW - MARGIN.right} y={HEIGHT - 5} textAnchor="end" className="coh-ladder__tick">
          $1.00
        </text>
        </svg>
      </div>
    </Figure>
  );
}
