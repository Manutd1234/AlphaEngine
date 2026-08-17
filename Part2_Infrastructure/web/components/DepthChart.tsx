"use client";

/**
 * Cumulative depth curve — how much size sits between the mid and any price.
 *
 * Bid and ask are the two poles of a signed quantity (you are buying or you are
 * selling), so this uses the diverging pair rather than two categorical slots —
 * the same blue/red language the Sharpe surface uses elsewhere in the app, with
 * the mid line as the neutral midpoint.
 *
 * The shape carries the information a ladder cannot: a wall shows up as a
 * near-vertical step, a thin book as a shallow ramp that keeps climbing.
 */

import { type Level } from "@/lib/venues";
import { compact, fmt, priceDp } from "@/lib/format";
import { DEFAULT_MARGIN, Grid, Tooltip, linearScale, ticks, useMeasuredWidth } from "./chart-kit";
import { useState } from "react";

/** Default height. Callers that sit beside a taller panel pass their own so the
 *  pair lands on one baseline instead of leaving a column half empty. */
const HEIGHT = 210;

interface Point {
  price: number;
  cum: number;
}

function cumulative(levels: Level[], maxPoints = 120): Point[] {
  const out: Point[] = [];
  let cum = 0;
  for (const [price, size] of levels.slice(0, maxPoints)) {
    cum += price * size;
    out.push({ price, cum });
  }
  return out;
}

/** Step path — depth is piecewise constant between price levels, so a smooth
 *  line would imply liquidity that is not there. */
function stepPath(pts: Point[], x: (p: number) => number, y: (c: number) => number): string {
  if (!pts.length) return "";
  let d = `M${x(pts[0].price).toFixed(2)},${y(0).toFixed(2)}`;
  let prev = 0;
  for (const p of pts) {
    d += `L${x(p.price).toFixed(2)},${y(prev).toFixed(2)}L${x(p.price).toFixed(2)},${y(p.cum).toFixed(2)}`;
    prev = p.cum;
  }
  return d;
}

function areaFrom(pts: Point[], x: (p: number) => number, y: (c: number) => number, base: number): string {
  const line = stepPath(pts, x, y);
  if (!line) return "";
  const last = pts[pts.length - 1];
  return `${line}L${x(last.price).toFixed(2)},${base.toFixed(2)}L${x(pts[0].price).toFixed(2)},${base.toFixed(2)}Z`;
}

export default function DepthChart({
  bids,
  asks,
  mid,
  height = HEIGHT,
}: {
  bids: Level[];
  asks: Level[];
  mid: number | null;
  height?: number;
}) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ x: number; price: number; bid: number; ask: number } | null>(null);

  const m = { ...DEFAULT_MARGIN, right: 20 };
  const x0 = m.left;
  const x1 = Math.max(x0 + 10, width - m.right);
  const y0 = height - m.bottom;
  const y1 = m.top;

  const bidPts = cumulative(bids);
  const askPts = cumulative(asks);

  if (!bidPts.length || !askPts.length || !mid) {
    return (
      <div ref={ref} style={{ height, display: "grid", placeItems: "center", color: "var(--text-muted)", fontSize: 14 }}>
        waiting for book…
      </div>
    );
  }

  // Symmetric window around mid so the two sides are visually comparable.
  const reach = Math.max(mid - bidPts[bidPts.length - 1].price, askPts[askPts.length - 1].price - mid);
  const lo = mid - reach;
  const hi = mid + reach;
  const maxCum = Math.max(bidPts[bidPts.length - 1].cum, askPts[askPts.length - 1].cum, 1);

  const x = linearScale(lo, hi, x0, x1);
  const y = linearScale(0, maxCum * 1.05, y0, y1);
  const dp = priceDp(mid);

  // Local pointer math on purpose: chart-kit's useCrosshair is index-based
  // over uniformly spaced points, and this axis is continuous price with two
  // independent step series. Only the Tooltip rendering is shared.
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const scale = rect.width / e.currentTarget.viewBox.baseVal.width || 1;
    const px = (e.clientX - rect.left) / scale;
    if (px < x0 || px > x1) return setHover(null);
    const price = lo + ((px - x0) / (x1 - x0)) * (hi - lo);
    const bid = bidPts.filter((p) => p.price >= price).at(-1)?.cum ?? 0;
    const ask = askPts.filter((p) => p.price <= price).at(-1)?.cum ?? 0;
    setHover({ x: px, price, bid, ask });
  };

  return (
    <div ref={ref}>
      <div className="legend">
        <span>
          <i style={{ background: "var(--diverging-pos)" }} />
          Cumulative bid depth
        </span>
        <span>
          <i style={{ background: "var(--diverging-neg)" }} />
          Cumulative ask depth
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label="Cumulative order book depth on each side of the mid price"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        style={{ touchAction: "pan-y" }}
      >
        <Grid yTicks={ticks(0, maxCum * 1.05, 4)} yScale={y} x0={x0} x1={x1} format={(v) => `$${compact(v)}`} />

        <path d={areaFrom(bidPts, x, y, y0)} fill="var(--diverging-pos)" opacity={0.18} />
        <path d={stepPath(bidPts, x, y)} fill="none" stroke="var(--diverging-pos)" strokeWidth={2} />
        <path d={areaFrom(askPts, x, y, y0)} fill="var(--diverging-neg)" opacity={0.18} />
        <path d={stepPath(askPts, x, y)} fill="none" stroke="var(--diverging-neg)" strokeWidth={2} />

        {/* the neutral midpoint of the diverging scale */}
        <line x1={x(mid)} x2={x(mid)} y1={y1} y2={y0} stroke="var(--text-muted)" strokeWidth={1} />
        <text x={x(mid)} y={y1 + 9} textAnchor="middle" fontSize={11} fill="var(--text-muted)" fontFamily="var(--mono)">
          mid {fmt(mid, dp)}
        </text>

        <line x1={x0} x2={x1} y1={y0} y2={y0} stroke="var(--axis)" strokeWidth={1} shapeRendering="crispEdges" />
        {[lo, mid, hi].map((p, i) => (
          <text
            key={p}
            x={x(p)}
            y={y0 + 15}
            textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}
            fontSize={11.5}
            fill="var(--text-muted)"
            fontFamily="var(--mono)"
          >
            {fmt(p, dp)}
          </text>
        ))}

        {hover && (
          <>
            <line x1={hover.x} x2={hover.x} y1={y1} y2={y0} stroke="var(--axis)" strokeWidth={1} />
            <Tooltip
              x={hover.x}
              width={150}
              chartWidth={width}
              title={fmt(hover.price, dp)}
              rows={[
                { label: "bid", value: `$${compact(hover.bid)}`, color: "var(--diverging-pos)" },
                { label: "ask", value: `$${compact(hover.ask)}`, color: "var(--diverging-neg)" },
              ]}
            />
          </>
        )}
      </svg>
    </div>
  );
}
