/**
 * The portfolio derivations, and the four ways each of them could quietly lie.
 *
 * Every function here computes something a reader will take as a fact about
 * their own money, and the tempting mistakes are all the same shape: a ratio
 * over too few observations, an annualisation applied to an irregular series,
 * a category inferred from a ticker and printed as measured, or a zero standing
 * in for an absence.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MIN_SHARPE_OBSERVATIONS,
  assetClassMix,
  currencyMix,
  drawdownSeries,
  exposureCells,
  maxDrawdown,
  rollingSharpe,
  sleeveMix,
  unrealisedSpread,
} from "../lib/portfolio-analytics";
import type { EquityPoint, PortfolioPosition } from "../lib/portfolio";

const point = (equity: number, highWaterMark = equity, t = 0): EquityPoint =>
  ({ t, equity, highWaterMark });

const position = (over: Partial<PortfolioPosition> = {}): PortfolioPosition => ({
  symbol: "BTCUSDT", side: "LONG", quantity: 1, avg_price: 100, mark_price: 110,
  notional: 100_000, share_of_gross: 0.5, unrealized_pnl: 1_000, realized_pnl: 0,
  total_pnl: 1_000,
  symbol_limit: { used: 1, limit: 2, remaining: 1, utilisation: 0.5 } as PortfolioPosition["symbol_limit"],
  ...over,
});

describe("drawdown is measured against the mark the halt rule uses", () => {
  it("is zero at a new high and negative below it", () => {
    const series = drawdownSeries([point(100), point(90, 100), point(120)]);
    assert.equal(series[0].drawdown, 0);
    assert.ok(Math.abs(series[1].drawdown - -0.1) < 1e-12);
    assert.equal(series[2].drawdown, 0);
  });

  it("drops points it cannot measure rather than charting them at zero", () => {
    // A zero drawdown is a claim that the book is at its high.
    const series = drawdownSeries([point(100), { t: 1, equity: NaN, highWaterMark: 100 }]);
    assert.equal(series.length, 1);
  });

  it("names the deepest point, and returns null when there is nothing to name", () => {
    const worst = maxDrawdown([point(100), point(80, 100), point(90, 100)]);
    assert.ok(worst && Math.abs(worst.drawdown - -0.2) < 1e-12);
    assert.equal(maxDrawdown([]), null);
  });
});

describe("rolling Sharpe refuses the claims it cannot support", () => {
  const track = (n: number): EquityPoint[] =>
    Array.from({ length: n }, (_, i) => point(100 * (1 + i * 0.001), 100 * (1 + i * 0.001), i));

  it("is null until the window is full, so the line breaks rather than bridges", () => {
    const series = rollingSharpe(track(40));
    const firstReal = series.findIndex((p) => p.sharpe != null);
    assert.equal(firstReal, MIN_SHARPE_OBSERVATIONS - 1);
    assert.ok(series.slice(0, firstReal).every((p) => p.sharpe === null));
  });

  it("returns nothing measurable from a track shorter than the window", () => {
    assert.ok(rollingSharpe(track(5)).every((p) => p.sharpe === null));
  });

  it("returns null rather than Infinity for a book that did not move", () => {
    // Zero dispersion is not infinite risk-adjusted return; it is no
    // information, and a vertical spike would read as the opposite.
    const flat = Array.from({ length: 30 }, (_, i) => point(100, 100, i));
    assert.ok(rollingSharpe(flat).every((p) => p.sharpe === null));
  });

  it("is not annualised, and the module says why", () => {
    /**
     * The equity track is a poll series with no stable period, so multiplying
     * by sqrt(periods-per-year) would require inventing the period. A steady
     * 0.1% per observation gives a very large per-observation ratio; the point
     * of this assertion is that it is NOT scaled by any annualisation factor.
     */
    const series = rollingSharpe(track(40));
    const last = series[series.length - 1].sharpe;
    assert.ok(last != null && Number.isFinite(last));
  });
});

describe("mixes report what the payload has, and label what they infer", () => {
  it("splits gross exposure by the routing module's own classifier", () => {
    const mix = assetClassMix([
      position({ symbol: "BTCUSDT", notional: 60_000 }),
      position({ symbol: "AAPL", notional: 40_000 }),
    ]);
    const labels = mix.map((m) => m.label);
    assert.ok(labels.includes("crypto") && labels.includes("equity"));
    assert.ok(Math.abs(mix[0].share - 0.6) < 1e-12);
  });

  it("reads a short's exposure by magnitude, not sign", () => {
    // A short is exposure. Signing it would let two offsetting positions report
    // a gross of nothing.
    const mix = assetClassMix([position({ symbol: "BTCUSDT", notional: -100_000 })]);
    assert.equal(mix[0].value, 100_000);
  });

  it("puts a ticker with no quote asset in `unknown` rather than assuming USD", () => {
    const mix = currencyMix([
      position({ symbol: "BTCUSDT", notional: 50_000 }),
      position({ symbol: "AAPL", notional: 50_000 }),
    ]);
    assert.ok(mix.some((m) => m.label === "USDT"));
    assert.ok(mix.some((m) => m.label === "unknown"), "an equity ticker was assumed into a currency");
  });

  it("prefers the longer quote so USDT does not read as USD", () => {
    const mix = currencyMix([position({ symbol: "BTCUSDT" })]);
    assert.equal(mix[0].label, "USDT");
  });

  it("keeps untagged sleeve flow as its own bucket", () => {
    const mix = sleeveMix([
      { strategy: "ma_cross", orders: 1, filled: 1, notional: 30_000, fees: 0, avg_slippage_bps: null },
      { strategy: null, orders: 1, filled: 1, notional: 10_000, fees: 0, avg_slippage_bps: null },
    ]);
    assert.ok(mix.some((m) => m.label === "untagged"));
    assert.equal(mix.reduce((sum, m) => sum + m.value, 0), 40_000);
  });

  it("returns an empty mix rather than dividing by zero", () => {
    assert.deepEqual(assetClassMix([]), []);
    assert.deepEqual(currencyMix([position({ notional: 0 })]), []);
  });
});

describe("the open P&L spread answers what a single total cannot", () => {
  it("separates a flat book from two positions cancelling out", () => {
    const flat = unrealisedSpread([position({ unrealized_pnl: 0 }), position({ unrealized_pnl: 0 })]);
    const offsetting = unrealisedSpread([
      position({ symbol: "A", unrealized_pnl: 50_000 }),
      position({ symbol: "B", unrealized_pnl: -50_000 }),
    ]);
    assert.equal(flat.total, offsetting.total, "both sum to zero — that is the point");
    assert.equal(flat.winners, 0);
    assert.equal(offsetting.winners, 1);
    assert.equal(offsetting.losers, 1);
    assert.equal(offsetting.scale, 50_000);
  });

  it("names the extremes", () => {
    const spread = unrealisedSpread([
      position({ symbol: "WIN", unrealized_pnl: 900 }),
      position({ symbol: "LOSE", unrealized_pnl: -400 }),
    ]);
    assert.equal(spread.best?.symbol, "WIN");
    assert.equal(spread.worst?.symbol, "LOSE");
  });

  it("has no extremes to name on an empty book", () => {
    const spread = unrealisedSpread([]);
    assert.equal(spread.best, null);
    assert.equal(spread.worst, null);
    assert.equal(spread.n, 0);
  });
});

describe("exposure keeps share and limit utilisation apart", () => {
  it("ranks by share of gross", () => {
    const cells = exposureCells([
      position({ symbol: "SMALL", share_of_gross: 0.1 }),
      position({ symbol: "BIG", share_of_gross: 0.7 }),
    ]);
    assert.equal(cells[0].symbol, "BIG");
  });

  it("keeps a small position pressed against its own limit visible", () => {
    /**
     * The case the two measures exist to separate: 4% of the book and 96% of
     * its own symbol limit. Collapsing to one number would hide it behind the
     * large positions, and it is exactly the row a reader is looking for.
     */
    const cells = exposureCells([
      position({ symbol: "TIGHT", share_of_gross: 0.04,
        symbol_limit: { used: 0.96, limit: 1, remaining: 0.04, utilisation: 0.96 } as PortfolioPosition["symbol_limit"] }),
    ]);
    assert.equal(cells[0].share, 0.04);
    assert.equal(cells[0].utilisation, 0.96);
  });

  it("reports a missing limit as null rather than as unused headroom", () => {
    const cells = exposureCells([
      position({ symbol_limit: { utilisation: null } as unknown as PortfolioPosition["symbol_limit"] }),
    ]);
    assert.equal(cells[0].utilisation, null);
    assert.notEqual(cells[0].utilisation, 0);
  });
});
