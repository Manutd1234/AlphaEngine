/**
 * Single-book maths: the universe, the ladder walk, the band.
 *
 * These mirror `Part2_Infrastructure/tests/test_tca_engine.py` case for case, on
 * the same hand-computed ladders, so the portal's slippage number and the
 * gateway's cannot drift apart. If the two disagree, a trader gets one execution
 * cost on the web and a different one in Telegram for the same order.
 *
 * What this file defends is the arithmetic one venue's book supports on its own —
 * the spread, what a given notional actually fills at, how much is resting inside
 * a price band, and which way the imbalance leans. Everything that needs a second
 * venue is in `venues-routing.test.ts`; the fill gate's tolerance convention is in
 * `venues-fill-tolerance.test.ts`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  bandImbalance,
  depthUsd,
  depthWithinBps,
  spreadBps,
  SYMBOLS,
  walkBook,
  type Level,
} from "../lib/venues";
import { close, MID, STANDARD_ASKS, STANDARD_BIDS } from "./helpers/venue-books";

describe("the direct L2 universe", () => {
  it("offers the expanded twelve-pair trading watchlist", () => {
    assert.deepEqual(SYMBOLS, [
      "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT",
      "DOGEUSDT", "AVAXUSDT", "LINKUSDT", "DOTUSDT", "LTCUSDT", "TRXUSDT",
    ]);
  });
});

describe("book maths", () => {
  it("spread in bps", () => {
    close(spreadBps(100, 101)!, (1 / 100.5) * 1e4, 1e-9, "spread");
    assert.equal(spreadBps(null, 101), null);
  });

  it("walks a single level", () => {
    // $505 buys 5 units at 101 exactly.
    const e = walkBook(STANDARD_ASKS, "BUY", 505, MID);
    assert.ok(e.fillable);
    close(e.vwap!, 101, 1e-9, "vwap");
    close(e.filledQty, 5, 1e-9, "qty");
    assert.equal(e.levelsConsumed, 1);
    close(e.slippageBps!, (0.5 / 100.5) * 1e4, 1e-9, "slippage");
  });

  it("walks multiple levels and blends the VWAP", () => {
    // 101*10 = 1010 clears level one; the remaining 1020 buys 10 at 102.
    const e = walkBook(STANDARD_ASKS, "BUY", 2030, MID);
    assert.ok(e.fillable);
    assert.equal(e.levelsConsumed, 2);
    close(e.filledQty, 20, 1e-9, "qty");
    close(e.vwap!, 2030 / 20, 1e-9, "vwap");
  });

  it("reports a partial fill rather than pretending", () => {
    const e = walkBook(STANDARD_ASKS, "BUY", 1_000_000, MID);
    assert.equal(e.fillable, false);
    close(e.filledNotional, 101 * 10 + 102 * 20 + 103 * 30, 0.01, "filled");
  });

  it("selling below mid is positive (adverse) slippage", () => {
    const e = walkBook(STANDARD_BIDS, "SELL", 1000, MID);
    close(e.vwap!, 100, 1e-9, "vwap");
    assert.ok(e.slippageBps! > 0);
  });

  it("depth sums notional, not size", () => {
    close(depthUsd([[100, 30]]), 3000, 1e-9, "depth");
  });
});

describe("band depth", () => {
  it("counts only what rests inside the band", () => {
    const mid = 100;
    // 10 bps of 100 = 0.1, so 99.90 is the boundary and 99.80 is outside.
    const bids: Level[] = [
      [99.95, 10],
      [99.9, 10],
      [99.8, 1000],
    ];
    close(depthWithinBps(bids, mid, "bid", 10), 99.95 * 10 + 99.9 * 10, 1e-9, "bid band");
  });

  it("is invariant to how finely a venue ticks", () => {
    const mid = 100;
    // Same $ resting either side of mid, split across 2 levels vs 20.
    const coarse: Level[] = [
      [100.02, 5],
      [100.04, 5],
    ];
    const fine: Level[] = Array.from({ length: 20 }, (_, i) => [100.002 * (1 + i / 1e5), 0.5] as Level);
    const a = depthWithinBps(coarse, mid, "ask", 10);
    const b = depthWithinBps(fine, mid, "ask", 10);
    close(a, b, 1.5, "tick-density invariance");
    // Counting levels instead would be off by 10x.
    assert.ok(Math.abs(depthUsd(coarse, 20) - depthUsd(fine, 2)) > 400);
  });

  it("imbalance is signed and bounded", () => {
    const mid = 100;
    const heavyBid = bandImbalance([[99.99, 100]], [[100.01, 1]], mid)!;
    assert.ok(heavyBid > 0.9 && heavyBid <= 1);
    const balanced = bandImbalance([[99.99, 10]], [[100.01, 10]], mid)!;
    close(balanced, 0, 1e-3, "balanced");
    assert.equal(bandImbalance([], [], mid), null);
  });

  it("returns zero without a mid rather than guessing", () => {
    assert.equal(depthWithinBps([[100, 5]], null, "bid"), 0);
  });
});
