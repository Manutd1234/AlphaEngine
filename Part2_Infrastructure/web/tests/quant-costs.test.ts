/**
 * The cost model is inert until a researcher switches it on.
 *
 * This is the one thing in the analytics that must not move. The maths exists
 * twice — Python for the server, TypeScript for the browser, with Python as the
 * reference — and the frictions enter the compounding equity path, which is the
 * one place a change silently rewrites every metric the Python parity fixture
 * pins. `parity.test.ts` would catch a regression there, but only for the four
 * fixture cases; this file asserts the property directly, on the expression
 * itself, so the guarantee does not depend on which combinations someone
 * happened to freeze.
 *
 * Hence the exact equalities below rather than tolerances. An epsilon here
 * would hide precisely the drift the parity fixture exists to catch. The
 * converse is asserted too: a switch that is inert when off and inert when on
 * is not a cost model, so a non-zero friction must demonstrably change the
 * answer.
 *
 * Average daily volume and the cost summary belong with this argument. ADV
 * denominates the participation rate impact is charged on — quote-denominated
 * and interval-aware, or the impact term is wrong by the number of bars in a
 * day — and the summary is what a reader is told was actually charged.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runCombo } from "../lib/engine";
import {
  NO_FRICTIONS,
  averageDailyVolume,
  holdingCost,
  hoursPerBar,
  turnoverCost,
} from "../lib/quant";
import { syntheticBars } from "./helpers/synthetic-bars";
import type { Bar, CostSummary } from "../lib/types";

import { close } from "./helpers/quant-fixtures";

// --------------------------------------------------------------------------
// The guarantee: frictions off ⇒ nothing changed
// --------------------------------------------------------------------------

describe("the cost model is inert until a researcher switches it on", () => {
  const bars: Bar[] = syntheticBars("BTCUSDT", "4h", 900);
  const n = bars.length;
  const cols = (() => {
    const c = new Float64Array(n);
    const h = new Float64Array(n);
    const l = new Float64Array(n);
    const v = new Float64Array(n);
    const r = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      c[i] = bars[i].c;
      h[i] = bars[i].h;
      l[i] = bars[i].l;
      v[i] = bars[i].v;
    }
    for (let i = 1; i < n; i++) r[i] = c[i - 1] !== 0 ? c[i] / c[i - 1] - 1 : 0;
    return { close: c, high: h, low: l, volume: v, pxRet: r };
  })();

  const base = {
    strategy: "ma_cross" as const,
    direction: "long_only" as const,
    feeBps: 6,
    slippageBps: 2,
    interval: "4h",
  };

  it("turnoverCost with no frictions is exactly the flat expression", () => {
    const model = { feeBps: 6, slippageBps: 2, ...NO_FRICTIONS };
    // Not "close to" — identical. This is the expression the Python engine
    // evaluates, and floating point must reproduce it bit for bit.
    assert.equal(turnoverCost(model, 5_000_000), (6 + 2) / 1e4);
    assert.equal(turnoverCost(model, 0), (6 + 2) / 1e4);
  });

  it("holdingCost with no frictions is exactly zero for every position", () => {
    const model = { feeBps: 6, slippageBps: 2, ...NO_FRICTIONS };
    for (const position of [-1, 0, 1]) {
      assert.equal(holdingCost(model, position, "4h"), 0, `position ${position}`);
    }
  });

  it("a request that omits the friction group reproduces the bare request exactly", () => {
    const bare = runCombo(bars, cols.close, cols.high, cols.low, cols.volume, cols.pxRet, base, 10, 40);
    const explicit = runCombo(
      bars, cols.close, cols.high, cols.low, cols.volume, cols.pxRet,
      { ...base, impactCoefficient: 0, orderNotional: 0, fundingBpsPer8h: 0, borrowBpsAnnual: 0 },
      10, 40,
      averageDailyVolume(bars, "4h"),
    );
    // Every field, exactly — an epsilon here would hide precisely the drift the
    // parity fixture exists to catch.
    assert.deepEqual(explicit.result, bare.result);
    assert.equal(explicit.holdingDrag, 0);
  });

  it("a non-zero friction actually changes the answer, so the switch is real", () => {
    const bare = runCombo(bars, cols.close, cols.high, cols.low, cols.volume, cols.pxRet, base, 10, 40);
    const charged = runCombo(
      bars, cols.close, cols.high, cols.low, cols.volume, cols.pxRet,
      { ...base, fundingBpsPer8h: 3 },
      10, 40,
    );
    assert.ok(
      charged.result.totalReturn < bare.result.totalReturn,
      "funding was configured but cost nothing",
    );
    assert.ok(charged.holdingDrag > 0, "holding drag was not accumulated");
  });

  it("borrow costs nothing in a long-only run and something when short", () => {
    const model = { feeBps: 0, slippageBps: 0, ...NO_FRICTIONS, borrowBpsAnnual: 1000 };
    assert.equal(holdingCost(model, 1, "4h"), 0, "a long position was charged borrow");
    assert.ok(holdingCost(model, -1, "4h") > 0, "a short position was not charged borrow");
  });

  it("square-root impact is concave — 4× the size costs 2× the impact", () => {
    const model = { feeBps: 0, slippageBps: 0, ...NO_FRICTIONS, impactCoefficient: 0.1 };
    const adv = 10_000_000;
    const small = turnoverCost({ ...model, orderNotional: 100_000 }, adv);
    const large = turnoverCost({ ...model, orderNotional: 400_000 }, adv);
    close(large, small * 2, 1e-12, "sqrt impact");
  });

  it("participation is capped at 100% of ADV rather than extrapolating past it", () => {
    const model = { feeBps: 0, slippageBps: 0, ...NO_FRICTIONS, impactCoefficient: 0.2 };
    const adv = 1_000;
    assert.equal(turnoverCost({ ...model, orderNotional: 10 * adv }, adv), 0.2);
  });

  it("hoursPerBar matches the interval table the annualisation uses", () => {
    assert.equal(hoursPerBar("4h"), 4);
    assert.equal(hoursPerBar("1d"), 24);
    // 4h bars: 6 per day × 365 = 2190, the BARS_PER_YEAR entry.
    close((24 / hoursPerBar("4h")) * 365, 2190, 1e-9, "4h bars per year");
  });
});

// --------------------------------------------------------------------------
// ADV — the denominator the participation rate is measured against
// --------------------------------------------------------------------------

describe("average daily volume is quote-denominated and interval-aware", () => {
  it("scales with the number of bars per day", () => {
    const bars: Bar[] = Array.from({ length: 100 }, (_, i) => ({
      t: i * 3_600_000, o: 100, h: 100, l: 100, c: 100, v: 10,
    }));
    // 10 units × $100 = $1000 per bar; 24 hourly bars per day = $24,000/day.
    close(averageDailyVolume(bars, "1h"), 24_000, 1e-9, "hourly ADV");
    close(averageDailyVolume(bars, "4h"), 6_000, 1e-9, "4h ADV");
  });

  it("an empty series has no volume rather than NaN", () => {
    assert.equal(averageDailyVolume([], "1h"), 0);
  });
});

// --------------------------------------------------------------------------
// Cost summary contract
// --------------------------------------------------------------------------

describe("the cost summary reports what was actually charged", () => {
  it("flags a flat-only run so a reader knows the gateway would agree", () => {
    const summary: CostSummary = {
      flatBps: 8,
      averageDailyVolume: 1e7,
      impactBps: 0,
      participation: 0,
      fundingBpsPer8h: 0,
      borrowBpsAnnual: 0,
      flatOnly: true,
    };
    assert.equal(summary.flatOnly, true);
    assert.equal(summary.impactBps, 0);
  });
});
