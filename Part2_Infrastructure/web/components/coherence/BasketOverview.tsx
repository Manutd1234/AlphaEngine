"use client";

/**
 * Every watched family on one axis, against the dollar each of them pays.
 *
 * One row per family, buy and sell as two marks on a shared $0–$1.30 axis,
 * with the dollar line the only thing straight down the middle: the question
 * a watchlist raises is comparative — which of these is furthest from a
 * dollar, and is any on the wrong side of it — and the per-family detail
 * lives behind the Families view.
 *
 * Three decisions, each a way this figure could lie:
 *
 * **The axis is fixed, never scaled to the data** — the same choice
 * `DollarBar` records. Normalising to the maximum makes 1.02 and 0.98 look
 * identical, and the whole point is that they are on opposite sides of a line.
 *
 * **A family with a missing leg gets a row and no mark.** Dropping it would
 * read as a complete picture of a smaller watchlist; the row says which side
 * is unpriceable.
 *
 * **A family the exchange does not call mutually exclusive gets a row and no
 * mark either**, marked ○ rather than blank: its prices need not sum to
 * anything, so a total against a dollar would be arithmetic nobody asked for.
 *
 * THIRD 2026-08-24 REVIEW, alignment: the label column now sizes for the
 * longest REAL title; the axis notes sit on the track's own endpoints with
 * tick strokes so they read as an axis rather than as strays over the label
 * column; and the legend is ONE left-aligned key row instead of two entries
 * split across the full width, which read as two orphaned notes.
 */

import { DOLLAR_CC, fromCenticents, sumPrices } from "@/lib/coherence/fixed-point";
import type { CoherenceEventView } from "@/lib/coherence/types";
import { DIAGRAM_LABEL_PX, glyphClassOf, glyphsWithin } from "@/lib/coherence/label-metrics";
import { dollarsLabel } from "@/lib/coherence/universe-metrics";
import Figure, { FigureEmpty, Plot } from "./Figure";

/** Matches `DollarBar`, so a reader moving between the two is not re-scaled. */
const CEILING_CC = 13_000;
const ROW_H = 26;
const TOP = 22;
const BOTTOM = 26;
const MARK_R = 5;
/** The span bar sits under the two marks, thinner than they are wide. */
const BAR_H = 6;

/**
 * The label column, derived from the width.
 *
 * The longest live title is "Highest temperature in New York City on Aug 24,
 * 2026?" — 54 characters. At the 12px series-label rung an average glyph in
 * this face is under 6.9px, so 54 × 6.9 ≈ 373px plus 8px of clearance: 384px
 * holds every real string whole. The column takes at most 42% of the plot so
 * the track keeps the width that makes a two-cent overshoot visible; below
 * ~915px of plot the column cannot reach 384px and the label is ellipsised at
 * the END with the full string on its hover `<title>` — never mid-word.
 */
function labelWidthFor(width: number): number {
  return Math.min(384, Math.max(150, Math.round(width * 0.42)));
}

/**
 * The dollar ceiling the track runs to, and why it is not the widest total.
 *
 * A fixed ceiling keeps every family on ONE scale, which is the whole point of
 * putting them on one axis — a per-row scale would make two bars of equal
 * length mean different money. 1.30 is a third above the dollar, which is far
 * enough that a real Dutch book has somewhere to sit and near enough that the
 * dollar line is not squashed against the left.
 */

/**
 * Characters that fit the label column, MEASURED rather than assumed.
 *
 * This divided by a literal 7.48 — the 13px rung times an assumed 0.575 — and
 * that ratio was one of eight spellings of the same guess in this engine. Inter
 * sets mixed-case prose at 0.56 and an uppercase ticker at 0.69, so a single
 * ratio was wrong for one of the two whichever value it took. `label-metrics`
 * classifies the string instead.
 */
function labelBudget(labelW: number, label: string): number {
  return Math.max(12, glyphsWithin(labelW - 8, DIAGRAM_LABEL_PX, glyphClassOf(label)));
}

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
 * END-truncation, reversing the second pass's middle-trim. That trim kept the
 * distinguishing tail of "… at 12am EDT?" titles and was still a label cut
 * MID-WORD on the live desk ("Highest temperature i…ity on Aug 24, 2026?"),
 * which is what the reader actually reported. The column is now sized to fit
 * every real string whole at desk width; where it cannot, the tail goes as
 * one piece and the full title rides the row's hover `<title>`.
 */
function short(label: string, chars: number): string {
  return label.length <= chars ? label : `${label.slice(0, chars - 1)}…`;
}

export default function BasketOverview({ rows, caption }: { rows: BasketOverviewRow[]; caption: string }) {
  const priced = rows.filter((row) => row.askTotalCc != null || row.bidTotalCc != null);
  const unpriced = rows.length - priced.length;
  const height = TOP + rows.length * ROW_H + BOTTOM;

  const reading = priced.length
    // The verb agrees with the COUNTED families, not with the total.
    ? `${priced.length} of ${rows.length} families ${priced.length === 1 ? "is" : "are"} priced as a basket; `
      + "left of the line is a dollar going cheap, right of it one dear. Buying a basket needs every ask "
      + "and selling it needs every bid, so a family with an unbid leg carries only a buy mark: "
      + "it can be bought and not sold."
    : null;
  const missing = unpriced
    ? `${unpriced} ${unpriced === 1 ? "family carries" : "families carry"} no mark: the exchange does not call it `
      + "mutually exclusive, or a leg is unquoted and a total from the rest would understate it by "
      + "exactly the legs it skipped."
    : null;

  const ariaLabel = rows
    .map((row) => {
      const ask = fromCenticents(row.askTotalCc);
      const bid = fromCenticents(row.bidTotalCc);
      if (!row.mutuallyExclusive) return `${row.label}: not mutually exclusive, no basket total`;
      return `${row.label}: buy total ${ask ?? "cannot be priced"}, sell total ${bid ?? "cannot be priced"}`;
    })
    .join(". ");

  if (!rows.length) {
    return (
      <Figure caption={caption} ariaLabel="No families to place against the dollar">
        <FigureEmpty reason="No family was read on this poll." />
      </Figure>
    );
  }

  return (
    <Figure caption={caption} reading={reading} missing={missing} ariaLabel={ariaLabel}>
      <Plot height={height}>
        {(width) => {
          const plotLeft = labelWidthFor(width);
          const plotWidth = Math.max(60, width - plotLeft - 44);
          const x = (cc: number) => plotLeft + (cc / CEILING_CC) * plotWidth;
          const dollarX = x(DOLLAR_CC);
          const trackEnd = plotLeft + plotWidth;
          return (
            <>
              {/* The dollar line first, so every mark reads as a position
                  relative to it rather than as a value on its own. */}
              <line
                x1={dollarX} x2={dollarX} y1={TOP - 8} y2={TOP + rows.length * ROW_H}
                stroke="var(--text-primary)" strokeWidth="1.5"
              />
              {/* The axis: its notes sit ON the track's own endpoints — "$0"
                  centred over x = plotLeft, the ceiling over x = trackEnd —
                  each with a 4px tick stroke down to its row band, so the
                  three figures read as one axis rather than as strays over
                  the label column. "$1" labels the dollar line itself. */}
              <line x1={plotLeft} x2={plotLeft} y1={TOP - 6} y2={TOP - 2} stroke="var(--border)" />
              <line x1={trackEnd} x2={trackEnd} y1={TOP - 6} y2={TOP - 2} stroke="var(--border)" />
              <text x={plotLeft} y={TOP - 12} textAnchor="middle" className="coh-figure__key">$0</text>
              <text x={dollarX} y={TOP - 12} textAnchor="middle" className="coh-figure__key">$1</text>
              <text x={trackEnd} y={TOP - 12} textAnchor="end" className="coh-figure__key">$1.30</text>

              {rows.map((row, index) => {
                const y = TOP + index * ROW_H + ROW_H / 2;
                const ask = row.askTotalCc;
                const bid = row.bidTotalCc;
                /* THE BAR RUNS FROM ZERO TO WHAT THE BASKET COSTS, so payout
                   value is a LENGTH and the dollar line crosses it: "left of
                   the line is a dollar going cheap" becomes a bar that stops
                   short of the line, which is a thing the eye does without
                   being told. Two loose marks could not do that, and a bar that
                   spanned bid-to-ask could not either — on this watchlist most
                   families carry one total, and a span needs two, so the
                   commonest row would have drawn nothing at all.
                   The two marks stay ON the bar: a filled disc where buying
                   every outcome lands, a hollow square where selling does. */
                const extent = ask ?? bid;
                const money = (cc: number | null) => (cc == null ? "not priced" : dollarsLabel(cc));
                const status = !row.mutuallyExclusive
                  ? "not mutually exclusive"
                  : ask == null && bid == null
                    ? "a leg is unquoted"
                    : ask == null
                      ? "can be sold, not bought"
                      : bid == null
                        ? "can be bought, not sold"
                        : "priced both ways";
                return (
                  <g key={row.ticker}>
                    <text x={0} y={y + 4} className="coh-axis__label">
                      {short(row.label, labelBudget(plotLeft, row.label))}
                    </text>
                    {/* THE TRACK IS ONLY DRAWN WHERE THERE IS SOMETHING TO
                        PLACE ON IT. A row with no total had a full-width rule
                        with its reason printed straight through the middle of
                        it, which renders as struck-through text — the drawing
                        said "here is a scale" and then had nothing to put on
                        it. No total, no scale: the reason stands on its own. */}
                    {ask != null || bid != null ? (
                      <line
                        x1={plotLeft} x2={trackEnd} y1={y} y2={y}
                        stroke="var(--border)" strokeWidth="1"
                      />
                    ) : null}
                    {extent != null ? (
                      <rect
                        x={plotLeft} y={y - BAR_H / 2}
                        width={Math.max(2, x(extent) - plotLeft)} height={BAR_H}
                        className="coh-basket__span"
                      />
                    ) : null}
                    {ask != null ? (
                      <circle cx={x(ask)} cy={y} r={MARK_R} className="coh-basket__buy" />
                    ) : null}
                    {bid != null ? (
                      // A hollow square for sell, a filled disc for buy: the
                      // pair has to be tellable apart with every hue stripped.
                      <rect
                        x={x(bid) - MARK_R} y={y - MARK_R}
                        width={MARK_R * 2} height={MARK_R * 2}
                        className="coh-basket__sell"
                      />
                    ) : null}
                    {ask == null && bid == null ? (
                      <text x={plotLeft + 6} y={y + 4} className="coh-axis__label">
                        {row.mutuallyExclusive ? "◌ no total: a leg is unquoted" : "○ not mutually exclusive"}
                      </text>
                    ) : null}
                    {/* ONE hover target for the whole row, over the marks so it
                        wins, carrying the ticker, both totals and the status —
                        which is what a reader hovering a row wants and what the
                        per-mark titles could each only give a third of. It is
                        also what puts this row in `Plot`'s keyboard readout,
                        since that walks elements carrying a `<title>`. */}
                    <rect
                      x={0} y={y - ROW_H / 2} width={Math.max(1, trackEnd)} height={ROW_H}
                      fill="transparent"
                    >
                      <title>
                        {`${row.label} (${row.ticker}) — buy every outcome ${money(ask)}, `
                          + `sell every outcome ${money(bid)}: ${status}`}
                      </title>
                    </rect>
                  </g>
                );
              })}

              {/* ONE key row, left-aligned under the labels. Both entries
                  together are ≈47 characters — under 350px at the 13px legend
                  rung's ~7.3px average glyph — so they fit any width this
                  figure draws at (the plot never measures under 480px on the
                  packed grid, and the phone column is wider than 350px). */}
              <text x={0} y={height - 8} className="coh-figure__key">
                ● buying every outcome&nbsp;&nbsp;&nbsp;▫ selling every outcome
              </text>
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}
