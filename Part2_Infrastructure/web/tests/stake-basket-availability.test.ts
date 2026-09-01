import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import BasketWhatIf from "../components/coherence/BasketWhatIf";
import StakeEligibility from "../components/coherence/surface/StakeEligibility";
import type { CoherenceEventView, CoherenceMarketView } from "../lib/coherence/types";
import { read } from "./helpers/workspace-sources";

function market(eventTicker: string, index: number, quotes: {
  ask?: string | null;
  bid?: string | null;
} = {}): CoherenceMarketView {
  return {
    ticker: `${eventTicker}-M${index}`,
    event_ticker: eventTicker,
    series_ticker: "KXTEST",
    yes_sub_title: `Above ${100 + index}`,
    strike_kind: "greater",
    floor_strike: String(100 + index),
    cap_strike: null,
    exchange_index: 2,
    price_grid: "0.01",
    yes_bid: quotes.bid === undefined ? "0.40" : quotes.bid,
    no_bid: "0.50",
    yes_ask: quotes.ask === undefined ? "0.50" : quotes.ask,
    no_ask: "0.60",
    spread: "0.10",
    depth: "1.00",
    unquoted_reason: null,
    open_interest: null,
    liquidity: null,
    volume: null,
    notional_value: null,
  };
}

function family(ticker: string, mutuallyExclusive: boolean, markets: CoherenceMarketView[]): CoherenceEventView {
  return {
    event_ticker: ticker,
    series_ticker: "KXTEST",
    title: ticker,
    mutually_exclusive: mutuallyExclusive,
    exchange_index: 2,
    settlement_sources: [],
    markets,
    yes_ask_total: null,
    yes_bid_total: null,
    basket_note: mutuallyExclusive
      ? null
      : "This event is not mutually exclusive, so its prices need not sum to anything.",
    open_interest_total: null,
    liquidity_total: null,
  };
}

describe("Stake eligibility is a connected decision map", () => {
  it("gives every watched family a source-to-predicate-to-result path", () => {
    const events = [
      family("LADDER-A", false, [market("LADDER-A", 1)]),
      family("BUCKET-B", true, [market("BUCKET-B", 1), market("BUCKET-B", 2)]),
      family("LADDER-C", false, [market("LADDER-C", 1)]),
    ];
    const markup = renderToStaticMarkup(createElement(StakeEligibility, {
      events,
      target: "LADDER-A",
    }));

    assert.equal((markup.match(/data-stake-family-path=/g) ?? []).length, events.length);
    assert.equal((markup.match(/data-stake-flow-edge=/g) ?? []).length, events.length * 2);
    for (const ticker of events.map((event) => event.event_ticker)) {
      assert.match(markup, new RegExp(`data-stake-family-path="${ticker}"`));
    }
    assert.match(markup, /02 — ELIGIBILITY/);
    assert.match(markup, /exclusive\?/);
    assert.match(markup, /Sizing candidate/);
    assert.match(markup, /Declined by name/);
    assert.match(markup, /data-reserved="false"/,
      "the non-interactive Stake map reserved the invisible readout rail again");
  });
});

describe("Basket preserves live evidence when a family is not a partition", () => {
  it("draws quote coverage through settlement topology to the withheld-cover result", () => {
    const ticker = "LADDER-LIVE";
    const event = family(ticker, false, [
      market(ticker, 1),
      market(ticker, 2, { bid: null }),
      market(ticker, 3, { ask: null }),
    ]);
    const markup = renderToStaticMarkup(createElement(BasketWhatIf, { event }));

    assert.equal((markup.match(/data-basket-flow-edge=/g) ?? []).length, 3);
    assert.match(markup, /01 — QUOTES/);
    assert.match(markup, /02 — SETTLEMENT/);
    assert.match(markup, /03 — GATE/);
    assert.match(markup, /04 — OUTCOME/);
    assert.match(markup, /2\/3 offers; 2\/3 bids/);
    assert.match(markup, /Threshold ladder/);
    assert.match(markup, /Cover withheld/);
    assert.match(markup, /quotes kept; no sum/);
    assert.doesNotMatch(markup, /Not a partition — no basket to buy/);
    assert.match(markup, /data-reserved="false"/);
  });

  it("keeps an exclusive family connected when one offer is absent", () => {
    const ticker = "BUCKET-INCOMPLETE";
    const event = family(ticker, true, [
      market(ticker, 1),
      market(ticker, 2, { ask: null }),
      market(ticker, 3),
    ]);
    const markup = renderToStaticMarkup(createElement(BasketWhatIf, { event }));

    assert.match(markup, new RegExp(`data-basket-incomplete-path="${ticker}"`));
    assert.equal((markup.match(/data-basket-flow-edge=/g) ?? []).length, 2);
    assert.match(markup, /01 — FAMILY/);
    assert.match(markup, /02 — QUOTE GATE/);
    assert.match(markup, /03 — OUTCOME/);
    assert.match(markup, /2\/3 offers; 1 missing/);
    assert.match(markup, /all offers\?/);
    assert.match(markup, /Cover withheld/);
    assert.match(markup, /partial sum not shown/);
    assert.doesNotMatch(markup, /A leg is unquoted — the basket has no price/);
    assert.match(markup, /data-reserved="false"/);
  });
});

describe("the long moment-shape note owns its spacing", () => {
  it("keeps a twelve-pixel inset and a separate twelve-pixel disclosure gap", () => {
    const instrument = read("../components/coherence/surface/LatticeInstruments.tsx");
    const layout = read("../app/globals/10d-coherence-surface.css");

    assert.match(instrument, /coh-surface__moment-shape/);
    assert.match(instrument, /coh-surface__moments-note--shape/);
    assert.match(
      layout,
      /\.coh-surface__moments-note--shape\s*\{[^}]*padding-block-end:\s*max\(12px,\s*var\(--space-3\)\)/s,
    );
    assert.match(
      layout,
      /\.coh-surface__moment-shape \+ \.disclosure\s*\{[^}]*margin-block-start:\s*max\(12px,\s*var\(--space-3\)\)/s,
    );
  });
});
