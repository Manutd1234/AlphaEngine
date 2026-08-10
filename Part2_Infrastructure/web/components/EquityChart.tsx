"use client";

/**
 * Growth of $1 — strategy against buy-and-hold — with the drawdown underneath.
 *
 * Both series are indexed to 1 at t0 so they share one axis. (Plotting them on
 * two y-scales would invent a relationship that isn't in the data; indexing to a
 * common base is the fix.) Drawdown gets its own panel rather than a second
 * axis, and uses the negative pole of the diverging scale because it is a
 * strictly one-sided loss measure.
 *
 * The optional Monte Carlo cone renders beneath the lines: it is context (what
 * other paths the same return distribution allows), never allowed to compete
 * with the realised curve for attention.
 */

import { useMemo } from "react";

import { MonteCarloBands, SeriesPoint } from "@/lib/types";
import { fmt, pct, shortDate, dateTime, signedPct } from "@/lib/format";
import {
  AnimatedPath,
  DEFAULT_MARGIN,
  Grid,
  Tooltip,
  XAxis,
  areaPath,
  bandPath,
  extent,
  linePath,
  linearScale,
  ticks,
  useCrosshair,
  useMeasuredWidth,
} from "./chart-kit";

const EQ_H = 260;
const DD_H = 110;

export default function EquityChart({
  series,
  bands,
  showBands = true,
}: {
  series: SeriesPoint[];
  bands?: MonteCarloBands | null;
  showBands?: boolean;
}) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  const m = DEFAULT_MARGIN;
  const x0 = m.left;
  const x1 = Math.max(x0 + 10, width - m.right);

  // Length guard: a band from an older payload must never be stretched across
  // a differently-thinned series.
  const mc = showBands && bands && bands.p05.length === series.length ? bands : null;

  const { index, handlers } = useCrosshair(series.length, x0, x1);

  // The crosshair re-renders on every pointermove; path building is the
  // expensive part, so it is memoised on the actual data inputs.
  const L = useMemo(() => {
    const xScale = linearScale(0, Math.max(1, series.length - 1), x0, x1);

    const eqTop = m.top;
    const eqBottom = EQ_H - 20;
    const values = series.flatMap((p) => [p.equity, p.buyHold]);
    if (mc) {
      for (let i = 0; i < series.length; i++) values.push(mc.p05[i], mc.p95[i]);
    }
    const [lo, hi] = extent(values);
    const padEq = (hi - lo) * 0.08;
    const yEq = linearScale(Math.max(0, lo - padEq), hi + padEq, eqBottom, eqTop);
    const eqTicks = ticks(Math.max(0, lo - padEq), hi + padEq, 4);

    const ddTop = EQ_H + 12;
    const ddBottom = EQ_H + DD_H - m.bottom;
    const worst = Math.min(...series.map((p) => p.drawdown), -0.01);
    const yDd = linearScale(worst * 1.08, 0, ddBottom, ddTop);
    const ddTicks = ticks(worst * 1.08, 0, 3);

    return {
      xScale,
      yEq,
      yDd,
      eqTicks,
      ddTicks,
      eqTop,
      eqBottom,
      ddBottom,
      outerBand: mc
        ? bandPath(series.map((_, i) => ({ x: xScale(i), y0: yEq(mc.p05[i]), y1: yEq(mc.p95[i]) })))
        : "",
      innerBand: mc
        ? bandPath(series.map((_, i) => ({ x: xScale(i), y0: yEq(mc.p25[i]), y1: yEq(mc.p75[i]) })))
        : "",
      medianLine: mc
        ? linePath(series.map((_, i) => ({ x: xScale(i), y: yEq(mc.p50[i]) })))
        : "",
      buyHoldLine: linePath(series.map((p, i) => ({ x: xScale(i), y: yEq(p.buyHold) }))),
      equityLine: linePath(series.map((p, i) => ({ x: xScale(i), y: yEq(p.equity) }))),
      ddArea: areaPath(series.map((p, i) => ({ x: xScale(i), y: yDd(p.drawdown) })), yDd(0)),
      ddLine: linePath(series.map((p, i) => ({ x: xScale(i), y: yDd(p.drawdown) }))),
    };
  }, [series, mc, x0, x1, m.top, m.bottom]);

  const point = index != null ? series[index] : null;
  const last = series[series.length - 1];
  const total = EQ_H + DD_H;
  // The draw's animation key: data identity, never width — a drag-resize
  // rewrites `d` on the same node and replays nothing.
  const drawKey = `${series.length}-${last?.t ?? 0}`;

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
        {mc && (
          <span>
            <i style={{ background: "color-mix(in srgb, var(--series-1) 25%, var(--surface-1))" }} />
            MC 5–95% · {mc.paths} resamples
          </span>
        )}
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
        <Grid yTicks={L.eqTicks} yScale={L.yEq} x0={x0} x1={x1} format={(v) => `${fmt(v, 2)}×`} />

        {mc && (
          /* The cone FADES — opacity only, never scale. A scaling cone would
             briefly draw a narrower uncertainty band than was computed; the
             animation would lie about the statistics. */
          <g className="chart-fade" key={drawKey}>
            <path d={L.outerBand} fill="var(--series-1)" opacity={0.1} />
            <path d={L.innerBand} fill="var(--series-1)" opacity={0.16} />
            <path d={L.medianLine} fill="none" stroke="var(--series-1)" strokeWidth={1} opacity={0.5} />
          </g>
        )}

        {/* The benchmark races 120ms behind the strategy: the delay is what
            makes the draw read as a comparison rather than two lines. */}
        <AnimatedPath
          drawKey={drawKey}
          delayMs={120}
          d={L.buyHoldLine}
          fill="none"
          stroke="var(--series-2)"
          strokeWidth={1.6}
          opacity={0.85}
        />
        <AnimatedPath
          drawKey={drawKey}
          d={L.equityLine}
          fill="none"
          stroke="var(--series-1)"
          strokeWidth={2.2}
          strokeLinejoin="round"
        />

        {/* Direct end-labels — identity without relying on colour alone. */}
        <text
          x={x1 + 5}
          y={L.yEq(last.equity)}
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
          y={L.yEq(last.buyHold)}
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
          y1={L.eqBottom}
          y2={L.eqBottom}
          stroke="var(--axis)"
          strokeWidth={1}
          shapeRendering="crispEdges"
        />

        {/* drawdown */}
        <Grid yTicks={L.ddTicks} yScale={L.yDd} x0={x0} x1={x1} format={(v) => pct(v, 0)} />
        <path d={L.ddArea} fill="var(--diverging-neg)" opacity={0.22} />
        <path d={L.ddLine} fill="none" stroke="var(--diverging-neg)" strokeWidth={1.4} />
        <XAxis points={series.map((p) => p.t)} y={L.ddBottom} x0={x0} x1={x1} format={shortDate} />

        {point && index != null && (
          /* Opacity transition on entry only; POSITION stays instant — a
             lagging crosshair misreports which bar you are on. */
          <g className="chart-hover">
            <line
              x1={L.xScale(index)}
              x2={L.xScale(index)}
              y1={L.eqTop}
              y2={L.ddBottom}
              stroke="var(--axis)"
              strokeWidth={1}
            />
            <circle
              cx={L.xScale(index)}
              cy={L.yEq(point.equity)}
              r={4}
              fill="var(--series-1)"
              stroke="var(--surface-1)"
              strokeWidth={2}
            />
            <circle
              cx={L.xScale(index)}
              cy={L.yEq(point.buyHold)}
              r={3.5}
              fill="var(--series-2)"
              stroke="var(--surface-1)"
              strokeWidth={2}
            />
            <Tooltip
              x={L.xScale(index)}
              width={mc ? 216 : 200}
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
                ...(mc
                  ? [
                      {
                        label: "MC 5–95%",
                        value: `${fmt(mc.p05[index], 2)}×–${fmt(mc.p95[index], 2)}×`,
                      },
                    ]
                  : []),
                {
                  label: "Drawdown",
                  value: pct(point.drawdown, 1),
                  color: "var(--critical-text)",
                },
              ]}
            />
          </g>
        )}
      </svg>
    </div>
  );
}
