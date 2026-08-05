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

import { linearScale } from "@/components/chart-kit";
import { fmt } from "@/lib/format";
import { LATENCY_MIN_SAMPLES } from "@/lib/overview-state";
import { histogramBins } from "@/lib/stats";

export default function LatencyHistogram({
  values,
  binCount = 12,
  width = 320,
  height = 64,
  ariaLabel,
  minSamples = LATENCY_MIN_SAMPLES,
}: {
  values: number[];
  binCount?: number;
  width?: number;
  height?: number;
  ariaLabel: string;
  minSamples?: number;
}) {
  const usable = values.filter((v) => Number.isFinite(v));
  if (usable.length < minSamples) {
    return (
      <p className="muted" style={{ fontSize: 11.5 }}>
        collecting samples · n={usable.length} of {minSamples}
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

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        /* Stretch to the container instead of letter-boxing: the min/max
           labels sit at the container's edges, so bars centred in a default
           "meet" fit would misreport where the range starts and ends. Only
           the x scale stretches — viewport and viewBox heights match. */
        preserveAspectRatio="none"
        role="img"
        aria-label={`${ariaLabel} — ${usable.length} decisions between ${fmt(lo, 2)} and ${fmt(hi, 2)} milliseconds`}
      >
        {bins.counts.map((count, i) => (
          <rect
            key={bins.edges[i]}
            x={i * barW + 0.5}
            y={y(count)}
            width={Math.max(1, barW - 1)}
            height={Math.max(count > 0 ? 1 : 0, height - y(count))}
            fill="var(--series-1)"
            opacity={0.75}
            rx={1}
          />
        ))}
      </svg>
      <div
        className="muted num"
        style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}
      >
        <span>{fmt(lo, 2)} ms</span>
        <span>{fmt(hi, 2)} ms</span>
      </div>
    </div>
  );
}
