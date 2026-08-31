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

import { linearScale } from "@/components/chart-kit";
import Figure, { Plot } from "@/components/coherence/Figure";
import { mcUsd } from "@/components/risk/mc-degeneracy";
import { mcLossConfidences, type McDistributionResult } from "@/lib/mc-distribution";

export default function McHistogram({ result }: { result: McDistributionResult }) {
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
  // The "not measured yet" branch is gone with the measurement: `Plot` owns the
  // width and falls back to its own until the observer fires, so this no longer
  // renders an empty div on the first paint and then swaps it for a chart.

  const lo = bins.edges[0];
  const hi = bins.edges[bins.edges.length - 1];
  const peak = Math.max(...bins.counts, 1);
  const y = linearScale(0, peak, height, 0);

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
    <div className="mc-histogram">
      {/* Through `Figure` and `Plot` since 2026-08-26. The bars had no `<title>`
          at all, so a reader could see the distribution's SHAPE and could not
          get a single number off it by any means but a mouse hover that showed
          nothing. Each bin now carries its own count and range, which is what
          `Plot` walks. */}
      <Figure
        caption={`Terminal P&L over ${result.paths.toLocaleString()} paths`}
        ariaLabel={`Terminal P&L distribution of ${result.paths.toLocaleString()} paths between ${mcUsd(lo)} and ${mcUsd(hi)}, with P${c50}, P${c95} and P${c99} loss markers`}
        reading="Everything left of break-even ended in loss; the three markers are the loss bands, and they move with the confidences rather than sitting on a median nobody asked about."
      >
        <Plot height={height + 18}>
          {(measured) => {
            const x = linearScale(lo, hi, 0, measured);
            const barW = measured / bins.counts.length;
            return (
              <>
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
          >
            {/* The number the shape was hiding. Without this the histogram is a
                silhouette: a reader can see where the mass sits and cannot get
                one figure off it. */}
            <title>{`${mcUsd(bins.edges[i])} to ${mcUsd(bins.edges[i + 1] ?? hi)}: ${count.toLocaleString()} of ${result.paths.toLocaleString()} paths`}</title>
          </rect>
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
              fontSize={12}
              fill={marker.mildest ? "var(--text-muted)" : "var(--critical-text)"}
            >
              {marker.label}
            </text>
          </g>
        ))}
              </>
            );
          }}
        </Plot>
        <dl className="mc-histogram__scale muted num" aria-label="Terminal outcome range">
          <div>
            <dt>Worst outcome</dt>
            <dd>{mcUsd(lo)}</dd>
          </div>
          <div>
            <dt>Break-even</dt>
            <dd>$0</dd>
          </div>
          <div>
            <dt>Best outcome</dt>
            <dd>{mcUsd(hi)}</dd>
          </div>
        </dl>
      </Figure>
    </div>
  );
}
