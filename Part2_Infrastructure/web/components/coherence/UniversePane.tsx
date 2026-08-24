"use client";

/**
 * The watched families, each priced against the dollar it pays.
 *
 * This is the tab's opening argument. For a mutually exclusive event the
 * exchange itself asserts that exactly one outcome resolves YES, so the whole
 * family is a dollar sold in pieces — and what the pieces cost is a direct,
 * unmodelled reading of whether those prices admit a probability at all.
 *
 * REBUILT 2026-08-24 around the reported complaint: "a lot of scrolling". It
 * was. Every family drew two full-width bars and then a row per outcome, and a
 * watchlist is not four families, it is four families of 80, 188, 6 and 6
 * markets — 280 rows of quotes before the second heading. Measured against the
 * live exchange, not imagined.
 *
 * So the shape is now comparison first, detail on request:
 *
 * **One figure for the whole watchlist.** `BasketOverview` puts every family on
 * one dollar axis, which is the question a watchlist actually raises — which of
 * these is furthest from a dollar — and which a stack of per-family bars can
 * only answer by scrolling and remembering.
 *
 * **A family is one compact row of chips, not two charts.** The verdict, the
 * two totals and the shape of the family; the drawn bar stays, once, and only
 * for the direction that has a total.
 *
 * **The outcome table is behind a disclosure, and says its own size.** A
 * 188-row table is evidence a reader sometimes wants and never wants four of
 * at once. Closed it costs one line; open it is exactly what it was.
 *
 * Both directions are still priced, because they answer different questions and
 * fail independently. Buying every outcome needs every ask; selling needs every
 * bid. In the tails a market routinely has an ask and no bid, so an event that
 * cannot be sold as a basket can very often still be bought as one.
 *
 * `showBaskets` is the section's Baskets view, not a visibility flag for the
 * whole pane: the failure and unconfigured states below it render on every view
 * of the section, because a reader looking at the settlement feed while no
 * series is watched must be told that as well.
 */

import { fromCenticents, sumPrices, verdictForBuy, verdictForSell, VERDICT_MARK, VERDICT_WORD } from "@/lib/coherence/fixed-point";
import type { CoherenceEventView, CoherenceUniverse } from "@/lib/coherence/types";
import BasketOverview, { rowsFor } from "./BasketOverview";
import DollarBar from "./DollarBar";
import { StateChip } from "./Figure";

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

function EventCard({ event }: { event: CoherenceEventView }) {
  const asks = event.markets.map((market) => ({ label: market.yes_sub_title || market.ticker, price: market.yes_ask }));
  const bids = event.markets.map((market) => ({ label: market.yes_sub_title || market.ticker, price: market.yes_bid }));
  const askTotal = sumPrices(asks.map((leg) => leg.price));
  const bidTotal = sumPrices(bids.map((leg) => leg.price));
  const buyVerdict = verdictForBuy(askTotal);
  const sellVerdict = verdictForSell(bidTotal);
  const unquoted = event.markets.some((market) => market.unquoted_reason);

  return (
    <article className="coh-event">
      <header className="coh-event__head">
        <div>
          <h3 className="coh-event__title">{event.title || event.event_ticker}</h3>
          <p className="coh-event__meta">
            {event.event_ticker}, shard {event.exchange_index}, {event.markets.length} outcomes
            {event.settlement_sources.length ? `, settled on ${event.settlement_sources.join(" and ")}` : ""}
          </p>
        </div>
        <div className="coh-event__chips">
          <StateChip
            mark={VERDICT_MARK[buyVerdict]}
            word={`Buy ${VERDICT_WORD[buyVerdict].toLowerCase()}`}
            value={askTotal == null ? null : fromCenticents(askTotal)}
            tone={toneFor(buyVerdict)}
          />
          <StateChip
            mark={VERDICT_MARK[sellVerdict]}
            word={`Sell ${VERDICT_WORD[sellVerdict].toLowerCase()}`}
            value={bidTotal == null ? null : fromCenticents(bidTotal)}
            tone={toneFor(sellVerdict)}
          />
        </div>
      </header>

      {/* One bar, not two. The overview figure above already carries the
          comparison; what a single family adds is where the cost sits along
          its own legs, and the direction with a total is the one that can show
          it. Neither priced, and there is nothing to draw. */}
      {event.mutually_exclusive && askTotal != null ? (
        <DollarBar legs={asks} direction="buy" caption="Buying every outcome — what a guaranteed $1 costs" />
      ) : event.mutually_exclusive && bidTotal != null ? (
        <DollarBar legs={bids} direction="sell" caption="Selling every outcome — what a $1 liability pays" />
      ) : event.mutually_exclusive ? (
        <p className="coh-event__note">
          <span aria-hidden="true">◌</span> Neither direction totals: a leg is unquoted, and a basket built from the
          rest would understate it by exactly the legs it skipped.
        </p>
      ) : (
        <p className="coh-event__note">
          <span aria-hidden="true">○</span> Not mutually exclusive, so these prices need not sum to anything — the
          exchange&rsquo;s own flag decides that, not our arithmetic.
        </p>
      )}

      <details className="coh-event__outcomes">
        <summary>
          Every outcome as quoted, {event.markets.length} rows
        </summary>
        <div className="table-wrap">
          <table className="coh-table">
            <caption className="coh-table__caption">
              {unquoted
                ? "A dash is an absent quote, not a zero one. Zero is a legal price here, so a market nobody will bid on and a market bid at nothing are different facts."
                : "Every outcome in this family, as the exchange quotes it."}
            </caption>
            <thead>
              <tr>
                <th scope="col">Outcome</th>
                <th scope="col">Strike</th>
                <th scope="col" className="num">YES bid</th>
                <th scope="col" className="num">YES ask</th>
                <th scope="col" className="num">Spread</th>
                <th scope="col">Grid</th>
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
                  <td>{market.price_grid}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </article>
  );
}

export interface UniversePaneProps {
  universe: CoherenceUniverse | null;
  /** The families in view — the whole read, or one asset type of it. */
  events: CoherenceEventView[];
  error: string | null;
  /** True on the section's Baskets view. The states above it ignore it. */
  showBaskets: boolean;
  /** True while an asset type is selected, so an empty view can say why. */
  filtered: boolean;
}

export default function UniversePane({ universe, events, error, showBaskets, filtered }: UniversePaneProps) {
  if (error && !universe) {
    return (
      <p className="console-empty">
        <span aria-hidden="true">✕</span> The watched families could not be read: {error}
      </p>
    );
  }
  if (!universe) {
    return <p className="console-empty muted">Reading the exchange…</p>;
  }
  if (universe.state === "unconfigured") {
    return (
      <p className="console-empty">
        <span aria-hidden="true">◌</span> No series is being watched. Set <code>COHERENCE_SERIES</code> on the gateway
        to name the families this engine should price.
      </p>
    );
  }
  if (!universe.events.length) {
    return (
      <p className="console-empty">
        <span aria-hidden="true">◌</span> Nothing to price: {universe.notes[0] ?? "the watchlist returned no open events."}
      </p>
    );
  }
  if (!showBaskets) return null;
  if (!events.length) {
    return (
      <p className="console-empty">
        <span aria-hidden="true">◌</span> No family of this asset type is open right now. The watchlist has{" "}
        {universe.events.length}, under other categories.
      </p>
    );
  }

  return (
    <>
      <BasketOverview
        rows={rowsFor(events)}
        caption={
          filtered
            ? "The families of this asset type, each against the dollar it pays"
            : "Every watched family, each against the dollar it pays"
        }
      />
      {events.map((event) => (
        <EventCard key={event.event_ticker} event={event} />
      ))}
      {universe.notes.length ? (
        <ul className="coh-notes">
          {universe.notes.map((note, index) => (
            <li key={`${index}-${note}`}>{note}</li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
