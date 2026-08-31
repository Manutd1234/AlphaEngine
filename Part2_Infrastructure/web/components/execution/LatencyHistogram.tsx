"use client";

/**
 * Distribution of gate-decision latency.
 *
 * A p50 and a p99 describe two points; the shape between them is where a
 * bimodal gate battery or a long tail actually shows up. Bars, not a line —
 * these are counts per bin, and a line between bin centres would imply a
 * continuum the histogram is deliberately discretising.
 *
 * Below the sample floor it renders the count instead of a chart. The same
 * discipline the header's p99 chip applies: a distribution over a handful of
 * decisions is a picture of nothing.
 */

import { useState } from "react";

import { linearScale } from "@/components/chart-kit";
import { fmt, metricRow } from "@/lib/format";
import { LATENCY_MIN_SAMPLES } from "@/lib/overview-state";
import { histogramBins } from "@/lib/stats";

export function histogramIndexAt(
  clientX: number,
  left: number,
  width: number,
  count: number,
): number | null {
  if (!Number.isFinite(clientX) || !Number.isFinite(left) || !Number.isFinite(width)
      || !Number.isFinite(count) || width <= 0 || count <= 0) return null;
  const fraction = Math.min(1, Math.max(0, (clientX - left) / width));
  return Math.min(count - 1, Math.floor(fraction * count));
}

export default function LatencyHistogram({
  values,
  binCount = 12,
  width = 320,
  height = 112,
  ariaLabel,
  minSamples = LATENCY_MIN_SAMPLES,
  unit = "ms",
  unitLong = "milliseconds",
  noun = "decisions",
  format,
  variant = "latency",
}: {
  values: number[];
  binCount?: number;
  width?: number;
  height?: number;
  ariaLabel: string;
  minSamples?: number;
  /**
   * The three strings that were "ms" / "milliseconds" / "decisions" inline.
   * Defaulted so every existing call site is unchanged; supplied so the same
   * bin-and-draw can plot the effective-spread distribution in bps rather than
   * a second component that would drift from this one.
   */
  unit?: string;
  unitLong?: string;
  noun?: string;
  /** Visually separates timing from execution-cost distributions. */
  variant?: "latency" | "spread";
  /**
   * Formats an axis label from a raw value. When supplied it carries its own
   * unit (e.g. `formatDuration(v, "ms")` → "210 µs"), so `unit`/`unitLong`
   * are not appended; the gate-latency caller uses this so a 0.21 ms decision
   * reads as 210 µs rather than 0.21.
   */
  format?: (value: number) => string;
}) {
  const [walked, setWalked] = useState<number | null>(null);
  const [pointed, setPointed] = useState<number | null>(null);
  const usable = values.filter((v) => Number.isFinite(v));
  const label = format ?? ((v: number) => `${fmt(v, 2)} ${unit}`);
  const labelLong = format ?? ((v: number) => `${fmt(v, 2)} ${unitLong}`);
  if (usable.length < minSamples) {
    return (
      <p className="muted" style={{ fontSize: "var(--fs-body)" }}>
        collecting samples, n={usable.length} of {minSamples}
      </p>
    );
  }

  const bins = histogramBins(usable, binCount);
  if (!bins) return null;

  const lo = bins.edges[0];
  const hi = bins.edges[bins.edges.length - 1];
  const peak = Math.max(...bins.counts, 1);
  const barW = width / bins.counts.length;
  const y = linearScale(0, peak, height, 0);
  const cumulative = bins.counts.reduce<number[]>((running, count) => {
    running.push((running[running.length - 1] ?? 0) + count);
    return running;
  }, []);
  const cdfY = (count: number) => height - 2 - (count / usable.length) * (height - 4);
  const cdfPoints = cumulative.map((count, i) => `${(i + 0.5) * barW},${cdfY(count)}`).join(" ");
  const requested = pointed ?? walked;
  const active = requested === null
    ? null
    : Math.min(bins.counts.length - 1, Math.max(0, requested));
  const peakIndex = bins.counts.indexOf(peak);
  const distributionLabel = format
    ? `${ariaLabel} — ${usable.length} ${noun} between ${labelLong(lo)} and ${labelLong(hi)}`
    : `${ariaLabel} — ${usable.length} ${noun} between ${fmt(lo, 2)} and ${fmt(hi, 2)} ${unitLong}`;

  const moveKeyboard = (event: React.KeyboardEvent<SVGSVGElement>) => {
    if (event.keyCode === 27) {
      event.preventDefault();
      setWalked(null);
      return;
    }
    const at = walked ?? peakIndex;
    const next = event.keyCode === 36 ? 0
      : event.keyCode === 35 ? bins.counts.length - 1
      : event.keyCode === 37 || event.keyCode === 38 ? Math.max(0, at - 1)
      : event.keyCode === 39 || event.keyCode === 40 ? Math.min(bins.counts.length - 1, at + 1)
      : null;
    if (next !== null) {
      event.preventDefault();
      setWalked(next);
    }
  };

  return (
    <div
      className="latency-histogram protected-chart-instrument"
      data-histogram-variant={variant}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        /* Preserve the chart's native geometry. The distribution cards can be
           much wider than this viewBox on a desk display; stretching only the
           x axis turned bars and the CDF into long horizontal strips. The SVG
           now grows in both directions, so its ends still meet the labels
           below without distorting the plotted shape. */
        preserveAspectRatio="xMidYMid meet"
        style={{ aspectRatio: `${width} / ${height}` }}
        role="img"
        aria-label={active === null
          ? distributionLabel
          : `${distributionLabel}: ${metricRow([
              `${label(bins.edges[active])}–${label(bins.edges[active + 1])}`,
              `${bins.counts[active]} ${noun}`,
            ])}`}
        tabIndex={0}
        onFocus={() => setWalked((at) => at ?? peakIndex)}
        onBlur={() => setWalked(null)}
        onKeyDown={moveKeyboard}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setPointed(histogramIndexAt(event.clientX, rect.left, rect.width, bins.counts.length));
        }}
        onPointerLeave={() => setPointed(null)}
      >
        {[0.25, 0.5, 0.75].map((fraction) => (
          <line
            key={fraction}
            className="latency-histogram__grid"
            x1={0}
            x2={width}
            y1={height * fraction}
            y2={height * fraction}
          />
        ))}
        {bins.counts.map((count, i) => (
          <rect
            key={bins.edges[i]}
            x={i * barW + 0.5}
            y={y(count)}
            width={Math.max(1, barW - 1)}
            height={Math.max(count > 0 ? 1 : 0, height - y(count))}
            fill="var(--latency-histogram-bar, var(--series-1))"
            opacity={0.88}
            rx={2}
            data-linked={active === i ? "true" : undefined}
          >
            <title>
              {metricRow([
                `${label(bins.edges[i])}–${label(bins.edges[i + 1])}`,
                `${count} ${noun}`,
              ])}
            </title>
          </rect>
        ))}
        <polyline className="latency-cdf" points={cdfPoints} />
        {active !== null && (
          <circle
            className="latency-cdf__reading"
            cx={(active + 0.5) * barW}
            cy={cdfY(cumulative[active])}
            r={2.5}
          />
        )}
      </svg>
      {active !== null && (
        <output className="protected-chart-output num" aria-live="polite">
          {metricRow([
            `${label(bins.edges[active])}–${label(bins.edges[active + 1])}`,
            `${bins.counts[active]} ${noun}`,
          ])}
        </output>
      )}
      <div
        className="muted num"
        style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--fs-2xs)" }}
      >
        <span>{label(lo)}</span>
        <span>{label(hi)}</span>
      </div>
    </div>
  );
}
