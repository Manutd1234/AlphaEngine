"use client";

/**
 * Every watched family on one axis, against the dollar each of them pays.
 *
 * The section used to open with one `DollarBar` per family and a full outcome
 * table under each — four families and 280 rows of quotes before a reader
 * reached the second heading. That is a fine way to read ONE family and a poor
 * way to read a watchlist, because the question a watchlist raises is
 * comparative: which of these is furthest from a dollar, and is any of them on
 * the wrong side of it?
 *
 * So this draws the comparison and the cards below it draw the detail. One row
 * per family, buy and sell as two marks on a shared $0–$1.30 axis, with the
 * dollar line the only thing that is straight down the middle of the picture.
 *
 * Three decisions, each a way this figure could lie:
 *
 * **The axis is fixed, never scaled to the data** — the same choice `DollarBar`
 * records. Normalising to the maximum makes 1.02 and 0.98 look identical, and
 * the whole point is that they are on opposite sides of a line.
 *
 * **A family with a missing leg gets a row and no mark.** Dropping it would
 * shorten the figure by exactly the families that could not be priced, which
 * reads as a complete picture of a smaller watchlist. The row says which side
 * is unpriceable and why.
 *
 * **A family the exchange does not call mutually exclusive gets a row and no
 * mark either**, marked ○ rather than blank: its prices need not sum to
 * anything, so a total drawn against a dollar would be arithmetic nobody asked
 * for. The exchange's own flag decides that, not our reading of the title.
 */

import { DOLLAR_CC, fromCenticents, sumPrices } from "@/lib/coherence/fixed-point";
import type { CoherenceEventView } from "@/lib/coherence/types";
import Figure, { FigureEmpty, Plot } from "./Figure";

/** Matches `DollarBar`, so a reader moving between the two is not re-scaled. */
const CEILING_CC = 13_000;
const ROW_H = 26;
const TOP = 22;
const BOTTOM = 26;
const LABEL_W = 168;
const MARK_R = 5;

export interface BasketOverviewRow {
  ticker: string;
  label: string;
  mutuallyExclusive: boolean;
  askTotalCc: number | null;
  bidTotalCc: number | null;
}

/** One row per family, in the order the universe returned them. */
export function rowsFor(events: CoherenceEventView[]): BasketOverviewRow[] {
  return events.map((event) => ({
    ticker: event.event_ticker,
    label: event.title || event.event_ticker,
    mutuallyExclusive: event.mutually_exclusive,
    askTotalCc: event.mutually_exclusive ? sumPrices(event.markets.map((m) => m.yes_ask)) : null,
    bidTotalCc: event.mutually_exclusive ? sumPrices(event.markets.map((m) => m.yes_bid)) : null,
  }));
}

/**
 * Trims the MIDDLE, never the tail.
 *
 * Kalshi titles a family by its subject and then by its cut — "BTC price on
 * Aug 24, 2026 at 5pm EDT?" and "… at 12am EDT?" — so the words that tell two
 * rows apart are the last ones. Head-truncation rendered both as "BTC price on
 * Aug 24, 2026…", which is a figure with two identical row labels: measured on
 * the live watchlist, not imagined.
 */
function short(label: string, chars = 30): string {
  if (label.length <= chars) return label;
  const tail = Math.max(10, Math.floor(chars / 2) - 1);
  return `${label.slice(0, chars - tail - 1)}…${label.slice(-tail)}`;
}

export default function BasketOverview({ rows, caption }: { rows: BasketOverviewRow[]; caption: string }) {
  const priced = rows.filter((row) => row.askTotalCc != null || row.bidTotalCc != null);
  const unpriced = rows.length - priced.length;
  const height = TOP + rows.length * ROW_H + BOTTOM;

  const reading = priced.length
    // The verb agrees with the COUNTED families, not with the total: "1 of 4
    // families are priced" is the shape this got wrong on the live watchlist.
    ? `${priced.length} of ${rows.length} families ${priced.length === 1 ? "is" : "are"} priced as a basket; `
      + "a mark left of the line is a dollar going cheap, a mark right of it is a dollar being sold dear."
    : null;
  const missing = unpriced
    ? `${unpriced} ${unpriced === 1 ? "family carries" : "families carry"} no mark: either the exchange does not `
      + "call it mutually exclusive, so its prices need not sum to anything, or a leg is unquoted and a total "
      + "built from the rest would understate it by exactly the legs it skipped."
    : null;

  const ariaLabel = rows
    .map((row) => {
      const ask = fromCenticents(row.askTotalCc);
      const bid = fromCenticents(row.bidTotalCc);
      if (!row.mutuallyExclusive) return `${row.label}: not mutually exclusive, no basket total`;
      return `${row.label}: buying every outcome ${ask ?? "cannot be priced"}, selling every outcome ${bid ?? "cannot be priced"}`;
    })
    .join(". ");

  if (!rows.length) {
    return (
      <Figure caption={caption} ariaLabel="No families to place against the dollar">
        <FigureEmpty reason="No family was read, so there is nothing to place against a dollar." />
      </Figure>
    );
  }

  return (
    <Figure caption={caption} reading={reading} missing={missing} ariaLabel={ariaLabel}>
      <Plot height={height}>
        {(width) => {
          const plotLeft = LABEL_W;
          const plotWidth = Math.max(60, width - LABEL_W - 44);
          const x = (cc: number) => plotLeft + (cc / CEILING_CC) * plotWidth;
          const dollarX = x(DOLLAR_CC);
          return (
            <>
              {/* The dollar line first, so every mark reads as a position
                  relative to it rather than as a value on its own. */}
              <line
                x1={dollarX} x2={dollarX} y1={TOP - 8} y2={TOP + rows.length * ROW_H}
                stroke="var(--text-primary)" strokeWidth="1.5"
              />
              <text x={dollarX} y={TOP - 12} textAnchor="middle" className="coh-axis__label">$1</text>
              <text x={plotLeft} y={TOP - 12} textAnchor="start" className="coh-axis__label">$0</text>

              {rows.map((row, index) => {
                const y = TOP + index * ROW_H + ROW_H / 2;
                return (
                  <g key={row.ticker}>
                    <text x={0} y={y + 4} className="coh-axis__label">{short(row.label)}</text>
                    <line
                      x1={plotLeft} x2={plotLeft + plotWidth} y1={y} y2={y}
                      stroke="var(--border)" strokeWidth="1"
                    />
                    {row.askTotalCc != null ? (
                      <circle cx={x(row.askTotalCc)} cy={y} r={MARK_R} className="coh-basket__buy" />
                    ) : null}
                    {row.bidTotalCc != null ? (
                      // A hollow square for sell, a filled disc for buy: the
                      // pair has to be tellable apart with every hue stripped.
                      <rect
                        x={x(row.bidTotalCc) - MARK_R} y={y - MARK_R}
                        width={MARK_R * 2} height={MARK_R * 2}
                        className="coh-basket__sell"
                      />
                    ) : null}
                    {row.askTotalCc == null && row.bidTotalCc == null ? (
                      <text x={plotLeft + 6} y={y + 4} className="coh-axis__label">
                        {row.mutuallyExclusive ? "◌ no total: a leg is unquoted" : "○ not mutually exclusive"}
                      </text>
                    ) : null}
                  </g>
                );
              })}

              <text x={plotLeft} y={height - 8} className="coh-axis__label">
                ● buying every outcome
              </text>
              <text x={plotLeft + 150} y={height - 8} className="coh-axis__label">
                ▫ selling every outcome
              </text>
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}
