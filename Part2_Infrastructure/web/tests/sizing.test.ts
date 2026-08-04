/**
 * Kelly sizing and cross-venue dislocation.
 *
 * These are the two pieces adapted from the Kalshi bot's concepts, and both
 * have a tempting wrong version that this file exists to keep out:
 *
 *  - Kelly, given a strategy with no losing trades, has an infinite payoff
 *    ratio if you let it. That drives the fraction to the win rate and sizes a
 *    seven-trade lucky streak at the ceiling.
 *  - A dislocation detector that returns nothing when the market is healthy
 *    cannot be distinguished from one whose feed has died.
 *
 * The Python mirror in `Part2_Infrastructure/tests/test_quant_risk.py` asserts
 * the same properties, so the two implementations cannot drift into disagreeing
 * about a number that appears both in Telegram and on the web tab.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_KELLY_FRACTION,
  MAX_STRATEGY_FRACTION,
  MIN_TRADES_FOR_SIZING,
  kellySizing,
} from "../lib/quant";
import {
  REGIME_SCALE_BOUNDS,
  scaleShocks,
  volatilityRegime,
} from "../lib/portfolio-risk";
import { findDislocation, type VenueBook } from "../lib/venues";

const EQUITY = 1_000_000;

// --------------------------------------------------------------------------
// Kelly
// --------------------------------------------------------------------------

test("kelly matches the closed form", () => {
  // f* = W − (1−W)/R.  W = 0.6, R = 2  →  0.6 − 0.4/2 = 0.4
  const s = kellySizing({
    winRate: 0.6,
    avgWin: 0.02,
    avgLoss: 0.01,
    equity: EQUITY,
    fraction: 1,
    maxFraction: 1,
  });
  assert.equal(s.payoffRatio, 2);
  assert.ok(Math.abs(s.fullKelly - 0.4) < 1e-12, `full kelly ${s.fullKelly}`);
});

test("the fraction scales and the ceiling caps, and says which happened", () => {
  const quarter = kellySizing({
    winRate: 0.6,
    avgWin: 0.02,
    avgLoss: 0.01,
    equity: EQUITY,
    fraction: 0.25,
    maxFraction: 0.2,
  });
  assert.ok(Math.abs(quarter.recommendedFraction - 0.1) < 1e-12, "quarter of 0.4");
  assert.ok(Math.abs(quarter.recommendedNotional - 100_000) < 1e-6);
  assert.equal(quarter.cappedBy, null, "0.1 is under the 0.2 ceiling");

  // W = 0.9, R = 5 → f* = 0.9 − 0.1/5 = 0.88; a quarter is 0.22, over the cap.
  const capped = kellySizing({
    winRate: 0.9,
    avgWin: 0.05,
    avgLoss: 0.01,
    equity: EQUITY,
    fraction: 0.25,
    maxFraction: 0.2,
  });
  assert.equal(capped.cappedBy, "max_fraction");
  assert.equal(capped.recommendedFraction, 0.2);
  assert.ok(capped.uncappedFraction > 0.2, "the uncapped number is kept, not lost");
  assert.equal(capped.maxFraction, 0.2, "the ceiling is reported, not implied");
});

test("no edge sizes to zero and is never inverted", () => {
  // W = 0.3 at 1:1 → f* = 0.3 − 0.7 = −0.4.
  const s = kellySizing({ winRate: 0.3, avgWin: 0.01, avgLoss: 0.01, equity: EQUITY });
  assert.ok(s.fullKelly < 0, "the formula does produce a negative");
  assert.equal(s.recommendedFraction, 0, "but it is floored, not flipped");
  assert.equal(s.recommendedNotional, 0);
  assert.equal(s.cappedBy, "no_edge");
});

test("a run with no losing trades has an undefined payoff, not an infinite one", () => {
  // The dangerous case: seven winners, nothing to divide by. Treated as
  // infinite, f* → W = 1.0 and a quarter of that is the whole ceiling.
  const s = kellySizing({ winRate: 1, avgWin: 0.03, avgLoss: 0, equity: EQUITY });
  assert.equal(s.payoffRatio, 0, "no denominator means no ratio");
  assert.equal(s.recommendedFraction, 0);
  assert.equal(s.cappedBy, "no_edge");
});

test("a run with no trades at all sizes to zero", () => {
  const s = kellySizing({ winRate: 0, avgWin: 0, avgLoss: 0, equity: EQUITY });
  assert.equal(s.recommendedFraction, 0);
  assert.equal(s.recommendedNotional, 0);
});

test("degenerate inputs do not produce a NaN position size", () => {
  for (const input of [
    { winRate: 1.5, avgWin: 0.02, avgLoss: 0.01, equity: EQUITY },
    { winRate: -0.2, avgWin: 0.02, avgLoss: 0.01, equity: EQUITY },
    { winRate: 0.5, avgWin: 0.02, avgLoss: 0.01, equity: -5 },
  ]) {
    const s = kellySizing(input);
    assert.ok(Number.isFinite(s.recommendedFraction), `fraction for ${JSON.stringify(input)}`);
    assert.ok(Number.isFinite(s.recommendedNotional), `notional for ${JSON.stringify(input)}`);
    assert.ok(s.recommendedNotional >= 0, "a position size is never negative");
    assert.ok(s.winRate >= 0 && s.winRate <= 1, "win rate clamps into [0,1]");
  }
});

test("a thin sample is flagged, and an unstated one is not assumed adequate", () => {
  // Live BTC/4h at the defaults: ma_cross found a real-looking 17.7% allocation
  // from six trades. The formula cannot see the difference; the flag can.
  const thin = kellySizing({ winRate: 0.83, avgWin: 0.0547, avgLoss: 0.0413, trades: 6, equity: EQUITY });
  assert.equal(thin.thinSample, true);
  assert.ok(thin.recommendedFraction > 0.1, "the number is still produced, just labelled");

  const deep = kellySizing({ winRate: 0.83, avgWin: 0.0547, avgLoss: 0.0413, trades: 400, equity: EQUITY });
  assert.equal(deep.thinSample, false);

  const unknown = kellySizing({ winRate: 0.83, avgWin: 0.0547, avgLoss: 0.0413, equity: EQUITY });
  assert.equal(unknown.thinSample, true, "omitting the trade count means unknown, never 'enough'");
});

test("the defaults are the fractional, capped ones", () => {
  assert.equal(DEFAULT_KELLY_FRACTION, 0.25, "quarter Kelly, not full");
  assert.equal(MAX_STRATEGY_FRACTION, 0.2);
  assert.equal(MIN_TRADES_FOR_SIZING, 30, "same hurdle the promotion gate uses");
  const s = kellySizing({ winRate: 0.6, avgWin: 0.02, avgLoss: 0.01, equity: EQUITY });
  assert.equal(s.fractionUsed, 0.25, "omitting the fraction must not mean full Kelly");
});

// --------------------------------------------------------------------------
// Dislocation
// --------------------------------------------------------------------------

function book(
  venue: string,
  bid: number,
  ask: number,
  bidSize = 5,
  askSize = 5,
): VenueBook {
  return {
    venue: venue as VenueBook["venue"],
    symbol: "BTCUSDT",
    ok: true,
    latencyMs: 10,
    bids: [[bid, bidSize]],
    asks: [[ask, askSize]],
    bestBid: bid,
    bestAsk: ask,
    mid: (bid + ask) / 2,
    spreadBps: ((ask - bid) / ((bid + ask) / 2)) * 1e4,
    depthUsdBid: bid * bidSize,
    depthUsdAsk: ask * askSize,
    imbalance: 0,
  };
}

test("a healthy uncrossed market is reported, not returned as nothing", () => {
  // B bids inside A's offer: the touch spans both venues without crossing.
  const d = findDislocation([book("BINANCE", 99.5, 100.5), book("BYBIT", 100, 101)], "BTCUSDT");
  assert.ok(d, "the normal case must produce a report");
  assert.equal(d.crossed, false);
  assert.equal(d.buyVenue, null);
  assert.match(d.note, /normal state/);
});

test("one venue holding both sides of the touch is its own spread, not an arbitrage", () => {
  const d = findDislocation([book("BINANCE", 100, 100.5), book("BYBIT", 99.9, 100.6)], "BTCUSDT");
  assert.ok(d);
  assert.equal(d.crossed, false);
  assert.match(d.note, /own spread/);
});

test("a crossed market names both legs in the right direction", () => {
  // BYBIT bids 101 while BINANCE offers 100 — buy BINANCE, sell BYBIT.
  const d = findDislocation([book("BINANCE", 99.8, 100), book("BYBIT", 101, 101.2)], "BTCUSDT");
  assert.ok(d);
  assert.equal(d.crossed, true);
  assert.equal(d.buyVenue, "BINANCE");
  assert.equal(d.sellVenue, "BYBIT");
  assert.ok(Math.abs(d.edgeUsdPerUnit - 1) < 1e-12);
  assert.ok(d.edgeBps > 0);
});

test("executable size is the smaller leg, since both have to fill", () => {
  const d = findDislocation(
    [book("BINANCE", 99.8, 100, 5, 0.4), book("BYBIT", 101, 101.2, 9, 5)],
    "BTCUSDT",
  );
  assert.ok(d);
  assert.ok(Math.abs(d.executableSize - 0.4) < 1e-12, "min(0.4, 9), never max or sum");
  assert.ok(Math.abs(d.grossEdgeUsd - 0.4) < 1e-12, "$1/unit on 0.4 units");
});

test("the edge is labelled gross, because the fees usually exceed it", () => {
  const d = findDislocation([book("BINANCE", 99.8, 100), book("BYBIT", 101, 101.2)], "BTCUSDT");
  assert.ok(d);
  assert.match(d.note, /[Gg]ross of fees/);
});

test("one live venue cannot cross itself", () => {
  assert.equal(findDislocation([book("BINANCE", 100, 100.5)], "BTCUSDT"), null);
  const halfDown: VenueBook = { ...book("BYBIT", 100, 100.5), ok: false };
  assert.equal(findDislocation([book("BINANCE", 100, 100.5), halfDown], "BTCUSDT"), null);
});

// --------------------------------------------------------------------------
// Volatility regime
// --------------------------------------------------------------------------

test("a quiet instrument that stays quiet is NORMAL, not COMPRESSED", () => {
  // The bug this pins: counting ties as "below" puts a constant series at the
  // 100th percentile and labels a perfectly calm market STRESSED.
  const calm = Array.from({ length: 120 }, (_, i) => (i % 2 ? 0.001 : -0.001));
  const r = volatilityRegime(calm);
  assert.ok(r);
  assert.equal(r.regime, "NORMAL");
  assert.ok(Math.abs(r.percentile - 0.5) < 0.01, `mid-rank puts a constant series at 0.5, got ${r.percentile}`);
});

test("a volatility spike reads as stressed, and the ratio exceeds one", () => {
  const base = Array.from({ length: 100 }, (_, i) => (i % 2 ? 0.002 : -0.002));
  const spike = Array.from({ length: 25 }, (_, i) => (i % 2 ? 0.05 : -0.05));
  const r = volatilityRegime([...base, ...spike]);
  assert.ok(r);
  assert.equal(r.regime, "STRESSED");
  assert.ok(r.ratio > 1);
  assert.ok(r.percentile >= 0.85);
});

test("the regime is relative, so an absolute vol level does not decide it", () => {
  // Same shape, 50× the amplitude. A threshold on raw volatility would call the
  // second one stressed; a percentile of its own history calls both normal.
  const shape = (k: number) => Array.from({ length: 120 }, (_, i) => (i % 2 ? k : -k));
  const quiet = volatilityRegime(shape(0.001));
  const loud = volatilityRegime(shape(0.05));
  assert.ok(quiet && loud);
  assert.equal(quiet.regime, loud.regime, "a regime is a statement about now, not about the asset class");
});

test("too little history returns null rather than a label", () => {
  assert.equal(volatilityRegime(Array.from({ length: 30 }, () => 0.01), { window: 20 }), null);
  assert.equal(volatilityRegime([]), null);
});

test("scaling is clamped, and a missing regime leaves the shocks alone", () => {
  const shocks = [{ symbol: "BTCUSDT", move: -0.2 }];
  assert.deepEqual(scaleShocks(shocks, null), shocks, "no regime means no adjustment");

  const [lo, hi] = REGIME_SCALE_BOUNDS;
  const stub = (ratio: number) => ({
    regime: "NORMAL" as const,
    currentVol: 0, baselineVol: 0, ratio, percentile: 0.5, observations: 50, note: "",
  });
  assert.ok(Math.abs(scaleShocks(shocks, stub(9))[0].move - -0.2 * hi) < 1e-12, "clamped above");
  assert.ok(Math.abs(scaleShocks(shocks, stub(1.5))[0].move - -0.3) < 1e-12, "passed through in range");
  assert.equal(lo, 1, "the floor is 1, not 0.5 — see below");
});

test("a calm regime never shrinks a stress scenario", () => {
  // The symmetric version of this is the obvious one and it is backwards. Live
  // BTC at the 29th percentile gave a ratio of 0.78, which would have relaxed a
  // −20% cascade to −15.6% — reporting the most reassuring number precisely
  // when a quiet regime is closest to ending. Scaling is one-directional.
  const shocks = [{ symbol: "BTCUSDT", move: -0.2 }];
  const calm = {
    regime: "COMPRESSED" as const,
    currentVol: 0.3, baselineVol: 0.39, ratio: 0.78, percentile: 0.05, observations: 900, note: "",
  };
  assert.equal(scaleShocks(shocks, calm)[0].move, -0.2, "a quiet market leaves the scenario intact");
});

test("scaling preserves the wildcard symbol, not just the magnitude", () => {
  // `*` is what propagates a shock to every unshocked position via beta. Losing
  // it while rescaling would silently narrow the scenario to one instrument.
  const scaled = scaleShocks(
    [{ symbol: "BTCUSDT", move: -0.2 }, { symbol: "*", move: -0.25 }],
    { regime: "NORMAL", currentVol: 0, baselineVol: 0, ratio: 1.5, percentile: 0.5, observations: 50, note: "" },
  );
  assert.deepEqual(scaled.map((s) => s.symbol), ["BTCUSDT", "*"]);
});
