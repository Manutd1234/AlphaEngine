/**
 * Cross-venue routing: the sweep, and the what-if constraints over it.
 *
 * The parity half of this mirrors `Part2_Infrastructure/tests/test_tca_engine.py`
 * case for case, on the same hand-computed ladders, so the portal's slippage
 * number and the gateway's cannot drift apart. If the two disagree, a trader gets
 * one execution cost on the web and a different one in Telegram for the same
 * order.
 *
 * What this file defends is the answer to "where does this order go": the merged
 * ladder swept price-first across venues, the blended VWAP that comes out of it,
 * the saving claimed against the worst single venue, and the depth-weighted
 * reference price all of that is measured from. The single-book arithmetic it
 * builds on is in `venues-book-maths.test.ts`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildTcaReport,
  consolidatedMid,
  passiveQuote,
  smartRoute,
  walkBook,
  type VenueBook,
} from "../lib/venues";
import { book, close, MID, STANDARD_ASKS, STANDARD_BIDS } from "./helpers/venue-books";

describe("cross-venue routing", () => {
  // CHEAP has 5 units at 100 then a cliff to 105; RICH is flat at 101.
  const cheap = book("BINANCE", [[99, 100]], [
    [100, 5],
    [105, 100],
  ]);
  const rich = book("BYBIT", [[98, 100]], [[101, 100]]);

  it("sweeps the best prices across venues", () => {
    const { legs, vwap } = smartRoute([cheap, rich], "BUY", 1000);
    const byVenue = Object.fromEntries(legs.map((l) => [l.venue, l]));
    // $500 available at 100 on CHEAP; the rest fills at 101 on RICH, never 105.
    close(byVenue.BINANCE.notional, 500, 0.01, "cheap leg");
    close(byVenue.BYBIT.notional, 500, 0.01, "rich leg");
    close(vwap!, 1000 / (5 + 500 / 101), 1e-9, "blended vwap");
    close(
      legs.reduce((a, l) => a + l.sharePct, 0),
      100,
      0.05,
      "shares sum to 100%",
    );
  });

  it("the route never loses to the worst single venue", () => {
    const report = buildTcaReport("BTCUSDT", "BUY", 1000, [cheap, rich]);
    const singles = report.perVenue.filter((e) => e.fillable).map((e) => e.vwap!);
    assert.ok(report.smartRouteVwap! <= Math.max(...singles));
    assert.ok(report.savingVsWorstUsd! > 0);
  });

  it("fills an order no single venue can absorb", () => {
    // $600 of depth each; neither alone covers $1000, together they do.
    const a = book("BINANCE", [[99, 6.0606]], [[100, 6]]);
    const b = book("BYBIT", [[99, 6.0606]], [[100, 6]]);
    assert.ok(!walkBook(a.asks, "BUY", 1000, a.mid).fillable);
    const { legs } = smartRoute([a, b], "BUY", 1000);
    assert.equal(legs.length, 2);
    close(
      legs.reduce((s, l) => s + l.notional, 0),
      1000,
      0.01,
      "routed notional",
    );
  });

  it("consolidated mid is depth-weighted, not a plain average", () => {
    const thin = book("BINANCE", [[100, 0.01]], [[101, 0.01]]); // mid 100.5
    const deep = book("BYBIT", [[90, 1000]], [[91, 1000]]); // mid 90.5
    const mid = consolidatedMid([thin, deep])!;
    assert.ok(mid < 95, `deep venue must dominate, got ${mid}`);
  });

  it("ignores venues with no book", () => {
    const dead: VenueBook = { ...book("BYBIT", [], []), ok: false };
    const report = buildTcaReport("BTCUSDT", "BUY", 500, [cheap, dead]);
    assert.deepEqual(report.venuesOnline, ["BINANCE"]);
    assert.equal(report.perVenue.length, 1);
  });

  it("empty books yield no route rather than a bogus price", () => {
    const { legs, vwap } = smartRoute([], "BUY", 1000);
    assert.equal(legs.length, 0);
    assert.equal(vwap, null);
  });

  it("a SELL routes against bids, best price first", () => {
    const { legs, vwap } = smartRoute([cheap, rich], "SELL", 500);
    assert.equal(legs[0].venue, "BINANCE"); // 99 beats 98
    close(vwap!, 99, 1e-9, "sell vwap");
  });
});

/**
 * Client-side what-if constraints. These have no Python counterpart by design,
 * so the load-bearing test is the first one: with `opts` omitted the route is
 * byte-identical to the parity path.
 */
describe("what-if routing constraints", () => {
  const cheap = book("BINANCE", [[99, 100]], [[100, 5], [105, 100]]);
  const rich = book("BYBIT", [[98, 100]], [[101, 100]]);
  const standard = book("BINANCE", STANDARD_BIDS, STANDARD_ASKS);

  it("omitting opts leaves the parity path untouched", () => {
    assert.deepEqual(
      smartRoute([cheap, rich], "BUY", 1000),
      smartRoute([cheap, rich], "BUY", 1000, undefined),
    );
    const plain = smartRoute([cheap, rich], "BUY", 1000);
    assert.equal(plain.cappedBy, undefined, "a fully filled route is not capped");
    close(plain.filledNotional, 1000, 0.01, "filled notional");
  });

  it("the include-list is respected, and an empty one routes nothing", () => {
    const only = smartRoute([cheap, rich], "BUY", 1000, { venues: ["BYBIT"] });
    assert.equal(only.legs.length, 1);
    assert.equal(only.legs[0].venue, "BYBIT");
    close(only.legs[0].vwap, 101, 1e-9, "bybit-only vwap");

    const none = smartRoute([cheap, rich], "BUY", 1000, { venues: [] });
    assert.equal(none.legs.length, 0);
    assert.equal(none.filledNotional, 0);
  });

  it("the cap stops the walk exactly where the blend meets the bound", () => {
    // mid 100.5, cap set so vmax = 101.5. Level 1 (101 × 10 = $1010) is inside
    // and fills whole. Level 2 at 102 is outside, so the partial take is
    // t = 102·(101.5·10 − 1010)/(102 − 101.5) = $1020 → $2030 total at vwap 101.5.
    const capBps = ((101.5 - MID) / MID) * 1e4;
    const routed = smartRoute([standard], "BUY", 3000, { maxSlippageBps: capBps, mid: MID });
    close(routed.filledNotional, 2030, 0.01, "notional routable under the cap");
    close(routed.vwap!, 101.5, 1e-9, "blend sits exactly at the bound");
    assert.equal(routed.cappedBy, "slippage");
  });

  it("an order the book cannot fill reports a liquidity cap", () => {
    const routed = smartRoute([standard], "BUY", 1_000_000);
    const depth = 101 * 10 + 102 * 20 + 103 * 30;
    close(routed.filledNotional, depth, 0.01, "all available depth");
    assert.equal(routed.cappedBy, "liquidity");
    close(routed.legs.reduce((s, l) => s + l.notional, 0), depth, 0.02, "legs reconcile");
  });

  it("a cap with no reference price routes nothing rather than pretending", () => {
    const routed = smartRoute([standard], "BUY", 1000, { maxSlippageBps: 10, mid: null });
    assert.equal(routed.legs.length, 0);
    assert.equal(routed.filledNotional, 0);
    assert.equal(routed.cappedBy, "slippage");
  });

  it("passiveQuote joins the touch on the best venue", () => {
    const buy = passiveQuote([cheap, rich], "BUY", MID)!;
    assert.equal(buy.venue, "BINANCE"); // bid 99 beats 98
    assert.equal(buy.price, 99);
    close(buy.spreadCaptureBps!, ((100.5 - 99) / 100.5) * 1e4, 1e-9, "capture if filled");

    const sell = passiveQuote([cheap, rich], "SELL", MID)!;
    assert.equal(sell.venue, "BINANCE"); // ask 100 beats 101
    assert.equal(sell.price, 100);

    assert.equal(passiveQuote([], "BUY", MID), null);
    assert.equal(passiveQuote([cheap], "BUY", null)!.spreadCaptureBps, null);
  });
});
