/**
 * No figure this module emits is IEEE −0.
 *
 * This is not cosmetic, and it is not a formatting concern that belongs
 * downstream. The shipped panel classes a leg with `value >= 0 ? "pos" : "neg"`
 * and formats it with `usd`, so `-0` prints "$-0" in the *gain* colour, while
 * the chart label on the same leg prints "+$0" because `-0 < 0` is false. One
 * panel, one number, two signs.
 *
 * The value is reachable without any arithmetic mistake: `round(-0.001, 2)` in
 * the gateway is a literal `-0.0`, `JSON.parse` preserves it, and day P&L then
 * arrives negative-zero from the wire. Every scalar the panel renders is
 * covered, not just the legs — `referenceReturn` and the equity figures reach a
 * reader too, and asserting per field is deliberate: removing the guard from
 * one call site is the regression that survived an earlier pass, and a single
 * blanket check cannot see it.
 *
 * The counterweight is the last case here. Normalisation must not become its
 * own fabrication: a leg measured at exactly zero is a number, it keeps saying
 * so, and it stays distinguishable from a leg that was withheld.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildPnlWaterfall,
  type PnlWaterfall,
} from "../lib/pnl-attribution";
import type { SessionAttribution } from "../lib/portfolio";
import type { RiskPosition } from "../lib/portfolio-risk";
import {
  AUDITED_SESSION,
  BETAS,
  build,
  makeBook,
  POSITIONS,
  REFERENCE_RETURN,
  required,
  SESSION_DATE,
} from "./helpers/pnl-attribution-fixtures";

describe("no figure this module emits is IEEE −0", () => {
  /** What `session_attribution` sends for a session with no fills at all. */
  const NO_FILLS: SessionAttribution = {
    session_date: SESSION_DATE,
    fills: 0, notional: 0, fees: 0, slippage_cost: 0, fills_without_slippage: 0,
    realized_pnl: 0, unrealized_pnl: 0, basis: "audited",
  };

  /**
   * −0 is not cosmetic here. The shipped panel classes a leg with
   * `value >= 0 ? "pos" : "neg"` and formats it with `usd`, so −0 prints "$-0"
   * in the *gain* colour, while the chart label on the same leg prints "+$0"
   * because `-0 < 0` is false. One panel, one number, two signs.
   */
  const books: Array<[string, PnlWaterfall]> = [
    ["a session with no fills", build({ book: makeBook({ session: NO_FILLS }) })],
    [
      "a flat book on a flat day",
      build({ book: makeBook({ dayPnl: 0, session: NO_FILLS }), positions: [], betaBySymbol: new Map() }),
    ],
    [
      // `round(-0.001, 2)` in the gateway is a literal -0.0, and `JSON.parse`
      // preserves it — so day P&L itself arrives negative-zero.
      "a day P&L that rounded to −0",
      build({ book: makeBook({ dayPnl: -0, session: NO_FILLS }), positions: [], betaBySymbol: new Map() }),
    ],
    [
      "a generated block supplying a −0 market leg",
      build({
        book: makeBook({
          sandbox: true,
          session: { ...NO_FILLS, basis: "generated", market_pnl: -0, reference_symbol: "BTCUSDT", reference_return: 0 },
        }),
      }),
    ],
  ];

  for (const [name, waterfall] of books) {
    it(`keeps every leg of ${name} at +0`, () => {
      for (const candidate of waterfall.legs) {
        assert.equal(
          Object.is(candidate.value, -0), false,
          `${candidate.key} carries −0, which renders as "$-0" in the gain colour`,
        );
      }
    });

    it(`keeps every scalar of ${name} at +0`, () => {
      for (const [field, value] of Object.entries({
        dayPnl: waterfall.dayPnl,
        startEquity: waterfall.startEquity,
        endEquity: waterfall.endEquity,
        carriedMarkToMarket: waterfall.carriedMarkToMarket,
      })) {
        assert.equal(Object.is(value, -0), false, `${field} carries −0`);
      }
    });
  }

  it("still reports the cost legs as measured zeros, not as withheld", () => {
    // The normalisation must not become its own fabrication: a measured zero is
    // a number and has to keep saying so.
    const waterfall = build({ book: makeBook({ session: NO_FILLS }) });
    for (const key of ["fees", "slippage"] as const) {
      const cost = required(waterfall, key);
      assert.equal(cost.value, 0);
      assert.equal(cost.basis, "audited");
    }
  });
});

describe("no number the panel renders is a negative zero", () => {
  /**
   * The panel colours a leg by `value >= 0` and prints it with a sign, so a
   * `-0` renders as "$-0" in the gain colour — a cost shown as a signed-negative
   * gain, next to a "+$0" for the same figure elsewhere in the same card.
   *
   * Asserted per field rather than by mutating the helper wholesale: removing
   * the guard from one call site is exactly the regression that survived last
   * time, and a single blanket check cannot see it.
   */
  function everyScalar(waterfall: PnlWaterfall): Array<[string, number | null]> {
    return [
      ["dayPnl", waterfall.dayPnl],
      ["startEquity", waterfall.startEquity],
      ["endEquity", waterfall.endEquity],
      ["carriedMarkToMarket", waterfall.carriedMarkToMarket],
      ["referenceReturn", waterfall.referenceReturn],
      ...waterfall.legs.map((leg): [string, number | null] => [`leg:${leg.key}`, leg.value]),
    ];
  }

  const zeroCost: SessionAttribution = {
    ...AUDITED_SESSION, fills: 0, fees: 0, slippage_cost: 0, fills_without_slippage: 0,
  };

  it("holds on a session that genuinely cost nothing", () => {
    const waterfall = buildPnlWaterfall({
      book: makeBook({ session: zeroCost }),
      positions: POSITIONS,
      betaBySymbol: BETAS,
      referenceSymbol: "BTCUSDT",
      referenceReturn: REFERENCE_RETURN,
    });
    assert.ok(waterfall);
    for (const [name, value] of everyScalar(waterfall)) {
      assert.ok(!Object.is(value, -0), `${name} is negative zero`);
    }
  });

  it("holds on a flat book with a zero day", () => {
    const waterfall = buildPnlWaterfall({
      book: makeBook({ dayPnl: 0, realized: 0, unrealized: 0, session: zeroCost }),
      positions: [],
      betaBySymbol: new Map(),
      referenceSymbol: "BTCUSDT",
      referenceReturn: 0,
    });
    assert.ok(waterfall);
    for (const [name, value] of everyScalar(waterfall)) {
      assert.ok(!Object.is(value, -0), `${name} is negative zero`);
    }
  });

  it("holds when the market leg itself lands on zero", () => {
    // Equal and opposite exposures at the same beta: the leg is measured, and
    // measured at exactly zero, which must stay distinguishable from withheld.
    const flatBook: RiskPosition[] = [
      { symbol: "AAA", signedNotional: 1_000_000 },
      { symbol: "BBB", signedNotional: -1_000_000 },
    ];
    const waterfall = buildPnlWaterfall({
      book: makeBook({ session: zeroCost }),
      positions: flatBook,
      betaBySymbol: new Map([["AAA", 1], ["BBB", 1]]),
      referenceSymbol: "AAA",
      referenceReturn: REFERENCE_RETURN,
    });
    assert.ok(waterfall);
    const market = waterfall.legs.find((leg) => leg.key === "market");
    assert.ok(market);
    assert.equal(market.value, 0);
    assert.ok(!Object.is(market.value, -0), "a measured zero must not be a negative zero");
    assert.notEqual(market.basis, "withheld", "measured at zero is not the same as unmeasurable");
  });
});
