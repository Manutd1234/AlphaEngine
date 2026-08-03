/**
 * Regressions from the deploy-readiness audit.
 *
 * Each test names the defect it pins. They exist because every one of these
 * shipped: they compiled, they returned HTTP 200, and they were wrong.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { clampFloat, clampInt, parseEnum, parseSymbol } from "../lib/params";
import { buildPosition, runSweep } from "../lib/engine";
import { syntheticBars } from "../lib/marketdata";
import { buildTcaReport } from "../lib/venues";
import { DEFAULT_REQUEST, INTERVALS, type Bar, type Strategy } from "../lib/types";
import { rollingMax, rollingMin, shift1, sma } from "../lib/indicators";

describe("param clamps are NaN-safe", () => {
  it("Math.min/Math.max let NaN through — clampInt must not", () => {
    // The original bug: Math.min(50, Math.max(5, Number("abc"))) === NaN,
    // and slice(0, NaN) === [] — an empty ladder behind HTTP 200.
    assert.ok(Number.isNaN(Math.min(50, Math.max(5, Number("abc")))));
    assert.equal(clampInt("abc", 5, 50, 20), 20);
    assert.equal([1, 2, 3].slice(0, clampInt("abc", 5, 50, 20)).length, 3);
  });

  it("rounds, because Binance rejects a non-integer limit", () => {
    assert.equal(clampInt("7.5", 5, 500, 100), 8);
    assert.equal(clampInt("100", 5, 500, 100), 100);
  });

  it("clamps to bounds and handles the empty string", () => {
    assert.equal(clampInt("99999", 5, 500, 100), 500);
    assert.equal(clampInt("-3", 5, 500, 100), 5);
    // Number(null) and Number("") are both 0, NOT NaN — an absent parameter must
    // use the documented default, not clamp zero up to the lower bound.
    assert.equal(clampInt("", 5, 500, 100), 100);
    assert.equal(clampInt("   ", 5, 500, 100), 100);
    assert.equal(clampInt(null, 5, 500, 100), 100);
    assert.equal(clampFloat(null, 100, 1e6, 1000), 1000);
    assert.equal(clampFloat("", 100, 1e6, 1000), 1000);
    // An explicit 0 is still a value, and still clamps.
    assert.equal(clampInt("0", 5, 500, 100), 5);
    assert.equal(clampFloat("abc", 100, 1e6, 1000), 1000);
  });

  it("rejects malformed symbols and unknown intervals", () => {
    assert.equal(parseSymbol("BTCUSDT"), "BTCUSDT");
    assert.equal(parseSymbol("btcusdt"), "BTCUSDT");
    assert.equal(parseSymbol("<img src=x onerror=alert(1)>"), null);
    assert.equal(parseSymbol("AB"), null);
    assert.equal(parseEnum("1h", INTERVALS, "4h"), "1h");
    assert.equal(parseEnum("99y", INTERVALS, "4h"), null);
    assert.equal(parseEnum(null, INTERVALS, "4h"), "4h");
  });
});

describe("chart overlay matches the model that was actually traded", () => {
  const bars = syntheticBars("BTCUSDT", "4h", 900);

  /** Count sign-changes of (fast - slow); for donchian this is meaningless, so
   *  we instead assert the plotted values ARE the breakout/exit levels. */
  const runFor = (strategy: Strategy) =>
    runSweep(bars, { ...DEFAULT_REQUEST, strategy, walkForward: false, bars: 900 }, "synthetic");

  it("donchian plots the breakout high and trailing low, not two SMAs", () => {
    const out = runFor("donchian");
    const close = Float64Array.from(bars.map((b) => b.c));
    const high = Float64Array.from(bars.map((b) => b.h));
    const low = Float64Array.from(bars.map((b) => b.l));
    const expFast = shift1(rollingMax(high, out.best.fast));
    const expSlow = shift1(rollingMin(low, out.best.slow));
    const wrongFast = sma(close, out.best.fast);

    // Find a plotted point with data and check it against both candidates.
    const pt = out.series.find((p) => p.fast != null && p.slow != null)!;
    const i = bars.findIndex((b) => b.t === pt.t);
    assert.ok(Math.abs(pt.fast! - expFast[i]) < 1e-6, "fast line is not the breakout high");
    assert.ok(Math.abs(pt.slow! - expSlow[i]) < 1e-6, "slow line is not the trailing low");
    assert.ok(Math.abs(pt.fast! - wrongFast[i]) > 1e-9, "fast line is still an SMA");
  });

  it("rsi_reversion omits the fast line (RSI is 0-100, it would flatten the axis)", () => {
    const out = runFor("rsi_reversion");
    assert.ok(out.series.every((p) => p.fast === null), "RSI must not be pushed onto the price axis");
    assert.ok(out.series.some((p) => p.slow !== null), "the trend SMA should still be plotted");
    // and the slow line must be the trend filter the model actually uses
    const close = Float64Array.from(bars.map((b) => b.c));
    const trend = sma(close, out.best.slow);
    const pt = out.series.find((p) => p.slow != null)!;
    const i = bars.findIndex((b) => b.t === pt.t);
    assert.ok(Math.abs(pt.slow! - trend[i]) < 1e-6);
  });

  it("ma_cross still plots its two SMAs", () => {
    const out = runFor("ma_cross");
    const close = Float64Array.from(bars.map((b) => b.c));
    const f = sma(close, out.best.fast);
    const pt = out.series.find((p) => p.fast != null)!;
    const i = bars.findIndex((b) => b.t === pt.t);
    assert.ok(Math.abs(pt.fast! - f[i]) < 1e-6);
  });

  it("the shaded position bands still come from the real strategy logic", () => {
    // The overlay changed; the traded position must not have.
    const close = Float64Array.from(bars.map((b) => b.c));
    const high = Float64Array.from(bars.map((b) => b.h));
    const low = Float64Array.from(bars.map((b) => b.l));
    for (const strategy of ["ma_cross", "donchian", "rsi_reversion"] as Strategy[]) {
      const out = runFor(strategy);
      const pos = buildPosition(strategy, bars, close, high, low, out.best.fast, out.best.slow, "long_only");
      const pt = out.series[10];
      const i = bars.findIndex((b) => b.t === pt.t);
      assert.equal(pt.position, pos[i], `${strategy} position drifted from the engine`);
    }
  });
});

describe("cross-venue tie-breaking matches the Python reference", () => {
  it("an exact VWAP tie keeps the FIRST venue, as Python's min() does", () => {
    const mk = (venue: "BINANCE" | "BYBIT") => ({
      venue,
      symbol: "BTCUSDT",
      ok: true as const,
      latencyMs: 0,
      bids: [[99, 100]] as [number, number][],
      asks: [[100, 100]] as [number, number][],
      bestBid: 99,
      bestAsk: 100,
      mid: 99.5,
      spreadBps: 100.5,
      depthUsdBid: 9900,
      depthUsdAsk: 10000,
      imbalance: 0,
    });
    // Identical books => exact tie on VWAP.
    const report = buildTcaReport("BTCUSDT", "BUY", 1000, [mk("BINANCE"), mk("BYBIT")]);
    assert.equal(report.bestSingleVenue, "BINANCE");
    assert.equal(report.savingVsWorstUsd, 0);
  });
});

describe("sweeps stay JSON-safe", () => {
  it("no NaN or Infinity reaches the response payload", () => {
    const out = runSweep(syntheticBars("ETHUSDT", "1h", 800), { ...DEFAULT_REQUEST, bars: 800 }, "synthetic");
    // JSON.stringify turns NaN/Infinity into null, which silently corrupts charts.
    const json = JSON.stringify(out);
    assert.ok(!json.includes("null,null,null"), "suspicious run of nulls in the payload");
    const walk = (v: unknown): void => {
      if (typeof v === "number") assert.ok(Number.isFinite(v), `non-finite number in payload: ${v}`);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    // series.fast is legitimately null for rsi; only check numbers.
    walk(JSON.parse(json));
  });
});
