"use client";

/**
 * The makers' answers drawn on the dollar, one strip per market.
 *
 * Added 2026-08-24 on the reported complaint that some sections carry no
 * diagram at all. Dispersion was the one view on the engine that was tables end
 * to end, and its subject is the most drawable thing on the tab: several
 * professionals pricing one event independently, and the distance between
 * their answers. A twelve-column table states that distance; this shows it,
 * on the same $0-to-$1 axis every strip shares, so the market the makers
 * disagree about most is the widest thing on screen rather than the largest
 * number in column six.
 *
 * What it draws is only what the table's Lowest-to-highest and Median columns
 * already state — deliberately. The figure ranks, the table proves, and a
 * reader checks one against the other without either claiming a quantity the
 * read did not produce. Everything else the table alone carries: usable
 * counts, crossed quotes, one maker's own width, the combo band columns.
 *
 * Drawn only when at least one market has both ends of a range. A market with
 * fewer than two usable quotes has no strip, is counted in the figure's
 * `missing` line, and keeps its row in the table below — dashes and all —
 * because an absent range is a fact about the panel, not a reason to hide the
 * market.
 *
 * The classes are the band figure's own (`coh-combo__track/band/price/label/
 * axis`), borrowed the way ShellTree borrows `coh-ablation__value`: same
 * drawing role — a dollar track, a range on it, a marker — so the same rung
 * and the same ink, with no second declaration for `rung-single-declaration`
 * to fail. Nothing here says anything in colour alone: the band is a shape
 * with its ends labelled by the strip's own text row, and the median is a
 * mark, not a hue.
 */

import { DOLLAR_CC, fromCenticents, priceLabel, toCenticents } from "@/lib/coherence/fixed-point";
import type { CoherenceDispersion } from "@/lib/coherence/types-lab";
import Figure, { Plot } from "./Figure";

/** One strip: label line, track, band, median mark. */
const ROW_H = 46;
const TRACK_H = 12;
const TOP = 4;
const AXIS_GAP = 10;
const AXIS_LABEL_DROP = 14;

interface Strip {
  ticker: string;
  lo: number;
  hi: number;
  median: number | null;
  spread: string | null;
}

export default function DispersionStrips({ rows }: { rows: CoherenceDispersion[] }) {
  const strips: Strip[] = [];
  let undrawn = 0;
  for (const row of rows) {
    const lo = toCenticents(row.lowest);
    const hi = toCenticents(row.highest);
    if (lo == null || hi == null) {
      undrawn += 1;
      continue;
    }
    strips.push({
      ticker: row.market_ticker,
      lo,
      hi,
      median: toCenticents(row.median),
      spread: row.spread,
    });
  }

  // Nothing drawable at all: every market kept its table row, and the table's
  // own dashes say why per market. A bordered plot whose entire content is
  // "nothing to draw" above that table is the empty-figure defect the
  // certificate section already removed once, so it is not re-made here.
  if (!strips.length) return null;

  const widest = strips.reduce((best, strip) => (strip.hi - strip.lo > best.hi - best.lo ? strip : best), strips[0]);
  const axisY = TOP + strips.length * ROW_H + AXIS_GAP;
  const height = axisY + AXIS_LABEL_DROP + 4;

  return (
    <Figure
      caption="Where the makers' answers sit on the dollar"
      ariaLabel={`${strips.length} market${strips.length === 1 ? "" : "s"}: lowest-to-highest maker quotes on a $0-to-$1 axis, median marked`}
      reading={
        // THE TERNARY WAS INVERTED UNTIL 2026-08-25, so this figure was silent
        // in exactly the case it exists for. `widest.hi > widest.lo` is true
        // when there IS a range to describe, and that branch returned null; the
        // sentence about panels agreeing to the tick — the DEGENERATE case —
        // was the only reading ever drawn. A reader saw a figure of ranked
        // ranges with no reading, or a reading claiming unanimity underneath
        // strips that were plainly not unanimous, depending on the read.
        widest.hi > widest.lo
          // The distinction between this spread and one maker's own bid-offer
          // is made ONCE, in the table's caption below, and `prices-claims`
          // pins it at one site. Restating it here would be the same claim
          // twice on one view — which is the reading this tab was reported for.
          ? `The widest disagreement is on ${widest.ticker}, ${fromCenticents(widest.lo)} to `
            + `${fromCenticents(widest.hi)}: that is how far apart independent makers priced one `
            + "event, before any of them is called right."
          : "Every panel here agrees to the tick, so each strip collapses to a single mark."
      }
      missing={
        undrawn
          ? `${undrawn} of ${rows.length} markets have no strip: fewer than two usable quotes leaves no range; they stay in the table.`
          : null
      }
    >
      <Plot height={height}>
        {(width) => {
          const x = (cc: number) => (cc / DOLLAR_CC) * width;
          return (
            <>
              {strips.map((strip, index) => {
                const y = TOP + index * ROW_H;
                return (
                  <g key={strip.ticker}>
                    <text x={0} y={y + 10} className="coh-combo__label">
                      {strip.ticker}
                    </text>
                    {strip.spread != null ? (
                      <text x={width} y={y + 10} textAnchor="end" className="coh-combo__label">
                        {`spread ${priceLabel(strip.spread)}`}
                      </text>
                    ) : null}
                    <rect x={0} y={y + 16} width={width} height={TRACK_H} className="coh-combo__track" />
                    <rect
                      x={x(strip.lo)}
                      y={y + 16}
                      width={Math.max(1, x(strip.hi) - x(strip.lo))}
                      height={TRACK_H}
                      className="coh-combo__band"
                    >
                      <title>{`${strip.ticker}: quoted ${fromCenticents(strip.lo)} to ${fromCenticents(strip.hi)}`}</title>
                    </rect>
                    {strip.median != null ? (
                      <line
                        x1={x(strip.median)}
                        x2={x(strip.median)}
                        y1={y + 13}
                        y2={y + 16 + TRACK_H + 3}
                        className="coh-combo__price"
                      >
                        <title>{`median ${fromCenticents(strip.median)}`}</title>
                      </line>
                    ) : null}
                  </g>
                );
              })}
              <line x1={0} x2={width} y1={axisY} y2={axisY} className="coh-ladder__axis" />
              <text x={0} y={axisY + AXIS_LABEL_DROP} textAnchor="start" className="coh-combo__axis">
                $0
              </text>
              <text x={width} y={axisY + AXIS_LABEL_DROP} textAnchor="end" className="coh-combo__axis">
                $1
              </text>
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}
