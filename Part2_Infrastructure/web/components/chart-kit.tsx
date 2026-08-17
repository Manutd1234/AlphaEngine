"use client";

/**
 * Minimal SVG chart primitives.
 *
 * Hand-rolled rather than pulled from a charting library: the whole visual
 * system here is a handful of scales, a path builder and a crosshair, and
 * owning them keeps the marks thin, the grid recessive and the colour roles
 * exactly as validated — none of which survives a library's defaults intact.
 */

import { useCallback, useLayoutEffect, useRef, useState } from "react";

export interface Margin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const DEFAULT_MARGIN: Margin = { top: 10, right: 56, bottom: 26, left: 52 };

export function useMeasuredWidth<T extends HTMLElement>(fallback = 720) {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && Math.abs(w - width) > 1) setWidth(w);
    });
    observer.observe(el);
    setWidth(el.clientWidth || fallback);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return [ref, width] as const;
}

export function linearScale(d0: number, d1: number, r0: number, r1: number) {
  const span = d1 - d0 || 1;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

export function extent(values: Array<number | null | undefined>): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v == null || !Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (lo === Infinity) return [0, 1];
  if (lo === hi) return [lo - 0.5, hi + 0.5];
  return [lo, hi];
}

/** "Nice" tick values — round numbers a reader can hold in their head. */
export function ticks(lo: number, hi: number, count = 5): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) return [lo];
  const raw = (hi - lo) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(raw))));
  const norm = raw / mag;
  const step = (norm >= 7.5 ? 10 : norm >= 3.5 ? 5 : norm >= 1.5 ? 2 : 1) * mag;
  const start = Math.ceil(lo / step) * step;
  const out: number[] = [];
  for (let v = start; v <= hi + step * 1e-6; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

/** Path through points, breaking the line at nulls rather than bridging them —
 *  a gap is missing data and must not be drawn as a straight segment. */
export function linePath(
  points: Array<{ x: number; y: number | null }>,
): string {
  let d = "";
  let pen = false;
  for (const p of points) {
    if (p.y == null || !Number.isFinite(p.y)) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${p.x.toFixed(2)},${p.y.toFixed(2)}`;
    pen = true;
  }
  return d;
}

export function areaPath(
  points: Array<{ x: number; y: number }>,
  baseline: number,
): string {
  if (!points.length) return "";
  const top = points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join("");
  return `${top}L${points[points.length - 1].x.toFixed(2)},${baseline.toFixed(2)}L${points[0].x.toFixed(2)},${baseline.toFixed(2)}Z`;
}

/** Closed envelope between two aligned curves — `areaPath` only supports a
 *  constant baseline, which a percentile band does not have. Upper edge drawn
 *  left→right, lower edge right→left. */
export function bandPath(
  points: Array<{ x: number; y0: number; y1: number }>,
): string {
  if (!points.length) return "";
  let d = "";
  for (let i = 0; i < points.length; i++) {
    d += `${i ? "L" : "M"}${points[i].x.toFixed(2)},${points[i].y1.toFixed(2)}`;
  }
  for (let i = points.length - 1; i >= 0; i--) {
    d += `L${points[i].x.toFixed(2)},${points[i].y0.toFixed(2)}`;
  }
  return `${d}Z`;
}

/**
 * A line that draws itself once per result.
 *
 * `pathLength={1}` normalises every path to unit length, so one stylesheet
 * rule (stroke-dashoffset 1 → 0 over `--dur-draw`) fits every line in the
 * app regardless of geometry. The animation key is **data identity**, chosen
 * by the caller (dataHash, or series length + last timestamp) — never width:
 * `useMeasuredWidth` re-renders on every drag, and a width-keyed path would
 * replay its draw on resize. A resize only rewrites `d` on the same node,
 * and a finished animation does not rerun.
 */
export function AnimatedPath({
  drawKey,
  delayMs = 0,
  style,
  className,
  ...path
}: React.SVGProps<SVGPathElement> & {
  /** Remounts the path — and replays the draw — when the DATA changes. */
  drawKey: string | number;
  /** Offset into the draw sequence (the benchmark races 120ms behind). */
  delayMs?: number;
}) {
  return (
    <path
      key={drawKey}
      pathLength={1}
      className={className ? `chart-draw ${className}` : "chart-draw"}
      style={{ ...style, "--draw-delay": `${delayMs}ms` } as React.CSSProperties}
      {...path}
    />
  );
}

/** Recessive hairline grid + axis labels. Never dashed. */
export function Grid({
  yTicks,
  yScale,
  x0,
  x1,
  format,
}: {
  yTicks: number[];
  yScale: (v: number) => number;
  x0: number;
  x1: number;
  format: (v: number) => string;
}) {
  return (
    <g aria-hidden="true">
      {yTicks.map((t) => (
        <g key={t}>
          <line
            x1={x0}
            x2={x1}
            y1={yScale(t)}
            y2={yScale(t)}
            stroke="var(--grid)"
            strokeWidth={1}
            shapeRendering="crispEdges"
          />
          <text
            x={x0 - 8}
            y={yScale(t)}
            textAnchor="end"
            dominantBaseline="middle"
            fill="var(--text-muted)"
            fontSize={11.5}
            fontFamily="var(--mono)"
          >
            {format(t)}
          </text>
        </g>
      ))}
    </g>
  );
}

/**
 * X axis with collision-free ticks.
 *
 * Evenly-spaced indices plus a forced final tick will place the last two labels
 * on top of each other whenever the series length isn't a clean multiple of the
 * tick count. Labels are therefore laid out from the right and any candidate
 * that falls within `minGap` pixels of one already placed is dropped.
 */
export function XAxis({
  points,
  y,
  x0,
  x1,
  format,
  minGap = 78,
}: {
  points: number[];
  y: number;
  x0: number;
  x1: number;
  format: (v: number) => string;
  minGap?: number;
}) {
  if (!points.length) return null;

  const xScale = linearScale(0, Math.max(1, points.length - 1), x0, x1);
  const span = x1 - x0;
  const target = Math.max(2, Math.min(7, Math.floor(span / minGap) + 1));

  const candidates: number[] = [points.length - 1];
  const stride = (points.length - 1) / (target - 1);
  for (let k = target - 2; k >= 0; k--) candidates.push(Math.round(k * stride));

  const kept: number[] = [];
  for (const i of candidates) {
    if (kept.every((j) => Math.abs(xScale(i) - xScale(j)) >= minGap)) kept.push(i);
  }
  kept.sort((a, b) => a - b);

  return (
    <g aria-hidden="true">
      <line x1={x0} x2={x1} y1={y} y2={y} stroke="var(--axis)" strokeWidth={1} shapeRendering="crispEdges" />
      {kept.map((i, k) => (
        <text
          key={i}
          x={xScale(i)}
          y={y + 15}
          textAnchor={k === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
          fill="var(--text-muted)"
          fontSize={11.5}
          fontFamily="var(--mono)"
        >
          {format(points[i])}
        </text>
      ))}
    </g>
  );
}

/** Crosshair + tooltip. An SVG chart is interactive by default; this is the
 *  hover layer every line/area chart in the app ships with. */
export function useCrosshair(
  count: number,
  x0: number,
  x1: number,
): {
  index: number | null;
  handlers: {
    onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => void;
    onPointerLeave: () => void;
  };
} {
  const [index, setIndex] = useState<number | null>(null);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const scale = rect.width / e.currentTarget.viewBox.baseVal.width || 1;
      const x = (e.clientX - rect.left) / scale;
      const frac = (x - x0) / Math.max(1, x1 - x0);
      const i = Math.round(frac * (count - 1));
      setIndex(i >= 0 && i < count ? i : null);
    },
    [count, x0, x1],
  );

  return { index, handlers: { onPointerMove, onPointerLeave: () => setIndex(null) } };
}

export function Tooltip({
  x,
  width,
  chartWidth,
  rows,
  title,
}: {
  x: number;
  width: number;
  chartWidth: number;
  title: string;
  rows: Array<{ label: string; value: string; color?: string }>;
}) {
  const w = width;
  const h = 22 + rows.length * 16;
  const left = Math.min(Math.max(x + 12, 4), chartWidth - w - 4);
  return (
    <g pointerEvents="none">
      <rect
        x={left}
        y={8}
        width={w}
        height={h}
        rx={7}
        fill="var(--surface-1)"
        stroke="var(--border)"
      />
      <text x={left + 10} y={24} fontSize={11.5} fill="var(--text-muted)" fontFamily="var(--mono)">
        {title}
      </text>
      {rows.map((r, i) => (
        <g key={r.label}>
          {r.color && (
            <rect x={left + 10} y={33 + i * 16} width={8} height={3} rx={1.5} fill={r.color} />
          )}
          <text
            x={left + (r.color ? 23 : 10)}
            y={38 + i * 16}
            fontSize={12}
            fill="var(--text-secondary)"
          >
            {r.label}
          </text>
          <text
            x={left + w - 10}
            y={38 + i * 16}
            fontSize={12}
            textAnchor="end"
            fill="var(--text-primary)"
            fontFamily="var(--mono)"
            fontWeight={600}
          >
            {r.value}
          </text>
        </g>
      ))}
    </g>
  );
}
