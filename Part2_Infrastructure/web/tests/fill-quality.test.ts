/**
 * Fill quality: what the audit log can prove, and what it cannot.
 *
 * Three of the four measures the brief asked for are derivable and one is not,
 * and the difference is traceable rather than a matter of taste:
 *
 *  - Effective spread IS `2 x |slippageBps|`, not an approximation of it.
 *    `risk_proxy.py` computes slippage against `mark()`, which resolves through
 *    `tca_engine.py` to `consolidated_mid(symbol)` at decision time — so the
 *    reference is already M_decision and the textbook formula is satisfied.
 *  - Price improvement is a signal the gateway authors deliberately: the
 *    `_maker_fill` path documents that a resting fill's slippage is "usually
 *    negative — price improvement against the mark".
 *  - Fee in bps is arithmetic on two stored fields.
 *  - Realized spread needs a post-trade mid that no endpoint serves. It is
 *    withheld, and the tests below pin that it is withheld rather than zeroed.
 *
 * The whole suite is really one property, checked from several directions: a
 * measure nobody took must come back null, never 0, because on a cost surface
 * zero is a claim.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  MIN_PRICED_FILLS,
  REALIZED_SPREAD_WITHHELD,
  effectiveSpreadBps,
  feeBps,
  priceImprovement,
  sandboxBlotter,
  summarise,
  venueQuality,
  type BlotterRow,
} from "../lib/blotter";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const fill = (over: Partial<BlotterRow> = {}): BlotterRow => ({
  ts: "2026-01-01T00:00:00Z", orderId: "o1", clientOrderId: null, strategy: "ma_cross",
  symbol: "BTCUSDT", side: "BUY", orderType: "MARKET", quantity: 1, notional: 100_000,
  accepted: true, rejectedBy: [], reason: null, latencyMs: 0.2, fillPrice: 100,
  feeUsd: 60, slippageBps: 4, venue: "BINANCE", source: "gateway",
  status: "FILLED", timeInForce: "IOC", checks: [], ...over,
});

describe("effective spread is the formula, not a stand-in", () => {
  it("doubles the absolute slippage in either direction", () => {
    assert.equal(effectiveSpreadBps(fill({ slippageBps: 4 })), 8);
    // A maker fill prices inside the mid; the spread it crossed is still a width.
    assert.equal(effectiveSpreadBps(fill({ slippageBps: -4 })), 8);
  });

  it("returns null, never zero, for a fill nobody priced", () => {
    assert.equal(effectiveSpreadBps(fill({ slippageBps: null })), null);
    assert.notEqual(effectiveSpreadBps(fill({ slippageBps: null })), 0);
  });
});

describe("fee in bps guards its own denominator", () => {
  it("converts a fee against notional", () => {
    // Tolerance, not equality: (60/100000)*1e4 is 6.000000000000001 in binary
    // floating point, and asserting exactness here would be testing IEEE 754.
    assert.ok(Math.abs(feeBps(fill({ feeUsd: 60, notional: 100_000 }))! - 6) < 1e-9);
  });

  it("refuses to divide by a zero or missing notional", () => {
    assert.equal(feeBps(fill({ notional: 0 })), null);
    assert.equal(feeBps(fill({ notional: null })), null);
    assert.equal(feeBps(fill({ feeUsd: null })), null);
  });

  it("reads a short's notional by magnitude", () => {
    assert.ok(Math.abs(feeBps(fill({ feeUsd: 60, notional: -100_000 }))! - 6) < 1e-9);
  });
});

describe("venue quality is a mix, and says which fills it could not place", () => {
  it("puts an untagged fill in unattributed and in no venue bucket", () => {
    // An order that never filled never reached a venue, so a per-venue FILL
    // RATIO is not computable from this data at all — only the mix of fills.
    const mix = venueQuality([fill(), fill({ venue: null })]);
    assert.equal(mix.unattributed, 1);
    assert.equal(mix.venues.length, 1);
    assert.equal(mix.venues[0].fills, 1);
  });

  it("ignores unfilled rows entirely", () => {
    const mix = venueQuality([fill(), fill({ status: "REJECTED", accepted: false, venue: null })]);
    assert.equal(mix.totalFills, 1);
    assert.equal(mix.unattributed, 0);
  });

  it("averages over the rows that carry the measure, not over every fill", () => {
    /**
     * The bug this prevents: dividing by the fill count instead of the priced
     * count drags every mean toward zero in proportion to how much data is
     * missing — a chart that looks better the less it knows.
     */
    const mix = venueQuality([
      fill({ slippageBps: 4 }),
      fill({ slippageBps: null, feeUsd: null }),
    ]);
    assert.equal(mix.venues[0].fills, 2);
    assert.equal(mix.venues[0].effectiveSpreadBps, 8, "must be 8, not 4");
  });

  it("keeps realized spread withheld on every venue", () => {
    for (const venue of venueQuality(sandboxBlotter()).venues) {
      assert.equal(venue.realizedSpreadBps, null);
    }
    assert.ok(REALIZED_SPREAD_WITHHELD.length > 80, "the withheld leg must explain itself");
    assert.match(REALIZED_SPREAD_WITHHELD, /tca_snapshots/, "name the table that has it");
  });

  it("reconciles with the KPI row it sits beside", () => {
    // Pins the donut's denominator against the fill count so the two panels can
    // never disagree on screen about how many fills there were.
    const rows = sandboxBlotter();
    const mix = venueQuality(rows);
    const placed = mix.venues.reduce((sum, v) => sum + v.fills, 0);
    assert.equal(placed + mix.unattributed, summarise(rows).accepted);
  });
});

describe("price improvement counts only fills that beat the mid", () => {
  it("counts negative slippage and reports the mean as a positive width", () => {
    const result = priceImprovement([
      fill({ slippageBps: -3 }), fill({ slippageBps: -5 }), fill({ slippageBps: 7 }),
    ]);
    assert.equal(result.n, 3);
    assert.equal(result.improved, 2);
    assert.equal(result.meanBps, 4);
  });

  it("distinguishes no fills from no improvement", () => {
    const none = priceImprovement([]);
    assert.equal(none.rate, null, "no fills is not a zero rate");
    const worse = priceImprovement([fill({ slippageBps: 7 })]);
    assert.equal(worse.rate, 0, "one measured fill that did not improve IS a zero rate");
  });

  it("reads zero improvement on the sandbox, which is correct and must stay caveated", () => {
    /**
     * `sandboxBlotter` draws slippage as avgSlippageBps * (0.55 + rand*0.9) —
     * always positive, so its fills are taker-side by construction and none can
     * beat the mid. That is a correct measurement of a generated desk, not a
     * bug, and the panel captions it.
     *
     * This assertion exists so that if anyone "fixes" the generator, the
     * caption explaining the zero gets flagged as stale in the same commit.
     * Editing it would also shift the mulberry32 stream and break the sandbox
     * reconciliation suites.
     */
    assert.equal(priceImprovement(sandboxBlotter()).improved, 0);
  });
});

describe("the floor is shared, not re-invented", () => {
  it("is one constant, and the heatmap reads it", () => {
    assert.equal(MIN_PRICED_FILLS, 8);
    assert.match(
      read("../components/execution/FillQualityHeatmap.tsx"),
      /MIN_PRICED_FILLS/,
      "a second local threshold would let one subtab disagree with itself",
    );
  });
});
