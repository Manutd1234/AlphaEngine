"use client";

/**
 * Two views of the same session that a single equity line cannot give.
 *
 * DRAWDOWN is exact. `highWaterMark` is on every point already, so the
 * underwater curve is `equity / highWaterMark - 1` — and it is the quantity the
 * gateway's halt rule is actually written against, which makes it the same
 * measure the desk is governed by rather than a second opinion about it.
 *
 * ROLLING SHARPE IS NOT ANNUALISED, and the axis says so. The equity track is a
 * poll series whose spacing depends on how long this tab has been open and how
 * often the gateway answered; multiplying by sqrt(periods-per-year) would
 * require inventing the period. Per-observation is a smaller claim that happens
 * to be true. Below the sample floor the line BREAKS rather than bridges —
 * `linePath` does that for free, and a bridged gap would draw a stability
 * nobody measured.
 */

import { useState } from "react";

import {
  DEFAULT_MARGIN,
  Grid,
  XAxis,
  areaPath,
  extent,
  linePath,
  linearScale,
  ticks,
  useMeasuredWidth,
} from "@/components/chart-kit";
import { pct } from "@/lib/format";
import {
  MIN_SHARPE_OBSERVATIONS,
  drawdownSeries,
  maxDrawdown,
  rollingSharpe,
} from "@/lib/portfolio-analytics";
import type { EquityPoint } from "@/lib/portfolio";

const HEIGHT = 150;
const MARGIN = { ...DEFAULT_MARGIN, right: 16 };

export function trendIndexAt(
  clientX: number,
  left: number,
  width: number,
  count: number,
): number | null {
  if (!Number.isFinite(clientX) || !Number.isFinite(left) || !Number.isFinite(width)
      || width <= 0 || count <= 0) return null;
  return Math.round(Math.min(1, Math.max(0, (clientX - left) / width)) * (count - 1));
}

function Plot({
  values,
  format,
  label,
  tone,
  fill,
  times,
}: {
  values: Array<number | null>;
  format: (v: number) => string;
  label: string;
  tone: string;
  fill?: boolean;
  times: number[];
}) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>(560);
  const [active, setActive] = useState<number | null>(null);
  const finite = values.filter((v): v is number => v != null);

  if (finite.length < 2) {
    return (
      <div ref={ref}>
        <p className="muted">
          Not enough observations yet: this needs {MIN_SHARPE_OBSERVATIONS}.
        </p>
      </div>
    );
  }

  const [lo, hi] = extent([...finite, 0]);
  const yTicks = ticks(lo, hi, 4);
  const plotW = Math.max(120, width - MARGIN.left - MARGIN.right);
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const xScale = linearScale(0, Math.max(1, values.length - 1), MARGIN.left, MARGIN.left + plotW);
  const yScale = linearScale(
    Math.min(lo, yTicks[0] ?? lo),
    Math.max(hi, yTicks[yTicks.length - 1] ?? hi),
    MARGIN.top + plotH,
    MARGIN.top,
  );

  const points = values.map((v, i) => ({ x: xScale(i), y: v == null ? null : yScale(v) }));
  const zero = yScale(0);
  const reading = active === null ? null : points[Math.min(values.length - 1, Math.max(0, active))];

  return (
    <div ref={ref}>
      <svg
        className="protected-chart-instrument"
        width="100%" height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`}
        role="img" aria-label={label} tabIndex={0}
        onFocus={() => setActive((at) => at ?? values.length - 1)}
        onBlur={() => setActive(null)}
        onPointerLeave={() => setActive(null)}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const left = rect.left + (MARGIN.left / width) * rect.width;
          setActive(trendIndexAt(event.clientX, left, (plotW / width) * rect.width, values.length));
        }}
        onKeyDown={(event) => {
          const at = active ?? values.length - 1;
          const next = event.keyCode === 36 ? 0 : event.keyCode === 35 ? values.length - 1
            : event.keyCode === 37 || event.keyCode === 38 ? Math.max(0, at - 1)
            : event.keyCode === 39 || event.keyCode === 40 ? Math.min(values.length - 1, at + 1) : null;
          if (next !== null) { event.preventDefault(); setActive(next); }
        }}
      >
        <Grid yTicks={yTicks} yScale={yScale} x0={MARGIN.left} x1={MARGIN.left + plotW} format={format} />
        {fill && (
          <path
            d={areaPath(
              points.filter((p): p is { x: number; y: number } => p.y != null),
              zero,
            )}
            fill={tone}
            opacity={0.16}
          />
        )}
        {/* Breaks at nulls rather than bridging them: a gap is a window the
            floor refused to score, and a straight segment across it would be a
            reading nobody took. */}
        <path d={linePath(points)} fill="none" stroke={tone} strokeWidth={1.75} />
        <line
          x1={MARGIN.left} x2={MARGIN.left + plotW} y1={zero} y2={zero}
          stroke="var(--axis)" strokeWidth={1} shapeRendering="crispEdges"
        />
        {reading?.y != null && (
          <g className="protected-chart-reading" data-linked="true">
            <line x1={reading.x} x2={reading.x} y1={MARGIN.top} y2={MARGIN.top + plotH} />
            <circle cx={reading.x} cy={reading.y} r={3.25} fill={tone} />
          </g>
        )}
        <XAxis
          points={times}
          y={MARGIN.top + plotH}
          x0={MARGIN.left}
          x1={MARGIN.left + plotW}
          format={(t) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
        />
      </svg>
    </div>
  );
}

export default function RiskAdjustedTrend({
  points,
  generated,
}: {
  points: EquityPoint[];
  generated: boolean;
}) {
  const underwater = drawdownSeries(points);
  const sharpe = rollingSharpe(points);
  const worst = maxDrawdown(points);

  if (underwater.length < 2) {
    return (
      <section className="card">
        <div className="portfolio-card-heading">
          <div>
            <span className="page-kicker">Risk-adjusted</span>
            <h2>Drawdown and rolling Sharpe</h2>
          </div>
        </div>
        <p className="muted">
          The equity track holds fewer than two observations, so no path to measure yet.
        </p>
      </section>
    );
  }

  return (
    <section className="card">
      <div className="portfolio-card-heading">
        <div>
          <span className="page-kicker">Risk-adjusted</span>
          <h2>Drawdown and rolling Sharpe</h2>
        </div>
        <span>
          {worst ? `deepest ${pct(worst.drawdown, 2)}` : "never underwater"}
        </span>
      </div>

      {/* Structural wrapper only: each label stays welded to its plot, and the
          pair shares one row at desk width (the grid lives in
          14f-density-portfolio.css). Below that breakpoint the wrapper is a
          plain block and the two stack exactly as they always did. */}
      <div className="portfolio-trend-pair">
        <div>
          <div className="field">Drawdown from high-water mark</div>
          <Plot
            values={underwater.map((p) => p.drawdown)}
            times={underwater.map((p) => p.t)}
            format={(v) => pct(v, 1)}
            label="Drawdown from the running high-water mark"
            tone="var(--diverging-neg)"
            fill
          />
        </div>

        <div>
          <div className="field">Rolling Sharpe, per observation</div>
          <Plot
            values={sharpe.map((p) => p.sharpe)}
            times={sharpe.map((p) => p.t)}
            format={(v) => v.toFixed(2)}
            label="Rolling Sharpe ratio per observation over the equity track"
            tone="var(--series-1)"
          />
        </div>
      </div>

      {/* The generated marker LEFT the paragraph rather than folding with it.
          It was a trailing clause on a methodology note; a reader who never
          opens the note must still be told these two plots are drawn from a
          seed, so it is its own line and it is never behind the fold. */}
      {generated && <p className="research-note">Generated path for the sandbox book.</p>}

      {/* Method, not measurement. The claim a reader needs at rest — that the
          Sharpe line is per observation — is the field label above the plot. */}
      <details className="disclosure">
        <summary>How these two lines are scaled, and where they stop</summary>
        <p className="research-note">
          Drawdown uses the same running high-water mark as the gateway&rsquo;s halt rule.
          The Sharpe line is <strong>per observation and not annualised</strong>: a poll series has
          no stable period to scale by. It is blank for the first{" "}
          {MIN_SHARPE_OBSERVATIONS} observations and breaks wherever the window is too thin to score.
        </p>
      </details>
    </section>
  );
}
