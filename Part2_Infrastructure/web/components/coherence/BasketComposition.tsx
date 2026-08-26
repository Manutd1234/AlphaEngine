"use client";

/**
 * What the watched universe is MADE of, in numbers and in two rings.
 *
 * The fifth review of 2026-08-24: "can we fix the universe baskets tab to have
 * more figures and like pie charts to show the overview". Baskets was one thin
 * dot-on-a-line figure and a paragraph on a screen that could hold a
 * composition — and the dot figure structurally cannot show the whole
 * watchlist, because a family the exchange does not call mutually exclusive has
 * no total to put on a dollar axis and therefore carries no mark. Two of the
 * three watched families are in exactly that state, so the section's headline
 * figure was drawing one mark and saying nothing about the other two.
 *
 * A ring can hold all of them, which is why the answer is a composition rather
 * than a second axis. Two rings, because there are two different questions and
 * one ring answering both would be mixing denominators:
 *
 *   WHAT the watchlist is — Kalshi's own asset category per series.
 *   WHY a family does or does not carry a basket price — priced, or one of the
 *   two distinct refusals, which are not the same fact and must not share a
 *   slice.
 *
 * `DonutChart` is the house composition ring and is reused whole rather than
 * copied. Two reasons it is the right one and `AllocationDonut` is not: its
 * `.donut*` rules are declared unscoped in the standardisation layer, so they
 * style correctly inside the coherence plane with no new CSS and no dead-css
 * delta; and it carries no inline `fontSize` at all, where `AllocationDonut`
 * spends the single sanctioned 25px centre figure the diagram ladder caps at
 * exactly one occurrence.
 *
 * NOT WRAPPED IN `Figure`. `Figure` puts `role="img"` and one `aria-label` on
 * the plot, which makes every descendant presentational — and the half of a
 * donut that carries the shares in TEXT is `.donut__legend`, a list. Wrapping
 * it would hide the accessible half of the chart behind a single label. So each
 * ring sits in the plane's own `.coh-event` sub-card with a head that says what
 * it shows, which is the shape `TrustCompositionPane` uses on the Data tab.
 *
 * The KPI row above them is `.coh-status__facts` — this plane's own auto-fit
 * tile grid, already declared and already rendered by the status and book
 * panes. A figure is not the first thing this section owes a reader; the four
 * numbers are, and every one of them dashes rather than printing a zero it did
 * not measure.
 */

import DonutChart, { type DonutSlice } from "@/components/common/DonutChart";
import { dollarsLabel } from "@/lib/coherence/universe-metrics";
import type { CoherenceUniverse } from "@/lib/coherence/types";
import type { BasketOverviewRow } from "./BasketOverview";

/** Where a series Kalshi would not categorise is shown. Never guessed at. */
const UNCATEGORISED = "Uncategorised";

/**
 * The categorical ramp, in a fixed order so two polls of the same watchlist
 * colour the same category the same way. Tokens, never hex — and never the
 * only thing saying which slice is which: every legend row prints its label
 * and its share as text.
 */
const RAMP = [
  "var(--series-1)",
  "var(--series-3)",
  "var(--series-2)",
  "var(--status-warning)",
  "var(--status-good)",
  "var(--status-critical)",
  "var(--text-muted)",
];

export interface BasketCompositionProps {
  universe: CoherenceUniverse;
  /** The same rows the dollar-axis figure below is drawn from. */
  rows: BasketOverviewRow[];
}

export default function BasketComposition({ universe, rows }: BasketCompositionProps) {
  const events = universe.events;

  // ---- the two compositions ------------------------------------------------
  const byCategory = new Map<string, number>();
  for (const event of events) {
    const key = universe.categories[event.series_ticker] || UNCATEGORISED;
    byCategory.set(key, (byCategory.get(key) ?? 0) + 1);
  }
  const categorySlices: DonutSlice[] = [...byCategory.entries()]
    // Uncategorised last and in the axis grey: it is the absence of a label,
    // not a label, and giving it a series colour would rank it beside one.
    .sort((a, b) => (a[0] === UNCATEGORISED ? 1 : b[0] === UNCATEGORISED ? -1 : b[1] - a[1]))
    .map(([label, value], index) => ({
      label,
      value,
      colour: label === UNCATEGORISED ? "var(--axis)" : RAMP[index % RAMP.length],
    }));

  const priced = rows.filter((row) => row.askTotalCc != null || row.bidTotalCc != null);
  const notExclusive = rows.filter((row) => !row.mutuallyExclusive);
  const legUnquoted = rows.length - priced.length - notExclusive.length;
  const verdictSlices: DonutSlice[] = [
    { label: "priced as a basket", value: priced.length, colour: "var(--series-1)" },
    { label: "not mutually exclusive", value: notExclusive.length, colour: "var(--axis)" },
    { label: "a leg is unquoted", value: legUnquoted, colour: "var(--status-warning)" },
  ];

  // ---- the four numbers ----------------------------------------------------
  const outcomes = events.reduce((sum, event) => sum + event.markets.length, 0);
  const quoted = events.reduce(
    (sum, event) => sum + event.markets.filter((market) => market.yes_ask != null).length,
    0,
  );
  const buyable = rows.filter((row) => row.askTotalCc != null);
  // Null is never coerced: with no family priced on the ask there is no
  // cheapest and no dearest, and the dash carries the reason.
  const cheapest = buyable.length
    ? buyable.reduce((low, row) => ((row.askTotalCc as number) < (low.askTotalCc as number) ? row : low))
    : null;
  const dearest = buyable.length
    ? buyable.reduce((high, row) => ((row.askTotalCc as number) > (high.askTotalCc as number) ? row : high))
    : null;
  /** The value and the family it belongs to, or the dash and its reason. Never
   *  a stringified null: `fromCenticents` is nullable, and a template literal
   *  would print the word. */
  /** The cost of a whole basket, marked as money and grouped, like the tiles
   *  below it. Before 2026-08-25 this printed a bare `1.0700` two rows above a
   *  `$1.0700` saying the same thing, which reads as two different quantities. */
  const buyLabel = (row: BasketOverviewRow | null): string =>
    row && row.askTotalCc != null
      ? `${dollarsLabel(row.askTotalCc)}, ${row.ticker}`
      : "— no watched family carries an ask on every leg";

  return (
    <>
      <dl className="coh-status__facts coh-facts--boxed">
        <div>
          <dt>Families watched</dt>
          <dd>{events.length} across {universe.watchlist.length} series</dd>
        </div>
        <div>
          <dt>Priced as a basket</dt>
          <dd>{priced.length} of {rows.length}</dd>
        </div>
        <div>
          <dt>Cheapest to buy whole</dt>
          <dd>{buyLabel(cheapest)}</dd>
        </div>
        <div>
          <dt>Dearest to buy whole</dt>
          <dd>{buyLabel(dearest)}</dd>
        </div>
      </dl>

      <div className="compact-grid-2col">
        <article className="coh-event">
          <header className="coh-event__head">
            <div>
              <h3 className="coh-event__title">What the watchlist is made of</h3>
              <p className="coh-event__meta">One slice per asset type, as the exchange itself labels the series.</p>
            </div>
          </header>
          <DonutChart
            slices={categorySlices}
            /* The denominator is the families READ, not the slices drawn: the
               ring refuses above eight, and a gap in it is the honest way to
               say a category was left out. */
            total={events.length || undefined}
            centreValue={events.length ? String(events.length) : undefined}
            centreLabel="families"
            emptyNote="No family was read on this poll. An empty ring is not an empty watchlist."
            ariaLabel={`Watched families by asset type: ${categorySlices
              .map((slice) => `${slice.label} ${slice.value}`)
              .join(", ")}`}
          />
        </article>

        <article className="coh-event">
          <header className="coh-event__head">
            <div>
              <h3 className="coh-event__title">Why a family has no basket price</h3>
              <p className="coh-event__meta">
                {quoted} of {outcomes} outcomes across the watchlist carry an ask.
              </p>
            </div>
          </header>
          <DonutChart
            slices={verdictSlices}
            total={rows.length || undefined}
            centreValue={rows.length ? String(priced.length) : undefined}
            centreLabel="priced"
            emptyNote="No family was read on this poll, so none is priced and none is refused."
            ariaLabel={`Watched families by basket state: ${verdictSlices
              .map((slice) => `${slice.label} ${slice.value}`)
              .join(", ")}`}
          />
        </article>
      </div>
    </>
  );
}
