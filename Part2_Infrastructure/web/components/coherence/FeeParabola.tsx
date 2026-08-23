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
 */

import { DOLLAR_CC, fromCenticents, toCenticents } from "@/lib/coherence/fixed-point";
import Figure from "./Figure";

const HEIGHT = 150;
const MARGIN = { top: 12, right: 4, bottom: 20, left: 4 };
const SAMPLES = 49;

export default function FeeParabola({
  multiplier,
  taker = 0.07,
  feeAwareThreshold,
}: {
  multiplier: string;
  taker?: number;
  feeAwareThreshold: string | null;
}) {
  const mult = Number(multiplier) || 1;
  const rate = mult * taker;

  // Fee per contract at each price, in centicents.
  const points: Array<{ p: number; fee: number }> = [];
  for (let i = 1; i < SAMPLES; i += 1) {
    const p = i / SAMPLES;
    points.push({ p, fee: rate * p * (1 - p) * DOLLAR_CC });
  }
  const peak = Math.max(...points.map((point) => point.fee), 1);

  const plotWidth = 100 - MARGIN.left - MARGIN.right;
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
      caption="The trade fee across the price range, and the threshold it moves"
      ariaLabel={`The fee per contract peaks at fifty cents at ${fromCenticents(Math.round(peak))} and falls to nearly nothing at both tails`}
      reading={
        gap == null
          ? `The fee is ${fromCenticents(Math.round(peak))} per contract at fifty cents and near zero at both tails — it is Bernoulli variance, not a flat percentage.`
          : `The fee peaks at ${fromCenticents(Math.round(peak))} per contract at fifty cents. A basket priced there is only an arbitrage below ${feeAwareThreshold}, not below $1.0000 — the naive test invents opportunities across a ${fromCenticents(gap)} band.`
      }
    >
      <svg viewBox={`0 0 100 ${HEIGHT}`} preserveAspectRatio="none" className="coh-parabola">
        <line x1={MARGIN.left} x2={100 - MARGIN.right} y1={base} y2={base} className="coh-ladder__axis" />
        <path d={path} className="coh-parabola__curve" fill="none" />
        <line x1={x(0.5)} x2={x(0.5)} y1={y(peak)} y2={base} className="coh-parabola__peak" />
        <text x={x(0.5)} y={y(peak) - 3} textAnchor="middle" className="coh-ladder__tick">
          {fromCenticents(Math.round(peak))} per contract
        </text>
        <text x={MARGIN.left} y={HEIGHT - 5} className="coh-ladder__tick">
          $0.00
        </text>
        <text x={x(0.5)} y={HEIGHT - 5} textAnchor="middle" className="coh-ladder__tick">
          $0.50
        </text>
        <text x={100 - MARGIN.right} y={HEIGHT - 5} textAnchor="end" className="coh-ladder__tick">
          $1.00
        </text>
      </svg>
    </Figure>
  );
}
