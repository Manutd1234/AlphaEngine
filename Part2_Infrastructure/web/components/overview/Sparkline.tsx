"use client";

/**
 * Micro-sparkline for stat tiles — the one chart in the app allowed to omit
 * axes, grid and hover, because the tile's own number *is* the label and the
 * last value rides in the aria-label. Everything else follows the house chart
 * doctrine: hand-rolled SVG on chart-kit's scales, no library.
 */

import { areaPath, extent, linePath, linearScale } from "@/components/chart-kit";

const TONE_COLOR: Record<string, string> = {
  accent: "var(--series-1)",
  good: "var(--status-good)",
  warn: "var(--status-warning)",
  critical: "var(--status-critical)",
  muted: "var(--axis)",
};

export default function Sparkline({
  points,
  width = 120,
  height = 36,
  variant = "line",
  tone = "accent",
  ariaLabel,
  strokeWidth = 1.75,
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
}) {
  const finite = points.filter((v) => Number.isFinite(v));
  if (finite.length < 2) return null;

  const pad = 3;
  const xScale = linearScale(0, finite.length - 1, pad, width - pad);
  const [lo, hi] = extent(finite);
  const yScale = linearScale(lo, hi, height - pad, pad);
  const coords = finite.map((v, i) => ({ x: xScale(i), y: yScale(v) }));
  const color = TONE_COLOR[tone] ?? TONE_COLOR.accent;
  const last = coords[coords.length - 1];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={ariaLabel}
      /* `shrink-0` meant this kept its full 96px however little room the tile
         had, and pushed itself out through the card's right border. It may now
         give ground: the viewBox scales uniformly (the default xMidYMid meet),
         so a narrower slot yields a smaller sparkline rather than a distorted
         one or a broken card. */
      className="block min-w-0 max-w-full shrink"
    >
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
    </svg>
  );
}
