"use client";

/**
 * The VaR backtest as one cell per bar: how far each day's loss reached into
 * its forecast, and whether the breaches clustered.
 *
 * THE BAND CHART BESIDE THIS ANSWERS A DIFFERENT QUESTION. `VarBacktestChart`
 * draws the forecast against realised P&L and shows whether the model was
 * tight. A model is JUDGED on something the band cannot show: did breaches
 * happen at the rate the confidence promised, and were they spread or bunched.
 * Kupiec scores the count only — three breaches in one week and three across a
 * quarter score identically — so this is the figure for the half of the
 * verdict the scorecard is silent on.
 *
 * THE REFERENCE IS THE FORECAST ITSELF, at ratio 1.0. Every bar is measured
 * against it: a cell at 0.4 lost forty per cent of what the model allowed for,
 * a cell above the line is a breach. Painted under the marks by `Plot`, and
 * labelled, so it is checkable and never colour-only.
 *
 * `sharedX`, because bars are uniformly spaced — grammar rule 7 — and the
 * question at any bar is "what were ALL of these, then", which a per-mark
 * readout answers one fact at a time and this answers in one card.
 *
 * Colour never carries the breach alone: a breached cell also carries the
 * `▲` in its title and a hatched fill, which is what survives Windows High
 * Contrast where two fills collapse to one.
 */

import Figure, { Plot } from "@/components/coherence/Figure";
import { linearScale } from "@/components/chart-kit";
import { shortDate, usd } from "@/lib/format";
import { clusteringReading, exceedanceCells } from "@/lib/portfolio-risk/exceedance";
import type { VarBacktest, VarSeries } from "@/lib/portfolio-risk/var-validation";

const HEIGHT = 168;
const MARGIN = { top: 14, right: 16, bottom: 28, left: 46 };

export default function ExceedanceCalendar({ series, validation }: {
  series: VarSeries;
  validation: VarBacktest | null;
}) {
  const summary = exceedanceCells(series.points);
  const { cells } = summary;
  const dated = series.timesAligned && cells.every((c) => c.t !== null);
  const stamp = (c: (typeof cells)[number]) => (c.t === null || !dated ? `bar ${c.index}` : shortDate(c.t));

  // The domain is the forecast's own units: 1.0 is the line, and the top is
  // the worst breach or 1.5, whichever is higher, so a clean series still
  // shows the line with room above it rather than the line pinned to the top.
  const worst = Math.max(1.5, ...cells.map((c) => c.ratio ?? 0));
  const y0 = HEIGHT - MARGIN.bottom;
  const y1 = MARGIN.top;
  const yScale = linearScale(0, worst, y0, y1);
  const x0 = MARGIN.left;

  const expected = validation ? validation.expectedExceptions : null;
  const reading = `${clusteringReading(summary)}${expected !== null ? ` The model expected ${expected.toFixed(1)}.` : ""}`;

  return (
    <Figure
      caption={`Each bar's loss against its own 95% forecast, ${summary.scored} bars`}
      ariaLabel={`Value-at-risk exceedance calendar over ${cells.length} bars: ${summary.breaches} breaches, longest run ${summary.longestRun}.`}
      reading={reading}
      missing={summary.withheld > 0
        ? `${summary.withheld} of ${cells.length} bars carried no forecast and are withheld — neither a breach nor a clear day.`
        : validation ? null : "No Kupiec validation for this window, so the breach count has no expected count to be judged against."}
    >
      <Plot
        height={HEIGHT}
        reference={(width) => ({
          y: yScale(1),
          x0,
          x1: Math.max(x0 + 1, width - MARGIN.right),
          label: "the forecast — above this line is a breach",
        })}
        sharedX={(width) => {
          const x1 = Math.max(x0 + 10, width - MARGIN.right);
          return {
            count: cells.length,
            x0,
            x1,
            width: 200,
            arriveAt: "first" as const,
            read: (index) => {
              const c = cells[index];
              const p = series.points[index];
              return {
                title: stamp(c),
                rows: c.ratio === null
                  ? [{ label: "Forecast", value: "withheld" }, { label: "Why", value: c.withheld ?? "" }]
                  : [
                      { label: "Loss", value: usd(Math.max(0, -p.pnl), 0) },
                      { label: "Forecast", value: usd(p.var95, 0) },
                      { label: "Ratio", value: c.ratio.toFixed(2) },
                      { label: "Breach", value: c.breach ? "▲ yes" : "no" },
                    ],
              };
            },
          };
        }}
      >
        {(width) => {
          const x1 = Math.max(x0 + 10, width - MARGIN.right);
          const slot = (x1 - x0) / Math.max(1, cells.length);
          const barW = Math.max(1, slot - 1);
          return (
            <>
              {cells.map((c, i) => {
                const x = x0 + i * slot;
                if (c.ratio === null) {
                  return (
                    <rect key={c.index} x={x} y={y1} width={barW} height={y0 - y1} fill="url(#diff-hatch)" opacity={0.5}>
                      <title>{`${stamp(c)}: withheld — ${c.withheld}`}</title>
                    </rect>
                  );
                }
                const top = yScale(c.ratio);
                return (
                  <rect
                    key={c.index}
                    x={x}
                    y={top}
                    width={barW}
                    height={Math.max(1, y0 - top)}
                    fill={c.breach ? "url(#diff-hatch)" : "var(--series-1)"}
                    stroke={c.breach ? "var(--critical-text)" : undefined}
                    strokeWidth={c.breach ? 1 : undefined}
                    opacity={c.breach ? 1 : 0.7}
                    rx={1}
                  >
                    <title>{`${stamp(c)}: ${c.ratio.toFixed(2)} of forecast${c.breach ? " ▲ breach" : ""}`}</title>
                  </rect>
                );
              })}
              {summary.longestRunAt !== null && summary.longestRun > 1 ? (
                // The run, bracketed: the one thing the count cannot show.
                <line
                  x1={x0 + summary.longestRunAt * slot}
                  x2={x0 + (summary.longestRunAt + summary.longestRun) * slot - 1}
                  y1={y0 + 6}
                  y2={y0 + 6}
                  stroke="var(--critical-text)"
                  strokeWidth={2}
                >
                  <title>{`${summary.longestRun} consecutive breaches, starting ${stamp(cells[summary.longestRunAt])}`}</title>
                </line>
              ) : null}
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}
