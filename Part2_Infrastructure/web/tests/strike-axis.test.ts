/** One placement rule for the two figures that share a strike axis. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { money, placeStrikes, strikeOf } from "../lib/coherence/strike-axis";
import type { CoherenceMarketView } from "../lib/coherence/types";

const leg = (ticker: string, floor_strike: string | null, cap_strike: string | null) =>
  ({ ticker, floor_strike, cap_strike }) as unknown as CoherenceMarketView;

describe("money", () => {
  it("reads a fixed-point string and refuses what is not one", () => {
    assert.equal(money("0.2500"), 0.25);
    assert.equal(money(null), null);
    assert.equal(money("abc"), null);
    assert.equal(money("0.0000"), 0, "a reported zero is a number, not an absence");
  });
});

describe("strikeOf", () => {
  it("places a two-sided leg at its midpoint and a one-sided leg at its bound", () => {
    assert.equal(strikeOf(leg("A", "100", "200")), 150);
    assert.equal(strikeOf(leg("B", "100", null)), 100);
    assert.equal(strikeOf(leg("C", null, "200")), 200);
  });
  it("has no position for a leg with neither bound", () => {
    assert.equal(strikeOf(leg("D", null, null)), null);
  });
});

describe("placeStrikes", () => {
  it("sorts by strike, counts what it could not place, and spans the extent", () => {
    const { placed, unplaced, lo, hi } = placeStrikes([
      leg("C", "300", null), leg("A", "100", null), leg("X", null, null), leg("B", "200", null),
    ]);
    assert.deepEqual(placed.map((entry) => entry.market.ticker), ["A", "B", "C"]);
    assert.equal(unplaced, 1);
    assert.deepEqual([lo, hi], [100, 300]);
  });
  it("gives a null extent when nothing can be placed, never a zero", () => {
    const { placed, unplaced, lo, hi } = placeStrikes([leg("X", null, null)]);
    assert.deepEqual([placed.length, unplaced, lo, hi], [0, 1, null, null]);
  });
});
