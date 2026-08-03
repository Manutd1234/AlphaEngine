"use client";

/**
 * Price with the two model lines overlaid, and the bars where the model was
 * actually holding shaded behind them.
 *
 * The shading is the point of this chart: two moving averages crossing is
 * abstract, "you were long here and flat there" is not. It answers "what does
 * this strategy actually do?" before any performance number is shown.
 */

import { SeriesPoint, Strategy, PARAM_MEANING } from "@/lib/types";
import { fmt, priceDp, shortDate, dateTime } from "@/lib/format";
import {
  DEFAULT_MARGIN,
  Grid,
  Tooltip,
  XAxis,
  extent,
  linePath,
  linearScale,
  ticks,
  useCrosshair,
  useMeasuredWidth,
} from "./chart-kit";

const HEIGHT = 300;

export default function PriceChart({
  series,
  strategy,
  fast,
  slow,
  symbol,
}: {
  series: SeriesPoint[];
  strategy: Strategy;
  fast: number;
  slow: number;
  symbol: string;
}) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  const m = DEFAULT_MARGIN;
  const x0 = m.left;
  const x1 = Math.max(x0 + 10, width - m.right);
  const y0 = HEIGHT - m.bottom;
  const y1 = m.top;

  const { index, handlers } = useCrosshair(series.length, x0, x1);

  const [lo, hi] = extent(series.flatMap((p) => [p.close, p.fast, p.slow]));
  const pad = (hi - lo) * 0.06;
  const yScale = linearScale(lo - pad, hi + pad, y0, y1);
  const xScale = linearScale(0, Math.max(1, series.length - 1), x0, x1);
  const yTicks = ticks(lo - pad, hi + pad, 5);
  const dp = priceDp(hi);

  // Contiguous runs where the model held a position.
  const bands: Array<[number, number]> = [];
  let start: number | null = null;
  series.forEach((p, i) => {
    if (p.position !== 0 && start === null) start = i;
    if (p.position === 0 && start !== null) {
      bands.push([start, i]);
      start = null;
    }
  });
  if (start !== null) bands.push([start, series.length - 1]);

  const labels = PARAM_MEANING[strategy];
  const point = index != null ? series[index] : null;
  const last = series[series.length - 1];

  return (
    <div ref={ref}>
      <div className="legend">
        <span>
          <i style={{ background: "var(--series-1)" }} />
          {symbol} close
        </span>
        <span>
          <i style={{ background: "var(--series-2)" }} />
          {labels.fast} ({fast})
        </span>
        <span>
          <i style={{ background: "var(--series-3)" }} />
          {labels.slow} ({slow})
        </span>
        <span>
          <i
            className="swatch-box"
            style={{
              background: "color-mix(in srgb, var(--series-1) 14%, transparent)",
              height: 11,
              borderRadius: 3,
            }}
          />
          in position
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${HEIGHT}`}
        width="100%"
        height={HEIGHT}
        role="img"
        aria-label={`${symbol} price with ${labels.fast.toLowerCase()} ${fast} and ${labels.slow.toLowerCase()} ${slow}, shaded where the strategy held a position`}
        style={{ touchAction: "pan-y" }}
        {...handlers}
      >
        {bands.map(([a, b]) => (
          <rect
            key={`${a}-${b}`}
            x={xScale(a)}
            y={y1}
            width={Math.max(1, xScale(b) - xScale(a))}
            height={y0 - y1}
            fill="color-mix(in srgb, var(--series-1) 12%, transparent)"
          />
        ))}

        <Grid yTicks={yTicks} yScale={yScale} x0={x0} x1={x1} format={(v) => fmt(v, dp === 5 ? 4 : 0)} />
        <XAxis
          points={series.map((p) => p.t)}
          y={y0}
          x0={x0}
          x1={x1}
          format={shortDate}
        />

        <path
          d={linePath(series.map((p, i) => ({ x: xScale(i), y: yScale(p.close) })))}
          fill="none"
          stroke="var(--series-1)"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        <path
          d={linePath(series.map((p, i) => ({ x: xScale(i), y: p.fast == null ? null : yScale(p.fast) })))}
          fill="none"
          stroke="var(--series-2)"
          strokeWidth={1.6}
        />
        <path
          d={linePath(series.map((p, i) => ({ x: xScale(i), y: p.slow == null ? null : yScale(p.slow) })))}
          fill="none"
          stroke="var(--series-3)"
          strokeWidth={1.6}
        />

        {/* Direct end-label: satisfies the relief rule for the low-contrast
            aqua slot in light mode, so identity is never colour-alone. */}
        <text
          x={x1 + 5}
          y={yScale(last.close)}
          fontSize={10.5}
          fill="var(--text-secondary)"
          fontFamily="var(--mono)"
          dominantBaseline="middle"
        >
          {fmt(last.close, dp === 5 ? 4 : 0)}
        </text>

        {point && index != null && (
          <>
            <line
              x1={xScale(index)}
              x2={xScale(index)}
              y1={y1}
              y2={y0}
              stroke="var(--axis)"
              strokeWidth={1}
            />
            <circle
              cx={xScale(index)}
              cy={yScale(point.close)}
              r={4}
              fill="var(--series-1)"
              stroke="var(--surface-1)"
              strokeWidth={2}
            />
            <Tooltip
              x={xScale(index)}
              width={190}
              chartWidth={width}
              title={dateTime(point.t)}
              rows={[
                { label: "Close", value: fmt(point.close, dp), color: "var(--series-1)" },
                { label: labels.fast, value: fmt(point.fast, dp), color: "var(--series-2)" },
                { label: labels.slow, value: fmt(point.slow, dp), color: "var(--series-3)" },
                {
                  label: "Position",
                  value: point.position > 0 ? "LONG" : point.position < 0 ? "SHORT" : "flat",
                },
              ]}
            />
          </>
        )}
      </svg>
    </div>
  );
}
