"use client";

/**
 * The watched families, each priced against the dollar it pays.
 *
 * This is the tab's opening argument. For a mutually exclusive event the
 * exchange itself asserts that exactly one outcome resolves YES, so the whole
 * family is a dollar sold in pieces — and what the pieces cost is a direct,
 * unmodelled reading of whether those prices admit a probability at all.
 *
 * The shape is comparison first, positions second, detail on request, as three
 * VIEWS the section owns: `BasketOverview` puts every family on one dollar axis
 * (the question a watchlist raises — which of these is furthest from a dollar),
 * Positions gives open interest its own uncluttered canvas, and Families
 * details ONE family. Since the third 2026-08-24 review the Families view is
 * handed a single event: the packed two-up card grid, with each card's
 * disclosure open, was three 188-row tables running under each other's
 * borders. The section's picker chooses the family; this pane draws what it
 * is given, and the overview always draws the WHOLE watchlist — the asset
 * filter selects cards, never comparisons.
 *
 * A family is one compact row of chips, one drawn bar (only for the direction
 * that has a total), and its outcome table behind a disclosure that states
 * its own row count: a 188-row table is evidence a reader sometimes wants and
 * never wants several of at once.
 *
 * THE TWO BRANCHES WITH NO BAR CARRY A DISTRIBUTION, not a row per leg. The
 * fourth pass of 2026-08-24 gave them `LegStrip`, one 22px SVG row per market,
 * and on the largest watched family that was 188 rows — 4,152px of plot, most
 * of them repeating one true sentence about an absent bid. The fifth review
 * named it: "output as a vertical bar chart and x axis as value of the money so
 * we can see the distribution instead of scrolling forever". `PriceHistogram`
 * is that figure and its height does not grow with the family. Where the bar IS
 * drawn it is not, because `DollarBar` lays the same legs against the same
 * dollar and twice is once too many.
 *
 * The read's own notes are folded on Baskets. They qualify the read the figure
 * is drawn from rather than answering the view's question, and the summary
 * counts them so the fold is not a guess.
 *
 * Both directions are priced because they fail independently, and the
 * asymmetry is STATED in the overview's reading: buying needs every ask,
 * selling every bid, and in the tails a market routinely has an ask and no
 * bid.
 *
 * The failure and unconfigured states live here rather than in the section,
 * so a reader filtering an empty watchlist is told the watchlist is empty.
 */

import { sumPrices, verdictForBuy, verdictForSell, VERDICT_WORD } from "@/lib/coherence/fixed-point";
import type { CoherenceEventView, CoherenceUniverse } from "@/lib/coherence/types";
import { dollarsLabel } from "@/lib/coherence/universe-metrics";
import BasketComposition from "./BasketComposition";
import BasketSize from "./BasketSize";
import BasketOverview, { rowsFor } from "./BasketOverview";
import PriceHistogram from "./PriceHistogram";
import basketStyles from "./UniverseBasketLayout.module.css";
import familyStyles from "./UniverseFamilyLayout.module.css";

const styles = { ...basketStyles, ...familyStyles };

function toneFor(verdict: string): "good" | "warn" | "critical" | "muted" {
  if (verdict === "coherent") return "good";
  if (verdict === "unknown") return "muted";
  return "critical";
}

function describeStrike(kind: string, floor: string | null, cap: string | null): string {
  if (kind === "between" && floor && cap) return `${floor} to ${cap}`;
  if (kind === "greater" && floor) return `above ${floor}`;
  if (kind === "greater_or_equal" && floor) return `${floor} or more`;
  if (kind === "less" && cap) return `below ${cap}`;
  if (kind === "less_or_equal" && cap) return `${cap} or less`;
  if (kind === "custom") return "named outcome";
  return kind;
}

function EventCard({ event, category }: { event: CoherenceEventView; category: string }) {
  const asks = event.markets.map((market) => ({ label: market.yes_sub_title || market.ticker, price: market.yes_ask }));
  const bids = event.markets.map((market) => ({ label: market.yes_sub_title || market.ticker, price: market.yes_bid }));
  const askTotal = sumPrices(asks.map((leg) => leg.price));
  const bidTotal = sumPrices(bids.map((leg) => leg.price));
  const buyVerdict = verdictForBuy(askTotal);
  const sellVerdict = verdictForSell(bidTotal);
  const unquoted = event.markets.some((market) => market.unquoted_reason);
  const quoted = event.markets.filter((market) => market.yes_ask != null).length;
  const wholeFamily = quoted === event.markets.length;

  return (
    <article className={styles.familyCard}>
      <header className={styles.familyHero}>
        <div className={styles.familyHeading}>
          <span>{category}</span>
          <h3>{event.title || event.event_ticker}</h3>
          <p>
            {event.event_ticker}, shard {event.exchange_index}, {event.markets.length} outcomes
            {event.settlement_sources.length ? `, ${event.settlement_sources.join(" and ")}` : ""}
          </p>
        </div>
        <dl className={styles.familyFacts}>
          <div data-tone={toneFor(buyVerdict)}>
            <dt>Buy whole</dt>
            <dd className="num">{dollarsLabel(askTotal)}</dd>
            <dd>{VERDICT_WORD[buyVerdict]}</dd>
          </div>
          <div data-tone={toneFor(sellVerdict)}>
            <dt>Sell whole</dt>
            <dd className="num">{dollarsLabel(bidTotal)}</dd>
            <dd>{VERDICT_WORD[sellVerdict]}</dd>
          </div>
          <div data-tone={wholeFamily ? "good" : "muted"}>
            <dt>Asks quoted</dt>
            <dd className="num">{quoted}/{event.markets.length}</dd>
            <dd>{wholeFamily ? "Complete" : "Incomplete"}</dd>
          </div>
        </dl>
      </header>

      {/* One bar, not two: the overview carries the comparison, and what one
          family adds is where the cost sits along its own legs — the direction
          with a total is the one that can show it. */}
      <PriceHistogram key={event.event_ticker} markets={event.markets} caption="Executable YES asks by price" />

      <details className={styles.outcomes} data-summary-marker="source-owned">
        <summary>View all {event.markets.length} outcomes</summary>
        <div
          className="table-wrap table-wrap--clamped"
          role="region"
          aria-label={`${event.title || event.event_ticker} outcome quotes`}
          tabIndex={0}
        >
          <table className="coh-table">
            <caption className="coh-table__caption">
              {unquoted
                ? "A dash is an absent quote, not a zero one: zero is a legal price here."
                : "This family, as the exchange quotes it."}
            </caption>
            <thead>
              <tr>
                <th scope="col">Outcome</th>
                <th scope="col">Strike</th>
                <th scope="col" className="num">YES bid</th>
                <th scope="col" className="num">YES ask</th>
                <th scope="col" className="num">Spread</th>
                <th scope="col" className="num">Grid</th>
              </tr>
            </thead>
            <tbody>
              {event.markets.map((market) => (
                <tr key={market.ticker}>
                  <th scope="row">{market.yes_sub_title || market.ticker}</th>
                  <td>{describeStrike(market.strike_kind, market.floor_strike, market.cap_strike)}</td>
                  <td className="num">{market.yes_bid ?? "—"}</td>
                  <td className="num">{market.yes_ask ?? "—"}</td>
                  <td className="num">{market.spread ?? "—"}</td>
                  <td className="num">{market.price_grid}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </article>
  );
}

/** The section's three views: price comparison, positions, or family detail. */
export type UniverseView = "baskets" | "positions" | "families";

export interface UniversePaneProps {
  universe: CoherenceUniverse | null;
  /** Which focused view to draw. The section owns the switcher. */
  view: UniverseView;
  /** The families in view — the whole read, or the one picked family. */
  events: CoherenceEventView[];
  error: string | null;
  /** True while an asset type is selected, so an empty view can say why. */
  filtered: boolean;
  /** One ticker drives every basket diagram and survives the view change. */
  selectedTicker?: string | null;
  onSelectFamily?: (ticker: string) => void;
  onExploreFamily?: (ticker: string) => void;
}

export default function UniversePane({
  universe,
  view,
  events,
  error,
  filtered,
  selectedTicker,
  onSelectFamily,
  onExploreFamily,
}: UniversePaneProps) {
  if (error && !universe) {
    return (
      <p className="console-empty">
        <span aria-hidden="true">✕</span> The watched families could not be read: {error}
      </p>
    );
  }
  if (!universe) {
    return <p className="console-empty muted" role="status" aria-busy="true">Reading the exchange…</p>;
  }
  if (universe.state === "unconfigured") {
    return (
      <p className="console-empty">
        <span aria-hidden="true">◌</span> No series is watched. Set <code>COHERENCE_SERIES</code> on the gateway to
        name the families.
      </p>
    );
  }
  if (!universe.events.length) {
    return (
      <p className="console-empty">
        <span aria-hidden="true">◌</span> Nothing to price: {universe.notes[0] ?? "the watchlist returned no open events."}{" "}
        Shell &rarr; Tree lists what <code>COHERENCE_SERIES</code> is watching, whether or not a family is open.
      </p>
    );
  }
  if (!events.length) {
    // The next action, not just the count — and `filtered` is what decides
    // which sentence is TRUE. The branch used to name a filter unconditionally;
    // with no filter set it would have told a reader to undo a control they had
    // not touched, which is worse than saying nothing.
    return (
      <p className="console-empty">
        <span aria-hidden="true">◌</span>{" "}
        {filtered
          ? `No family of this asset type is open right now; the watchlist's ${universe.events.length} sit under `
            + "other categories. Set Asset type back to All families to see them."
          : `No family is open to draw, though this poll read ${universe.events.length}. `
            + "Baskets prices the whole watchlist and says what each family withheld."}
      </p>
    );
  }

  if (view === "baskets") {
    // The whole watchlist, never the filtered slice. The read's own notes ride
    // here — they qualify the read the figure is drawn from.
    //
    // The family chooser and fixed dollar axis belong together: selecting a
    // row updates the exact readout without moving the reader down a second,
    // unrelated position chart. Open interest now owns the Positions view.
    const rows = rowsFor(universe.events);
    return (
      <>
        <div className={styles.basketWorkbench}>
          <BasketComposition
            universe={universe}
            rows={rows}
            selectedTicker={selectedTicker}
            onSelect={onSelectFamily}
            onExplore={onExploreFamily}
          />
          <BasketOverview
            rows={rows}
            caption="Every watched family on the same payoff scale"
            selectedTicker={selectedTicker}
            onSelect={onSelectFamily}
          />
        </div>
        {universe.notes.length ? (
          /* The gateway's own qualifications of this read — a series it could
             not open, a shard it skipped. They belong with the figure rather
             than under it: folded, the comparison IS the view, and the summary
             says how many are waiting so nobody has to open it to find out. */
          <details className="disclosure">
            <summary>
              How this read was made, {universe.notes.length}{" "}
              {universe.notes.length === 1 ? "note" : "notes"} from the gateway
            </summary>
            <ul className="coh-notes">
              {universe.notes.map((note, index) => (
                <li key={`${index}-${note}`}>{note}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </>
    );
  }

  if (view === "positions") {
    return (
      <div className={styles.positionWorkbench}>
        <BasketSize universe={universe} selectedTicker={selectedTicker} />
      </div>
    );
  }

  return (
    <div className="coh-universe__families">
      {events.map((event) => (
        <EventCard
          key={event.event_ticker}
          event={event}
          category={universe.categories[event.series_ticker] || "Uncategorised"}
        />
      ))}
    </div>
  );
}
