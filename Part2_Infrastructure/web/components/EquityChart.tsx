"use client";

/**
 * Growth of $1 — strategy against buy-and-hold — with the drawdown underneath.
 *
 * Both series are indexed to 1 at t0 so they share one axis. (Plotting them on
 * two y-scales would invent a relationship that isn't in the data; indexing to a
 * common base is the fix.) Drawdown gets its own panel rather than a second
 * axis, and uses the negative pole of the diverging scale because it is a
 * strictly one-sided loss measure.
 */

import { SeriesPoint } from "@/lib/types";
import { fmt, pct, shortDate, dateTime, signedPct } from "@/lib/format";
import {
  DEFAULT_MARGIN,
  Grid,
  Tooltip,
  XAxis,
  areaPath,
  extent,
  linePath,
  linearScale,
  ticks,
  useCrosshair,
  useMeasuredWidth,
} from "./chart-kit";

const EQ_H = 260;
const DD_H = 110;

export default function EquityChart({ series }: { series: SeriesPoint[] }) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  const m = DEFAULT_MARGIN;
  const x0 = m.left;
  const x1 = Math.max(x0 + 10, width - m.right);

  const { index, handlers } = useCrosshair(series.length, x0, x1);
  const xScale = linearScale(0, Math.max(1, series.length - 1), x0, x1);

  // --- equity panel ---
  const eqTop = m.top;
  const eqBottom = EQ_H - 20;
  const [lo, hi] = extent(series.flatMap((p) => [p.equity, p.buyHold]));
  const padEq = (hi - lo) * 0.08;
  const yEq = linearScale(Math.max(0, lo - padEq), hi + padEq, eqBottom, eqTop);
  const eqTicks = ticks(Math.max(0, lo - padEq), hi + padEq, 4);

  // --- drawdown panel ---
  const ddTop = EQ_H + 12;
  const ddBottom = EQ_H + DD_H - m.bottom;
  const worst = Math.min(...series.map((p) => p.drawdown), -0.01);
  const yDd = linearScale(worst * 1.08, 0, ddBottom, ddTop);
  const ddTicks = ticks(worst * 1.08, 0, 3);

  const point = index != null ? series[index] : null;
  const last = series[series.length - 1];
  const total = EQ_H + DD_H;

  return (
    <div ref={ref}>
      <div className="legend">
        <span>
          <i style={{ background: "var(--series-1)" }} />
          Strategy
        </span>
        <span>
          <i style={{ background: "var(--series-2)" }} />
          Buy &amp; hold
        </span>
        <span>
          <i style={{ background: "var(--diverging-neg)" }} />
          Strategy drawdown
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${total}`}
        width="100%"
        height={total}
        role="img"
        aria-label="Strategy equity curve against buy and hold, with strategy drawdown below"
        style={{ touchAction: "pan-y" }}
        {...handlers}
      >
        <Grid yTicks={eqTicks} yScale={yEq} x0={x0} x1={x1} format={(v) => `${fmt(v, 2)}×`} />

        <path
          d={linePath(series.map((p, i) => ({ x: xScale(i), y: yEq(p.buyHold) })))}
          fill="none"
          stroke="var(--series-2)"
          strokeWidth={1.6}
          strokeDasharray="none"
          opacity={0.85}
        />
        <path
          d={linePath(series.map((p, i) => ({ x: xScale(i), y: yEq(p.equity) })))}
          fill="none"
          stroke="var(--series-1)"
          strokeWidth={2.2}
          strokeLinejoin="round"
        />

        {/* Direct end-labels — identity without relying on colour alone. */}
        <text
          x={x1 + 5}
          y={yEq(last.equity)}
          fontSize={10.5}
          fill="var(--series-1)"
          fontFamily="var(--mono)"
          fontWeight={600}
          dominantBaseline="middle"
        >
          {fmt(last.equity, 2)}×
        </text>
        <text
          x={x1 + 5}
          y={yEq(last.buyHold)}
          fontSize={10.5}
          fill="var(--text-secondary)"
          fontFamily="var(--mono)"
          dominantBaseline="middle"
        >
          {fmt(last.buyHold, 2)}×
        </text>

        <line
          x1={x0}
          x2={x1}
          y1={eqBottom}
          y2={eqBottom}
          stroke="var(--axis)"
          strokeWidth={1}
          shapeRendering="crispEdges"
        />

        {/* drawdown */}
        <Grid yTicks={ddTicks} yScale={yDd} x0={x0} x1={x1} format={(v) => pct(v, 0)} />
        <path
          d={areaPath(
            series.map((p, i) => ({ x: xScale(i), y: yDd(p.drawdown) })),
            yDd(0),
          )}
          fill="var(--diverging-neg)"
          opacity={0.22}
        />
        <path
          d={linePath(series.map((p, i) => ({ x: xScale(i), y: yDd(p.drawdown) })))}
          fill="none"
          stroke="var(--diverging-neg)"
          strokeWidth={1.4}
        />
        <XAxis points={series.map((p) => p.t)} y={ddBottom} x0={x0} x1={x1} format={shortDate} />

        {point && index != null && (
          <>
            <line
              x1={xScale(index)}
              x2={xScale(index)}
              y1={eqTop}
              y2={ddBottom}
              stroke="var(--axis)"
              strokeWidth={1}
            />
            <circle
              cx={xScale(index)}
              cy={yEq(point.equity)}
              r={4}
              fill="var(--series-1)"
              stroke="var(--surface-1)"
              strokeWidth={2}
            />
            <circle
              cx={xScale(index)}
              cy={yEq(point.buyHold)}
              r={3.5}
              fill="var(--series-2)"
              stroke="var(--surface-1)"
              strokeWidth={2}
            />
            <Tooltip
              x={xScale(index)}
              width={200}
              chartWidth={width}
              title={dateTime(point.t)}
              rows={[
                {
                  label: "Strategy",
                  value: `${fmt(point.equity, 3)}× (${signedPct(point.equity - 1)})`,
                  color: "var(--series-1)",
                },
                {
                  label: "Buy & hold",
                  value: `${fmt(point.buyHold, 3)}× (${signedPct(point.buyHold - 1)})`,
                  color: "var(--series-2)",
                },
                {
                  label: "Drawdown",
                  value: pct(point.drawdown, 1),
                  color: "var(--critical-text)",
                },
              ]}
            />
          </>
        )}
      </svg>
    </div>
  );
}
