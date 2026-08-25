/**
 * The inequalities a family's own quotes must satisfy, derived in the browser.
 *
 * WHY THE DESK DERIVES THEM AT ALL, when the gateway already returns a verdict.
 * The Proof view's only drawing was a two-row bar of `rows_tested` against
 * `rows_untestable` — 189 against 0 on the family the reader opened — and a zero
 * bar is floored to 1px by `ValueStrip`, which also excludes exact zeros from
 * its own floor note. So the figure was a full-width bar, a hairline, and
 * nothing saying the hairline was a floor. It drew two numbers the certificate
 * already prints in words.
 *
 * What a reader wants from a proof is not how many rows were checked but HOW
 * CLOSE ANY OF THEM CAME TO FAILING. That is a quantity per constraint, it is
 * computable from the quotes the universe read already carries, and it is the
 * same claim the gateway's linear programme makes — so the desk checking it is
 * the browser half of a parity pair, which is how the rest of this repository
 * treats maths that has to exist twice.
 *
 * THE TWO CENSUSES ARE NOT THE SAME AND MUST NOT BE CONFLATED. The programme
 * works over INTERVALS on one side of the book ("189 intervals cut by 188
 * strikes", bid basis); this works over QUOTED PAIRS, and needs both sides.
 * Measured on the live tape, `KXBTCD-26AUG2514` carries 188 markets of which
 * 121 have a yes bid and 83 an ask — 16 have both — so the programme reports 0
 * untestable rows and this reports 344. Both are honest about different
 * questions, and the figure has to say which it is drawing.
 *
 * Arithmetic in centicents throughout, never floats: these are money.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { constraintsOf } from "../lib/coherence/constraints";
import type { CoherenceEventView, CoherenceMarketView } from "../lib/coherence/types";

function market(over: Partial<CoherenceMarketView> & { ticker: string }): CoherenceMarketView {
  return {
    event_ticker: "E", series_ticker: "S", yes_sub_title: over.ticker, strike_kind: "greater",
    floor_strike: null, cap_strike: null, exchange_index: 0, price_grid: "linear_cent",
    yes_bid: null, no_bid: null, yes_ask: null, no_ask: null, spread: null, depth: "full",
    unquoted_reason: null, open_interest: null, liquidity: null, volume: null,
    notional_value: null, ...over,
  };
}

function event(markets: CoherenceMarketView[], mutuallyExclusive = false): CoherenceEventView {
  return {
    event_ticker: "E", series_ticker: "S", title: "T", mutually_exclusive: mutuallyExclusive,
    exchange_index: 0, settlement_sources: [], markets, yes_ask_total: null, yes_bid_total: null,
    basket_note: null, open_interest_total: null, liquidity_total: null,
  };
}

describe("the constraints a family's quotes must satisfy", () => {
  it("reads the missing side of a book off the side that is quoted", () => {
    // `no_ask` and `yes_bid` are the same statement about the same market, and
    // a family that quotes only one of them is quoting both. Reading only the
    // literal field is how 172 of 188 markets look unquoted when they are not.
    const set = constraintsOf(event([
      market({ ticker: "A", floor_strike: "10", no_ask: "0.0100", no_bid: "0.0300" }),
    ]));
    const book = set.tested.find((c) => c.kind === "book");
    assert.ok(book, "a market quoting only its no side produced no book constraint");
    // yes bid = 1 - no ask = 0.99, yes ask = 1 - no bid = 0.97 → a CROSSED book.
    assert.equal(book.slack, -200, "the derived yes side did not come back through the no side");
    assert.equal(book.violated, true, "a crossed book is an arbitrage and must be marked one");
  });

  it("counts a constraint it cannot evaluate rather than dropping it", () => {
    // A skipped row is not a passed row. The whole point of the figure is that
    // the two are told apart, which the bar it replaces could not do.
    const set = constraintsOf(event([
      market({ ticker: "A", floor_strike: "10", yes_bid: "0.6000" }),
      market({ ticker: "B", floor_strike: "20", yes_bid: "0.4000" }),
    ]));
    assert.equal(set.tested.length, 0, "an unquoted ask cannot bound anything");
    assert.equal(set.untestable, 3, "two book constraints and one ladder pair went uncounted");
    assert.match(String(set.untestableReason), /\S/, "an untestable count with no reason is a shrug");
  });

  it("orders a threshold ladder by strike and bounds each adjacent pair", () => {
    // P(X >= k) is non-increasing in k, so buying the lower strike at its ask
    // and selling the higher at its bid may never be free money.
    const set = constraintsOf(event([
      market({ ticker: "HI", floor_strike: "20", yes_bid: "0.3000", yes_ask: "0.3200" }),
      market({ ticker: "LO", floor_strike: "10", yes_bid: "0.6000", yes_ask: "0.6200" }),
    ]));
    const ladder = set.tested.filter((c) => c.kind === "ladder");
    assert.equal(ladder.length, 1, "two rungs make one pair");
    // ask(LO) 0.62 - bid(HI) 0.30 = 0.32
    assert.equal(ladder[0].slack, 3200, "the pair was read in the wrong direction");
    assert.equal(ladder[0].violated, false);
  });

  it("finds the inversion when a higher strike bids above a lower strike's offer", () => {
    const set = constraintsOf(event([
      market({ ticker: "LO", floor_strike: "10", yes_bid: "0.2000", yes_ask: "0.2500" }),
      market({ ticker: "HI", floor_strike: "20", yes_bid: "0.4000", yes_ask: "0.4500" }),
    ]));
    const ladder = set.tested.filter((c) => c.kind === "ladder");
    assert.equal(ladder.length, 1);
    assert.equal(ladder[0].slack, -1500, "0.25 offered below a 0.40 bid on a strictly smaller event");
    assert.equal(ladder[0].violated, true);
    assert.equal(set.violations, 1, "a violated constraint was not counted as one");
  });

  it("reads a partition's two sum constraints, and only for a partition", () => {
    const legs = [
      market({ ticker: "A", strike_kind: "less", cap_strike: "1", yes_bid: "0.3000", yes_ask: "0.3200" }),
      market({ ticker: "B", strike_kind: "between", floor_strike: "1", cap_strike: "2", yes_bid: "0.4000", yes_ask: "0.4200" }),
      market({ ticker: "C", strike_kind: "greater", floor_strike: "2", yes_bid: "0.2000", yes_ask: "0.2200" }),
    ];
    const open = constraintsOf(event(legs, false));
    assert.equal(open.tested.filter((c) => c.kind === "partition").length, 0,
      "a family the venue does not mark mutually exclusive has no sum to satisfy");

    const closed = constraintsOf(event(legs, true));
    const sums = closed.tested.filter((c) => c.kind === "partition");
    assert.equal(sums.length, 2, "a partition is bounded from both sides, not one");
    const sell = sums.find((c) => c.claim.includes("sell"));
    const buy = sums.find((c) => c.claim.includes("buy"));
    // bids 0.90 -> selling every leg raises 0.90 against a certain 1.00 payout: 0.10 of room.
    assert.equal(sell?.slack, 1000);
    // asks 0.96 -> buying every leg costs 0.96 for a certain 1.00: NEGATIVE room, an arbitrage.
    assert.equal(buy?.slack, -400);
    assert.equal(buy?.violated, true);
  });

  it("sorts by how close each one came to failing, tightest first", () => {
    // The reading a proof owes a reader is the BINDING constraint. Sorted, the
    // leftmost mark is it, and the curve to its right is how much room the rest
    // of the family had — which is a shape rather than a number, and does not
    // degenerate when the answer is the usual one.
    const set = constraintsOf(event([
      market({ ticker: "A", floor_strike: "10", yes_bid: "0.6000", yes_ask: "0.9000" }),
      market({ ticker: "B", floor_strike: "20", yes_bid: "0.3000", yes_ask: "0.3100" }),
      market({ ticker: "C", floor_strike: "30", yes_bid: "0.1000", yes_ask: "0.5000" }),
    ]));
    const slacks = set.tested.map((c) => c.slack);
    assert.deepEqual([...slacks].sort((a, b) => a - b), slacks,
      "the constraints are not ordered by their remaining room");
    assert.equal(set.tightest, slacks[0], "the tightest constraint is not the first one");
  });

  it("says nothing at all about a family with no markets", () => {
    const set = constraintsOf(event([]));
    assert.equal(set.tested.length, 0);
    assert.equal(set.untestable, 0);
    assert.equal(set.tightest, null, "an empty family has no tightest constraint, not a zero one");
  });
});
