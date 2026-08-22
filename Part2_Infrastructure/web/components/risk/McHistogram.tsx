"use client";

/**
 * The terminal P&L histogram and its loss markers.
 *
 * Split out of `MonteCarloDistribution` when the simulation's parameters
 * became controls: the card was carrying a chart, five inputs and the result
 * copy in one file. Nothing here decides anything — every label is read from
 * the result it is drawing, which is what stops a marker printing "P95" over a
 * figure computed at some other confidence.
 */

import { linearScale, useMeasuredWidth } from "@/components/chart-kit";
import { usd } from "@/lib/format";
import { mcLossConfidences, type McDistributionResult } from "@/lib/mc-distribution";

export default function McHistogram({ result }: { result: McDistributionResult }) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  const height = 180;
  const bins = result.histogram;
  // Two silences, two returns. `width === 0` is the measuring pass: the ref
  // div is what gets measured and the chart draws a frame later. A null
  // histogram is not a pass but a result — `mc-distribution.ts` returns null
  // when no path ended at a finite P&L — and the tiles beside it have already
  // rendered, so the shared blank return read as a chart that never arrived
  // rather than one there was nothing to draw.
  if (!bins) {
    return <p className="sub">No histogram: no path ended at a finite P&amp;L.</p>;
  }
  if (width === 0) return <div ref={ref} />;

  const lo = bins.edges[0];
  const hi = bins.edges[bins.edges.length - 1];
  const peak = Math.max(...bins.counts, 1);
  const x = linearScale(lo, hi, 0, width);
  const y = linearScale(0, peak, height, 0);
  const barW = width / bins.counts.length;

  // Labels come from the RESULT, never from a constant. With tail bands
  // selected these are 90/99/99.9, and printing a 99.9 % loss under a "P99"
  // label would be a figure wearing the wrong name — which is worse than not
  // offering the choice at all.
  // All three markers read the loss bands, including the mildest. At the
  // default confidences the first is the median exactly — `loss.p50` is the
  // 50th percentile negated — so this draws where it always did; at 90/99/99.9
  // it moves with the band instead of staying on a median nobody asked about.
  const [c50, c95, c99] = mcLossConfidences(result);
  const markers = [
    { label: `P${c50}`, value: -result.loss.p50, mildest: true },
    { label: `P${c95}`, value: -result.loss.p95, mildest: false },
    { label: `P${c99}`, value: -result.loss.p99, mildest: false },
  ];

  return (
    <div ref={ref}>
      <svg
        viewBox={`0 0 ${width} ${height + 18}`}
        width="100%"
        height={height + 18}
        role="img"
        aria-label={`Terminal P&L distribution of ${result.paths.toLocaleString()} paths between ${usd(lo, 0)} and ${usd(hi, 0)}, with P${c50}, P${c95} and P${c99} loss markers`}
      >
        {bins.counts.map((count, i) => (
          <rect
            key={bins.edges[i]}
            x={i * barW + 0.5}
            y={y(count)}
            width={Math.max(1, barW - 1)}
            height={Math.max(count > 0 ? 1 : 0, height - y(count))}
            fill="var(--series-1)"
            opacity={0.7}
            rx={1}
          />
        ))}
        {/* Break-even line: everything left of it ended in loss. */}
        <line x1={x(0)} x2={x(0)} y1={0} y2={height} stroke="var(--axis)" strokeDasharray="2 3" />
        {markers.map((marker) => (
          <g key={marker.label}>
            <line
              x1={x(marker.value)}
              x2={x(marker.value)}
              y1={10}
              y2={height}
              stroke={marker.mildest ? "var(--text-muted)" : "var(--critical-text)"}
              strokeWidth={marker.mildest ? 1 : 1.25}
            />
            <text
              x={x(marker.value)}
              y={height + 14}
              textAnchor="middle"
              fontSize={10}
              fill={marker.mildest ? "var(--text-muted)" : "var(--critical-text)"}
            >
              {marker.label}
            </text>
          </g>
        ))}
      </svg>
      <div
        className="muted num"
        style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--fs-2xs)" }}
      >
        <span>{usd(lo, 0)}</span>
        <span>break-even at $0</span>
        <span>{usd(hi, 0)}</span>
      </div>
    </div>
  );
}
