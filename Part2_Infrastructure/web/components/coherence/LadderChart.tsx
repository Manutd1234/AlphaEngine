"use client";

/**
 * Kalshi's book as it really is: two bid ladders facing each other.
 *
 * Every other venue on this desk publishes bids and asks. Kalshi publishes YES
 * bids and NO bids, and an ask is a reading of the opposite ladder — a NO bid
 * at $0.56 *is* a YES offer at $0.44. Drawing it as bids-and-asks would show
 * the reader a book that does not exist, so the two ladders are drawn as they
 * arrive and the implied YES offers are drawn as a ghost above them.
 *
 * That ghost is the point of the picture. It is the ladder you would trade
 * against and the one Kalshi never sends you, and seeing it sit exactly one
 * spread away from the YES bids is what makes Lesson 0 obvious rather than
 * algebraic.
 *
 * Steps, not a curve: resting size is piecewise constant between price levels,
 * and a smooth line would draw liquidity at prices nobody is quoting.
 */

import { useMeasuredWidth } from "@/components/chart-kit";
import { DOLLAR_CC, fromCenticents, toCenticents } from "@/lib/coherence/fixed-point";
import Figure, { FigureEmpty } from "./Figure";

const HEIGHT = 150;
const MARGIN = { top: 14, right: 6, bottom: 22, left: 6 };

export interface LadderLevel {
  price: string;
  size: string;
}

export interface LadderChartProps {
  yesBids: LadderLevel[];
  noBids: LadderLevel[];
  yesAsks: LadderLevel[];
  caption: string;
  unquotedReason?: string | null;
}

interface Point {
  x: number;
  size: number;
}

function points(levels: LadderLevel[], mirror: boolean): Point[] {
  const out: Point[] = [];
  for (const level of levels) {
    const cc = toCenticents(level.price);
    const size = Number(level.size);
    if (cc == null || !Number.isFinite(size)) continue;
    // A NO bid at p is a claim about the YES price 1-p, so the NO ladder is
    // mirrored onto the YES axis rather than drawn on an axis of its own —
    // two axes would invite reading the two ladders as unrelated.
    out.push({ x: mirror ? DOLLAR_CC - cc : cc, size });
  }
  return out.sort((a, b) => a.x - b.x);
}

function stepPath(pts: Point[], x: (v: number) => number, y: (v: number) => number, base: number): string {
  if (!pts.length) return "";
  let d = `M${x(pts[0].x).toFixed(2)},${base.toFixed(2)}`;
  for (const point of pts) {
    d += `L${x(point.x).toFixed(2)},${base.toFixed(2)}L${x(point.x).toFixed(2)},${y(point.size).toFixed(2)}`;
    d += `L${x(point.x).toFixed(2)},${base.toFixed(2)}`;
  }
  return d;
}

function barsFor(pts: Point[], x: (v: number) => number, y: (v: number) => number, base: number, width: number) {
  return pts.map((point) => ({
    at: `${point.x}`,
    x: x(point.x) - width / 2,
    y: y(point.size),
    width,
    height: Math.max(0.6, base - y(point.size)),
    price: fromCenticents(point.x) as string,
    size: point.size,
  }));
}

export default function LadderChart({ yesBids, noBids, yesAsks, caption, unquotedReason }: LadderChartProps) {
  const [plotRef, plotW] = useMeasuredWidth<HTMLDivElement>(720);
  const yesPoints = points(yesBids, false);
  const askPoints = points(yesAsks, false);
  const noPoints = points(noBids, true);

  if (!yesPoints.length && !noPoints.length) {
    return (
      <Figure caption={caption} ariaLabel={`${caption}: nobody is quoting this market`} missing={unquotedReason}>
        <FigureEmpty reason="No resting orders on either side." />
      </Figure>
    );
  }

  const all = [...yesPoints, ...askPoints, ...noPoints];
  const lo = Math.min(...all.map((p) => p.x));
  const hi = Math.max(...all.map((p) => p.x));
  const pad = Math.max(200, (hi - lo) * 0.08);
  const domainLo = Math.max(0, lo - pad);
  const domainHi = Math.min(DOLLAR_CC, hi + pad);
  const maxSize = Math.max(...all.map((p) => p.size), 1);

  const plotWidth = plotW - MARGIN.left - MARGIN.right;
  const base = HEIGHT - MARGIN.bottom;
  const x = (v: number) => MARGIN.left + ((v - domainLo) / Math.max(1, domainHi - domainLo)) * plotWidth;
  const y = (size: number) => base - (size / maxSize) * (base - MARGIN.top);
  const barWidth = Math.max(0.5, plotWidth / Math.max(12, all.length * 1.6));

  const bestYesBid = yesPoints.length ? yesPoints[yesPoints.length - 1].x : null;
  const bestAsk = askPoints.length ? askPoints[0].x : null;

  return (
    <Figure
      caption={caption}
      // Where the offers come from is the reading's pinned sentence, co-rendered.
      ariaLabel={`${caption}: ${yesPoints.length} YES bid levels and ${noPoints.length} NO bid levels`}
      reading={
        bestYesBid != null && bestAsk != null
          // "not a queue Kalshi publishes" left this string on 2026-08-24: the
          // section lede states it once for both views. What stays is the part
          // only this figure can say, which is where the two numbers sit.
          ? `Best YES bid ${fromCenticents(bestYesBid)}, best YES offer ${fromCenticents(bestAsk)} — one spread apart; the offer is the NO ladder read from the other side.`
          : null
      }
      missing={unquotedReason}
    >
      <div ref={plotRef} style={{ width: "100%" }}>
        <svg viewBox={`0 0 ${plotW} ${HEIGHT}`} width={plotW} height={HEIGHT} className="coh-ladder">
        <line x1={MARGIN.left} x2={plotW - MARGIN.right} y1={base} y2={base} className="coh-ladder__axis" />
        {barsFor(noPoints, x, y, base, barWidth).map(({ at, price, size, ...bar }) => (
          <rect key={`no-${at}`} {...bar} className="coh-ladder__no">
            <title>{`NO bid implying YES ${price} for ${size} contracts`}</title>
          </rect>
        ))}
        {barsFor(yesPoints, x, y, base, barWidth).map(({ at, price, size, ...bar }) => (
          <rect key={`yes-${at}`} {...bar} className="coh-ladder__yes">
            <title>{`YES bid ${price} for ${size} contracts`}</title>
          </rect>
        ))}
        <path d={stepPath(askPoints, x, y, base)} className="coh-ladder__implied" fill="none" />
        {bestYesBid != null ? (
          <line x1={x(bestYesBid)} x2={x(bestYesBid)} y1={MARGIN.top - 8} y2={base} className="coh-ladder__mark" />
        ) : null}
        {bestAsk != null ? (
          <line x1={x(bestAsk)} x2={x(bestAsk)} y1={MARGIN.top - 8} y2={base} className="coh-ladder__mark is-ask" />
        ) : null}
        <text x={MARGIN.left} y={HEIGHT - 6} className="coh-ladder__tick">
          {fromCenticents(domainLo)}
        </text>
        <text x={plotW - MARGIN.right} y={HEIGHT - 6} textAnchor="end" className="coh-ladder__tick">
          {fromCenticents(domainHi)}
        </text>
        </svg>
      </div>
    </Figure>
  );
}
