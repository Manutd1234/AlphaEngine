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
 *
 * IT DRAWS THROUGH `Plot` SINCE 2026-08-25, AND UNTIL THEN IT WAS THE ONE
 * FIGURE ON THE TAB A KEYBOARD COULD NOT READ. Every bar already carried a
 * `<title>` — the price and the size — and a `<title>` is a native tooltip:
 * reachable with a mouse and by nothing else. It never appears on a touch
 * screen and never appears from a keyboard, which is precisely the exclusion
 * `use-mark-readout` was written to end. This file drew into a raw `<svg>`
 * over `useMeasuredWidth`, so it got none of that instrument; twenty-five
 * other figures on this engine got it by having done nothing.
 *
 * Swapping the wrapper is the whole change. `Plot` collects the elements
 * carrying a `<title>` in document order, gives the plot ONE tab stop, walks
 * the marks with arrow keys, and hands the focused mark's words to the
 * `Figure` to speak in a live region — one keyboard instrument, not one tab
 * stop per level, which on a full ladder would be dozens.
 *
 * WHAT THE TITLES SAY GREW WITH IT. A level's own size is what the bar
 * already draws; what a reader asks a ladder is how much is resting AT OR
 * BETTER than a price, because that is the quantity a marketable order eats.
 * The cumulative figure is in each mark's words now, and it accumulates from
 * the TOP of each book inwards — from the best bid down for YES, from the
 * best implied offer up for the mirrored NO ladder — because that is the
 * order an order fills in.
 */

import { DOLLAR_CC, fromCenticents, toCenticents } from "@/lib/coherence/fixed-point";
import Figure, { FigureEmpty, Plot } from "./Figure";

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

/**
 * A contract count for reading, without a float's tail.
 *
 * Sizes arrive as decimal strings and the cumulative is a sum of `Number`s, so
 * a ladder of thirty-seven levels reported "66887.90000000001 resting at that
 * bid or better" the first time this was measured in Chrome. Contracts are
 * whole on this venue in every case seen, but the wire carries hundredths, so
 * the fraction is kept when there is one and dropped when there is not — a
 * trailing ".00" claims a precision the count does not have, and sixteen
 * decimal places claim one nothing has.
 */
function contractsLabel(value: number): string {
  // `String`, not `toFixed(2)`. The first version padded to two places and put
  // the trailing zero straight back — "66887.90" for a sum of 66887.9, which is
  // the precision claim this helper exists to refuse, one decimal shorter.
  // Rounding to hundredths first is what removes the float's tail; `String`
  // then prints the shortest form that round-trips.
  return String(Math.round(value * 100) / 100);
}

/**
 * The bars, each carrying what is resting at its price AND at or better.
 *
 * `inwards` is which end of the book the queue starts at: a YES bid ladder
 * fills from the highest price down, and the mirrored NO ladder — drawn on the
 * YES axis — fills from the lowest implied offer up. Accumulating from the
 * wrong end would report the depth behind a price as the depth in front of it,
 * which is the one number a marketable order actually meets.
 */
function barsFor(
  pts: Point[],
  x: (v: number) => number,
  y: (v: number) => number,
  base: number,
  width: number,
  inwards: "from-high" | "from-low",
) {
  const order = inwards === "from-high" ? [...pts].reverse() : pts;
  const cumulative = new Map<number, number>();
  let running = 0;
  for (const point of order) {
    running += point.size;
    cumulative.set(point.x, running);
  }
  return pts.map((point) => ({
    at: `${point.x}`,
    x: x(point.x) - width / 2,
    y: y(point.size),
    width,
    height: Math.max(0.6, base - y(point.size)),
    price: fromCenticents(point.x) as string,
    size: point.size,
    depth: cumulative.get(point.x) ?? point.size,
  }));
}

export default function LadderChart({ yesBids, noBids, yesAsks, caption, unquotedReason }: LadderChartProps) {
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

  const base = HEIGHT - MARGIN.bottom;
  const y = (size: number) => base - (size / maxSize) * (base - MARGIN.top);

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
      <Plot height={HEIGHT}>
        {(plotW) => {
          const plotWidth = plotW - MARGIN.left - MARGIN.right;
          const x = (v: number) => MARGIN.left + ((v - domainLo) / Math.max(1, domainHi - domainLo)) * plotWidth;
          const barWidth = Math.max(0.5, plotWidth / Math.max(12, all.length * 1.6));
          return (
            <g className="coh-ladder">
              <line x1={MARGIN.left} x2={plotW - MARGIN.right} y1={base} y2={base} className="coh-ladder__axis" />
              {barsFor(noPoints, x, y, base, barWidth, "from-low").map(({ at, price, size, depth, ...bar }) => (
                <rect key={`no-${at}`} {...bar} className="coh-ladder__no">
                  <title>
                    {`NO bid implying YES ${price} for ${contractsLabel(size)} contracts; `
                     + `${contractsLabel(depth)} resting at that offer or better`}
                  </title>
                </rect>
              ))}
              {barsFor(yesPoints, x, y, base, barWidth, "from-high").map(({ at, price, size, depth, ...bar }) => (
                <rect key={`yes-${at}`} {...bar} className="coh-ladder__yes">
                  <title>
                    {`YES bid ${price} for ${contractsLabel(size)} contracts; `
                     + `${contractsLabel(depth)} resting at that bid or better`}
                  </title>
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
            </g>
          );
        }}
      </Plot>
    </Figure>
  );
}
