"use client";

/**
 * Micro-sparkline for stat tiles — the one chart in the app allowed to omit
 * axes, grid and hover, because the tile's own number *is* the label and the
 * last value rides in the aria-label. Everything else follows the house chart
 * doctrine: hand-rolled SVG on chart-kit's scales, no library.
 */

import { useState } from "react";

import { areaPath, extent, linePath, linearScale } from "@/components/chart-kit";

const TONE_COLOR: Record<string, string> = {
  accent: "var(--series-1)",
  good: "var(--status-good)",
  warn: "var(--status-warning)",
  critical: "var(--status-critical)",
  muted: "var(--axis)",
};

export function sparklineIndexAt(
  clientX: number,
  left: number,
  width: number,
  count: number,
): number | null {
  if (!Number.isFinite(clientX) || !Number.isFinite(left) || !Number.isFinite(width)
      || !Number.isFinite(count) || width <= 0 || count <= 0) return null;
  const fraction = Math.min(1, Math.max(0, (clientX - left) / width));
  return Math.round(fraction * Math.max(0, count - 1));
}

export default function Sparkline({
  points,
  width = 120,
  height = 36,
  variant = "line",
  tone = "accent",
  ariaLabel,
  strokeWidth = 1.75,
  interactive = false,
}: {
  points: number[];
  width?: number;
  height?: number;
  variant?: "line" | "area";
  /** `accent` carries identity; status tones only when the tile's words
   *  already state the status — colour never carries meaning alone. */
  tone?: "accent" | "good" | "warn" | "critical" | "muted";
  ariaLabel: string;
  strokeWidth?: number;
  interactive?: boolean;
}) {
  const [walked, setWalked] = useState<number | null>(null);
  const [pointed, setPointed] = useState<number | null>(null);
  const finite = points.filter((v) => Number.isFinite(v));
  if (finite.length < 2) return null;

  const pad = 3;
  const xScale = linearScale(0, finite.length - 1, pad, width - pad);
  const [lo, hi] = extent(finite);
  const yScale = linearScale(lo, hi, height - pad, pad);
  const coords = finite.map((v, i) => ({ x: xScale(i), y: yScale(v) }));
  const color = TONE_COLOR[tone] ?? TONE_COLOR.accent;
  const last = coords[coords.length - 1];
  const requested = interactive ? pointed ?? walked : null;
  const active = requested === null ? null : Math.min(finite.length - 1, Math.max(0, requested));
  const activePoint = active === null ? null : coords[active];
  const activeValue = active === null ? null : finite[active];

  const movePointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const plotLeft = rect.left + (pad / width) * rect.width;
    const plotWidth = ((width - pad * 2) / width) * rect.width;
    setPointed(sparklineIndexAt(event.clientX, plotLeft, plotWidth, finite.length));
  };

  const moveKeyboard = (event: React.KeyboardEvent<SVGSVGElement>) => {
    if (event.keyCode === 27) {
      event.preventDefault();
      setWalked(null);
      return;
    }
    const at = walked ?? finite.length - 1;
    const next = event.keyCode === 36 ? 0
      : event.keyCode === 35 ? finite.length - 1
      : event.keyCode === 37 || event.keyCode === 38 ? Math.max(0, at - 1)
      : event.keyCode === 39 || event.keyCode === 40 ? Math.min(finite.length - 1, at + 1)
      : null;
    if (next !== null) {
      event.preventDefault();
      setWalked(next);
    }
  };

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={active === null ? ariaLabel : `${ariaLabel}: ${finite[active]}`}
      tabIndex={interactive ? 0 : undefined}
      onFocus={interactive ? () => setWalked((at) => at ?? finite.length - 1) : undefined}
      onBlur={interactive ? () => setWalked(null) : undefined}
      onKeyDown={interactive ? moveKeyboard : undefined}
      onPointerMove={interactive ? movePointer : undefined}
      onPointerLeave={interactive ? () => setPointed(null) : undefined}
      /* `shrink-0` meant this kept its full 96px however little room the tile
         had, and pushed itself out through the card's right border. It may now
         give ground: the viewBox scales uniformly (the default xMidYMid meet),
         so a narrower slot yields a smaller sparkline rather than a distorted
         one or a broken card. */
      className={`${interactive ? "protected-sparkline " : ""}block min-w-0 max-w-full shrink`}
    >
      {activePoint && (
        <rect
          className="protected-chart-range"
          x={Math.min(activePoint.x, last.x)}
          y={pad}
          width={Math.max(1, Math.abs(last.x - activePoint.x))}
          height={height - pad * 2}
          rx={2}
        />
      )}
      {variant === "area" && (
        <path d={areaPath(coords, height - pad)} fill={color} fillOpacity={0.12} />
      )}
      <path
        d={linePath(coords)}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={last.x} cy={last.y} r={2.5} fill={color} />
      {activePoint && (
        <g className="protected-chart-reading" data-linked="true">
          <line x1={activePoint.x} x2={activePoint.x} y1={pad} y2={height - pad} />
          <circle cx={activePoint.x} cy={activePoint.y} r={3.25} fill={color} />
          <text
            x={Math.min(width - 12, Math.max(12, activePoint.x))}
            y={10}
            textAnchor="middle"
          >
            {activeValue?.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </text>
        </g>
      )}
    </svg>
  );
}
