"use client";

/**
 * The watched families, each priced against the dollar it pays.
 *
 * This is the tab's opening argument. For a mutually exclusive event the
 * exchange itself asserts that exactly one outcome resolves YES, so the whole
 * family is a dollar sold in pieces — and what the pieces cost is a direct,
 * unmodelled reading of whether those prices admit a probability at all.
 *
 * Both directions are shown because they answer different questions and fail
 * independently. Buying every outcome needs every ask; selling needs every bid.
 * In the tails a market routinely has an ask and no bid, so an event that
 * cannot be sold as a basket can very often still be bought as one.
 */

import { fromCenticents, sumPrices, verdictForBuy, verdictForSell, VERDICT_MARK, VERDICT_WORD } from "@/lib/coherence/fixed-point";
import type { CoherenceEventView, CoherenceUniverse } from "@/lib/coherence/types";
import DollarBar from "./DollarBar";
import { StateChip } from "./Figure";

function toneFor(verdict: string): "good" | "warn" | "critical" | "muted" {
  if (verdict === "coherent") return "good";
  if (verdict === "unknown") return "muted";
  return "critical";
}

function EventCard({ event }: { event: CoherenceEventView }) {
  const asks = event.markets.map((market) => ({ label: market.yes_sub_title || market.ticker, price: market.yes_ask }));
  const bids = event.markets.map((market) => ({ label: market.yes_sub_title || market.ticker, price: market.yes_bid }));
  const askTotal = sumPrices(asks.map((leg) => leg.price));
  const bidTotal = sumPrices(bids.map((leg) => leg.price));
  const buyVerdict = verdictForBuy(askTotal);
  const sellVerdict = verdictForSell(bidTotal);

  return (
    <article className="coh-event">
      <header className="coh-event__head">
        <div>
          <h4 className="coh-event__title">{event.title || event.event_ticker}</h4>
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

      {event.mutually_exclusive ? (
        <div className="coh-event__figures">
          <DollarBar legs={asks} direction="buy" caption="Buying every outcome — what a guaranteed $1 costs" />
          <DollarBar legs={bids} direction="sell" caption="Selling every outcome — what a $1 liability pays" />
        </div>
      ) : (
        <p className="coh-event__note">
          <span aria-hidden="true">◌</span> This event is not mutually exclusive, so its prices need not sum to
          anything and no basket total is drawn. The exchange&rsquo;s own flag decides that, not our arithmetic over the
          strikes.
        </p>
      )}

      <div className="table-wrap">
        <table className="coh-table">
          <caption className="coh-table__caption">Every outcome in this family, as quoted</caption>
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
      {event.markets.some((market) => market.unquoted_reason) ? (
        <p className="coh-event__note">
          <span aria-hidden="true">◌</span> A dash is an absent quote, not a zero one. Zero is itself a legal price
          here, so a market nobody will bid on and a market bid at nothing are different facts.
        </p>
      ) : null}
    </article>
  );
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

export default function UniversePane({ universe, error }: { universe: CoherenceUniverse | null; error: string | null }) {
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

  return (
    <div className="coh-universe">
      {universe.events.map((event) => (
        <EventCard key={event.event_ticker} event={event} />
      ))}
      {universe.notes.length ? (
        <ul className="coh-notes">
          {universe.notes.map((note, index) => (
            <li key={`${index}-${note}`}>{note}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
