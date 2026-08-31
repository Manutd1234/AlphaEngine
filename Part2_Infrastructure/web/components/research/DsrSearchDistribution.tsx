"use client";

/**
 * The multiple-testing search that the selected winner's DSR pays for.
 *
 * `SweepResponse` publishes one DSR probability for the selected winner, not a
 * DSR per candidate. The honest distribution available on the wire is the
 * empirical set of candidate Sharpes. This figure draws that set, the expected
 * maximum under random search, and the selected winner; it never relabels those
 * Sharpes as a distribution of DSR probabilities.
 */

import { Grid, linearScale, ticks } from "@/components/chart-kit";
import Figure, { Plot } from "@/components/coherence/Figure";
import { fmt } from "@/lib/format";
import { histogramBins } from "@/lib/stats";
import type { SweepResponse } from "@/lib/types";

export function dsrSearchView(data: Pick<
  SweepResponse,
  "results" | "best" | "expectedMaxSharpe" | "deflatedSharpeRatio"
>) {
  const sharpes = data.results.map((result) => result.sharpe).filter(Number.isFinite);
  const bins = histogramBins(sharpes, Math.min(12, Math.max(4, Math.ceil(Math.sqrt(sharpes.length)))));
  if (!bins || !Number.isFinite(data.expectedMaxSharpe) || !Number.isFinite(data.best.sharpe)) return null;
  const lo = Math.min(bins.edges[0], data.expectedMaxSharpe, data.best.sharpe);
  const hi = Math.max(bins.edges[bins.edges.length - 1], data.expectedMaxSharpe, data.best.sharpe);
  return {
    sharpes,
    bins,
    lo,
    hi: hi === lo ? lo + 1 : hi,
    clears: sharpes.filter((sharpe) => sharpe > data.expectedMaxSharpe).length,
    selectedClears: data.best.sharpe > data.expectedMaxSharpe,
  };
}

export default function DsrSearchDistribution({ data }: { data: SweepResponse }) {
  const view = dsrSearchView(data);
  if (!view) {
    return <p className="muted">Search distribution withheld: no finite candidate Sharpe grid was returned.</p>;
  }
  const height = 190;
  const margin = { top: 16, right: 16, bottom: 30, left: 34 };
  const peak = Math.max(...view.bins.counts, 1);

  return (
    <div className="dsr-search-distribution">
      <Figure
        caption="Candidate Sharpe search distribution"
        ariaLabel={`${view.sharpes.length} tested candidate Sharpes, selected Sharpe ${fmt(data.best.sharpe, 2)}, random-search hurdle ${fmt(data.expectedMaxSharpe, 2)}, selected-winner DSR ${fmt(data.deflatedSharpeRatio, 3)}`}
        reading={`${view.clears} of ${view.sharpes.length} candidates clear the random-search hurdle. DSR ${fmt(data.deflatedSharpeRatio, 3)} belongs only to the selected winner after that search.`}
      >
        <Plot height={height}>
          {(width) => {
            const x0 = margin.left;
            const x1 = Math.max(x0 + 40, width - margin.right);
            const baseline = height - margin.bottom;
            const x = linearScale(view.lo, view.hi, x0, x1);
            const y = linearScale(0, peak, baseline, margin.top);
            return (
              <>
                <Grid yTicks={ticks(0, peak, 3)} yScale={y} x0={x0} x1={x1} format={(value) => String(Math.round(value))} />
                {view.bins.counts.map((count, index) => {
                  const left = x(view.bins.edges[index]);
                  const right = x(view.bins.edges[index + 1] ?? view.hi);
                  return (
                    <rect
                      key={`${view.bins.edges[index]}-${index}`}
                      x={left + 0.5}
                      y={y(count)}
                      width={Math.max(1, right - left - 1)}
                      height={Math.max(count > 0 ? 1 : 0, baseline - y(count))}
                      fill="var(--series-1)"
                      opacity={0.72}
                    >
                      <title>{`Sharpe ${fmt(view.bins.edges[index], 2)} to ${fmt(view.bins.edges[index + 1] ?? view.hi, 2)}: ${count} candidates`}</title>
                    </rect>
                  );
                })}
                <line
                  x1={x(data.expectedMaxSharpe)} x2={x(data.expectedMaxSharpe)}
                  y1={margin.top} y2={baseline}
                  stroke="var(--warning-text)" strokeWidth={1.5} strokeDasharray="4 3"
                >
                  <title>{`Expected maximum from random search: Sharpe ${fmt(data.expectedMaxSharpe, 2)}`}</title>
                </line>
                <line
                  x1={x(data.best.sharpe)} x2={x(data.best.sharpe)}
                  y1={margin.top} y2={baseline}
                  stroke="var(--text-primary)" strokeWidth={2}
                >
                  <title>{`Selected winner: Sharpe ${fmt(data.best.sharpe, 2)}, DSR ${fmt(data.deflatedSharpeRatio, 3)}`}</title>
                </line>
                {[view.lo, view.hi].map((value, index) => (
                  <text
                    key={index}
                    x={index ? x1 : x0}
                    y={height - 8}
                    textAnchor={index ? "end" : "start"}
                    fontFamily="var(--mono)" fontSize={12} fill="var(--text-muted)"
                  >
                    {fmt(value, 2)}
                  </text>
                ))}
              </>
            );
          }}
        </Plot>
      </Figure>
      <div className="legend">
        <span><i aria-hidden style={{ background: "var(--series-1)" }} /> candidate Sharpes</span>
        <span><i aria-hidden style={{ background: "var(--warning-text)" }} /> expected random-search maximum</span>
        <span><i aria-hidden style={{ background: "var(--text-primary)" }} /> selected winner</span>
      </div>
    </div>
  );
}
