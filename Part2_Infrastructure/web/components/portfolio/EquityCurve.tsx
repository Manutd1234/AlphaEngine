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
 * Two sources, and the caption always says which. The gateway's risk monitor
 * persists an equity snapshot on a timer, so the curve is backfilled from that
 * durable history and then extended by this tab's own polls. Where no history
 * exists yet the chart shows only what this tab observed and says so — a chart
 * implying a session it never saw would be inventing history. The sandbox draws
 * a generated path instead, and is labelled as generated.
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
import StatTile from "@/components/StatTile";
import { compact, pct, usd } from "@/lib/format";
import type { EquityPoint } from "@/lib/portfolio";

interface EquityCurveProps {
  points: EquityPoint[];
  startOfDay: number;
  /** Equity level at which the gateway halts trading. */
  haltLevel: number;
  /** True when the series was generated rather than observed. */
  generated: boolean;
  /** Period returns derived from the persisted curve, when it exists. */
  periods?: Record<string, { pnl: number | null; return: number | null }> | null;
  /** True when the curve was seeded from the gateway's stored history. */
  backfilled?: boolean;
}

const PERIOD_LABELS: Array<[string, string]> = [
  ["day", "Day"],
  ["month_to_date", "Month to date"],
  ["since_first_snapshot", "Since first snapshot"],
];

export default function EquityCurve({
  points, startOfDay, haltLevel, generated, periods, backfilled,
}: EquityCurveProps) {
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
            ? "One observation so far. The gateway persists a snapshot on a timer, so this fills in as the risk monitor records the book."
            : "Waiting for the first equity observation."}
        </p>
      </div>
    );
  }

  const height = 260;
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

  // Contiguous runs of halted observations, collapsed into spans so a long halt
  // draws as one band rather than a picket fence of adjacent rectangles.
  const haltedSpans: Array<{ from: number; to: number }> = [];
  for (let i = 0; i < points.length; i += 1) {
    if (points[i].killSwitch !== true) continue;
    const previous = haltedSpans[haltedSpans.length - 1];
    if (previous && previous.to === i - 1) previous.to = i;
    else haltedSpans.push({ from: i, to: i });
  }
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
        {haltedSpans.length > 0 && (
          <span>
            <i
              aria-hidden
              style={{ background: "color-mix(in oklab, var(--status-critical) 12%, transparent)" }}
            />{" "}
            Halted
          </span>
        )}
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

          {/* Halted stretches, shaded behind the line. The endpoint has always
              recorded the kill-switch state per observation and the client threw
              it away, which left the curve unable to distinguish "the desk chose
              not to trade" from "the desk was not allowed to". Drawn first so the
              equity line stays on top of it. */}
          {haltedSpans.map((span) => (
            <rect
              key={`halt-${span.from}`}
              x={xScale(span.from)}
              y={y1}
              width={Math.max(1, xScale(span.to) - xScale(span.from))}
              height={y0 - y1}
              fill="color-mix(in oklab, var(--status-critical) 12%, transparent)"
            >
              <title>Trading halted for {span.to - span.from + 1} observation(s)</title>
            </rect>
          ))}

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
                fontSize={10}
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
            fontSize={11.5}
            fontFamily="var(--mono)"
            fill="var(--text-primary)"
          >
            ${compact(last.equity)}
          </text>

          <text x={x0} y={height - 8} fontSize={11} fontFamily="var(--mono)" fill="var(--text-muted)">
            {stamp(points[0].t)}
          </text>
          <text x={x1} y={height - 8} textAnchor="end" fontSize={11} fontFamily="var(--mono)" fill="var(--text-muted)">
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

      {!generated && periods && (
        /* Shared StatTile — the hand-rolled span/strong/small dialect left
           this workspace in the harmonisation pass. */
        <div className="tiles period-tiles">
          {PERIOD_LABELS.map(([key, label]) => {
            const period = periods[key];
            if (!period || period.pnl === null) return null;
            return (
              <StatTile
                key={key}
                label={label}
                value={`${period.pnl >= 0 ? "+" : "−"}${usd(Math.abs(period.pnl), 0)}`}
                note={period.return === null ? "—" : pct(period.return, 2)}
                tone={period.pnl >= 0 ? "pos" : "neg"}
              />
            );
          })}
        </div>
      )}

      <p className="research-note">
        {generated
          ? "Generated path for the sandbox book, deterministic and ending on the stated equity. A real book is drawn from the gateway's persisted snapshots instead."
          : backfilled
            ? "Backfilled from the gateway's persisted equity snapshots — written by the risk monitor on a timer — and extended by this tab's own polls. It survives a reload; the sampling interval is the resolution, so this is a shape, not a tick record."
            : "Built from the polls this tab has made since it opened. The gateway persists snapshots from its risk monitor, so this fills in as they accumulate."}
      </p>
    </div>
  );
}
