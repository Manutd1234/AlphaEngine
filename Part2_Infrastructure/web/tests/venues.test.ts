/**
 * Live-feed book maths.
 *
 * These mirror `Part2_Infrastructure/tests/test_tca_engine.py` case for case, on
 * the same hand-computed ladders, so the portal's slippage number and the
 * gateway's cannot drift apart. If the two disagree, a trader gets one execution
 * cost on the web and a different one in Telegram for the same order.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  bandImbalance,
  buildTcaReport,
  consolidatedMid,
  depthUsd,
  depthWithinBps,
  passiveQuote,
  smartRoute,
  spreadBps,
  SYMBOLS,
  walkBook,
  type Level,
  type VenueBook,
  type VenueName,
} from "../lib/venues";

const close = (a: number, b: number, tol = 1e-9, what = "") =>
  assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} !== ${b}`);

function book(
  venue: VenueName,
  bids: Level[],
  asks: Level[],
  symbol = "BTCUSDT",
): VenueBook {
  const bestBid = bids[0]?.[0] ?? null;
  const bestAsk = asks[0]?.[0] ?? null;
  const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : null;
  return {
    venue,
    symbol,
    ok: true,
    latencyMs: 0,
    bids,
    asks,
    bestBid,
    bestAsk,
    mid,
    spreadBps: spreadBps(bestBid, bestAsk),
    depthUsdBid: depthUsd(bids),
    depthUsdAsk: depthUsd(asks),
    imbalance: null,
  };
}

// Same ladder as the Python suite: bids 100/99/98, asks 101/102/103.
const STANDARD_BIDS: Level[] = [
  [100, 10],
  [99, 20],
  [98, 30],
];
const STANDARD_ASKS: Level[] = [
  [101, 10],
  [102, 20],
  [103, 30],
];
const MID = 100.5;

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

// --------------------------------------------------------------------------
// Host failover
// --------------------------------------------------------------------------

describe("every venue client has somewhere to fall back to", () => {
  // Production surfaced the asymmetry these pin: `api.binance.com` answers
  // HTTP 451 from the serverless region and `api.bybit.com` answers HTTP 403,
  // while both work from a laptop. Binance had a mirror and recovered; Bybit
  // had one host and silently dropped out of every "cross-venue" number.
  const source = readFileSync(
    fileURLToPath(new URL("../lib/venues.ts", import.meta.url)),
    "utf8",
  );

  it("declares more than one host per venue", () => {
    const binance = /const BINANCE_HOSTS = \[([^\]]*)\]/s.exec(source)?.[1] ?? "";
    const bybit = /const BYBIT_HOSTS = \[([^\]]*)\]/s.exec(source)?.[1] ?? "";
    assert.ok(
      (binance.match(/https:/g) ?? []).length >= 2,
      "Binance must keep its mirror host",
    );
    assert.ok(
      (bybit.match(/https:/g) ?? []).length >= 2,
      "Bybit needs a fallback host — a single-host venue disappears from consolidated depth when a region is blocked",
    );
  });

  it("walks the whole host list rather than pinning the remembered one", () => {
    // `orderedHosts` returns a PREFERENCE. If it ever returned a single host the
    // memo would become a pin, and one bad answer would strand the venue.
    const fn = /function orderedHosts[^}]*}/s.exec(source)?.[0] ?? "";
    assert.match(fn, /\.\.\.hosts\.filter/, "the non-preferred hosts must still be returned");
    assert.ok(!/return \[hosts\[first\]\];/.test(fn), "orderedHosts must not return a single host");
  });

  it("treats a non-zero Bybit retCode as a host failure, not a book", () => {
    // Bybit refuses at the application layer on an HTTP 200. Without throwing,
    // the loop never reaches the mirror for the one error it exists to route
    // around.
    const fn = /export async function fetchBybitBook[\s\S]*?\n}/.exec(source)?.[0] ?? "";
    assert.match(fn, /retCode !== 0/, "retCode must still be checked");
    assert.match(fn, /for \(const host of orderedHosts\("bybit"/, "Bybit must loop over hosts");
    assert.match(fn, /lastError = \(err as Error\)\.message/, "a failed host must be recorded and the loop continue");
  });
});
