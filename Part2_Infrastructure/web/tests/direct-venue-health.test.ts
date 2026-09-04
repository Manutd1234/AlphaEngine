/** The green venue mark must come from a usable current book, not HTTP 200. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DIRECT_VENUE_PROBE_SYMBOL,
  observationsFromBooks,
} from "../lib/direct-venue-health";
import type { VenueBook, VenueName } from "../lib/venues";

const AT = Date.parse("2026-09-04T08:00:00.000Z");

function book(venue: VenueName, overrides: Partial<VenueBook> = {}): VenueBook {
  return {
    venue,
    symbol: DIRECT_VENUE_PROBE_SYMBOL,
    ok: true,
    latencyMs: 12,
    bids: [[100, 2]],
    asks: [[101, 3]],
    bestBid: 100,
    bestAsk: 101,
    mid: 100.5,
    spreadBps: 99.5,
    depthUsdBid: 200,
    depthUsdAsk: 303,
    imbalance: -0.2,
    ...overrides,
  };
}

describe("direct venue live-data observations", () => {
  it("marks both venues fresh only after valid two-sided books", () => {
    const observations = observationsFromBooks([book("BINANCE"), book("BYBIT")], AT);
    assert.equal(observations.binance.state, "fresh");
    assert.equal(observations.bybit.state, "fresh");
    assert.equal(observations.bybit.observedAt, "2026-09-04T08:00:00.000Z");
    assert.equal(observations.bybit.bestBid, 100);
    assert.equal(observations.bybit.bestAsk, 101);
  });

  it("refuses to turn a successful but empty response green", () => {
    const observations = observationsFromBooks([
      book("BINANCE"),
      book("BYBIT", { bids: [], bestBid: null, mid: null }),
    ], AT);
    assert.equal(observations.binance.state, "fresh");
    assert.equal(observations.bybit.state, "failed");
    assert.equal(observations.bybit.bestBid, null);
    assert.match(observations.bybit.detail, /usable two-sided/);
  });

  it("refuses crossed or missing books rather than trusting an old latency sample", () => {
    const crossed = observationsFromBooks([book("BYBIT", { bestBid: 102, bestAsk: 101 })], AT);
    assert.equal(crossed.bybit.state, "failed");
    assert.equal(crossed.binance.state, "failed");
  });
});
