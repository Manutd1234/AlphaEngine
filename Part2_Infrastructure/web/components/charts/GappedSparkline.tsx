"use client";

/**
 * A sparkline where absence keeps its width.
 *
 * `components/overview/Sparkline.tsx` cannot be reused for this and the reason
 * is one line of it: `points.filter(Number.isFinite)`. That drops the nulls and
 * draws the survivors evenly spaced, so a four-minute hole in a feed CLOSES —
 * the line reads as continuous coverage at a slightly different slope, which is
 * the opposite of what a freshness chart exists to show. Its filter is correct
 * for its own callers, which pass dense series; changing it would silently
 * change KpiDeck and WorkspaceOverview.
 *
 * So this plots against the index rather than against the finite values, and
 * hands the whole array to `linePath`, which breaks at nulls rather than
 * bridging them. A gap is drawn as a gap and occupies the time it actually took.
 */

import { extent, linePath, linearScale } from "@/components/chart-kit";

const TONE: Record<string, string> = {
  accent: "var(--series-1)",
  good: "var(--status-good)",
  warn: "var(--status-warning)",
  critical: "var(--status-critical)",
  muted: "var(--axis)",
};

export default function GappedSparkline({
  points,
  width = 128,
  height = 32,
  tone = "accent",
  ariaLabel,
  emptyNote,
}: {
  /** `null` is an absence and is never bridged. */
  points: Array<number | null>;
  width?: number;
  height?: number;
  tone?: keyof typeof TONE | string;
  ariaLabel: string;
  emptyNote: string;
}) {
  const finite = points.filter((v): v is number => v != null && Number.isFinite(v));

  // Two points is the minimum that can carry a direction. Below it, say so
  // rather than draw a flat line at the axis, which would read as a measured
  // zero.
  if (finite.length < 2) return <span className="muted spark-empty">{emptyNote}</span>;

  const [lo, hi] = extent(finite);
  const x = linearScale(0, Math.max(1, points.length - 1), 1, width - 1);
  const y = linearScale(lo, hi, height - 2, 2);
  const stroke = TONE[tone] ?? tone;

  const gaps = points.length - finite.length;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${ariaLabel} — last ${finite[finite.length - 1].toFixed(0)}ms${
        gaps ? `, ${gaps} of ${points.length} intervals with too little traffic to measure` : ""
      }`}
    >
      <path
        d={linePath(points.map((value, index) => ({ x: x(index), y: value == null ? null : y(value) })))}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </svg>
  );
}
