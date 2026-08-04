"use client";

/**
 * Equity against its own high-water mark.
 *
 * Day P&L is one number and it hides the path. A book that is up $142k having
 * been up $310k at noon is a different book from one that ground there in a
 * straight line, and only the second is a book you would size up. The gap
 * between the two lines is current drawdown-from-peak, which is also the
 * quantity the gateway's halt rule is written against.
 *
 * ── Where the series comes from ─────────────────────────────────────────────
 * The gateway serves a **snapshot**: current equity, start-of-day, no history
 * endpoint. So on the live path this plots only the observations this tab has
 * actually made since it opened, and the caption says exactly that — a chart
 * implying a full session it never saw would be inventing history. The sandbox
 * draws a generated path instead, and is labelled as generated.
 */

import {
  DEFAULT_MARGIN,
  Grid,
  extent,
  linePath,
  linearScale,
  ticks,
  useMeasuredWidth,
} from "@/components/chart-kit";
import { compact, pct, usd } from "@/lib/format";
import type { EquityPoint } from "@/lib/portfolio";

interface EquityCurveProps {
  points: EquityPoint[];
  startOfDay: number;
  /** Equity level at which the gateway halts trading. */
  haltLevel: number;
  /** True when the series was generated rather than observed. */
  generated: boolean;
}

export default function EquityCurve({ points, startOfDay, haltLevel, generated }: EquityCurveProps) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();

  if (points.length < 2) {
    return (
      <div className="card">
        <div className="portfolio-card-heading">
          <div>
            <span className="page-kicker">Session</span>
            <h2>Intraday equity</h2>
          </div>
        </div>
        <p className="sub">
          {points.length === 1
            ? "One observation so far. The gateway serves a snapshot with no history endpoint, so this curve builds up from the polls this tab makes while it is open — it is not backfilled."
            : "Waiting for the first equity observation."}
        </p>
      </div>
    );
  }

  const height = 210;
  const m = { ...DEFAULT_MARGIN, right: 64, left: 62, bottom: 28 };
  const x0 = m.left;
  const x1 = Math.max(x0 + 40, width - m.right);
  const y0 = height - m.bottom;
  const y1 = m.top;

  const equity = points.map((p) => p.equity);
  const hwm = points.map((p) => p.highWaterMark);
  // The halt level is included in the domain so the chart cannot draw a book
  // that looks comfortable while sitting just above the level that stops it.
  const [lo, hi] = extent([...equity, ...hwm, startOfDay, haltLevel]);
  const yScale = linearScale(lo, hi, y0, y1);
  const xScale = linearScale(0, points.length - 1, x0, x1);
  const yTicks = ticks(lo, hi, 4);

  const last = points[points.length - 1];
  const drawdown = last.highWaterMark > 0 ? last.equity / last.highWaterMark - 1 : 0;
  const peak = Math.max(...hwm);

  const equityPath = linePath(points.map((p, i) => ({ x: xScale(i), y: yScale(p.equity) })));
  const hwmPath = linePath(points.map((p, i) => ({ x: xScale(i), y: yScale(p.highWaterMark) })));

  const stamp = (t: number) =>
    new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="card">
      <div className="portfolio-card-heading">
        <div>
          <span className="page-kicker">Session</span>
          <h2>Intraday equity</h2>
        </div>
        <span>{generated ? "generated path" : `${points.length} observations`}</span>
      </div>

      <div className="legend" style={{ marginBottom: 4 }}>
        <span>
          <i style={{ background: "var(--series-1)" }} aria-hidden /> Equity
        </span>
        <span>
          <i style={{ background: "var(--text-muted)" }} aria-hidden /> High-water mark
        </span>
        <span>
          <i style={{ background: "var(--status-critical)" }} aria-hidden /> Halt level
        </span>
      </div>

      <div ref={ref}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height={height}
          role="img"
          aria-label={`Intraday equity against its high-water mark. Currently ${usd(last.equity, 0)}, ${pct(drawdown, 2)} from a peak of ${usd(peak, 0)}.`}
        >
          <Grid yTicks={yTicks} yScale={yScale} x0={x0} x1={x1} format={(v) => `$${compact(v)}`} />

          {/* The stop, drawn as a rule rather than left to the axis labels. */}
          {haltLevel >= lo && haltLevel <= hi && (
            <>
              <line
                x1={x0}
                x2={x1}
                y1={yScale(haltLevel)}
                y2={yScale(haltLevel)}
                stroke="var(--status-critical)"
                strokeWidth={1}
                strokeDasharray="4 3"
                shapeRendering="crispEdges"
              />
              <text
                x={x1 + 6}
                y={yScale(haltLevel)}
                dominantBaseline="middle"
                fontSize={9.5}
                fontFamily="var(--mono)"
                fill="var(--critical-text)"
              >
                halt
              </text>
            </>
          )}

          <line
            x1={x0}
            x2={x1}
            y1={yScale(startOfDay)}
            y2={yScale(startOfDay)}
            stroke="var(--axis)"
            strokeWidth={1}
            shapeRendering="crispEdges"
          />

          <path d={hwmPath} fill="none" stroke="var(--text-muted)" strokeWidth={1.25} strokeDasharray="3 2" />
          <path d={equityPath} fill="none" stroke="var(--series-1)" strokeWidth={1.75} />

          <circle cx={xScale(points.length - 1)} cy={yScale(last.equity)} r={3} fill="var(--series-1)" />
          <text
            x={x1 + 6}
            y={yScale(last.equity)}
            dominantBaseline="middle"
            fontSize={10.5}
            fontFamily="var(--mono)"
            fill="var(--text-primary)"
          >
            ${compact(last.equity)}
          </text>

          <text x={x0} y={height - 8} fontSize={10} fontFamily="var(--mono)" fill="var(--text-muted)">
            {stamp(points[0].t)}
          </text>
          <text x={x1} y={height - 8} textAnchor="end" fontSize={10} fontFamily="var(--mono)" fill="var(--text-muted)">
            {stamp(last.t)}
          </text>
        </svg>
      </div>

      <div className="allocation-facts">
        <span>
          Session peak <strong className="num">{usd(peak, 0)}</strong>
        </span>
        <span>
          From peak{" "}
          <strong className="num" style={{ color: drawdown < 0 ? "var(--critical-text)" : undefined }}>
            {pct(drawdown, 2)}
          </strong>
        </span>
        <span>
          Against start <strong className={`num ${last.equity >= startOfDay ? "pos" : "neg"}`}>
            {pct(startOfDay > 0 ? last.equity / startOfDay - 1 : 0, 2)}
          </strong>
        </span>
      </div>

      <p className="research-note">
        {generated
          ? "Generated path for the sandbox book, deterministic and ending on the stated equity. The live gateway serves a snapshot with no history endpoint, so a real book plots only what this tab observes while open."
          : "Built from the polls this tab has made since it opened — the gateway exposes current and start-of-day equity, not a session series. It is not backfilled, so a fresh load starts from one point."}
      </p>
    </div>
  );
}
