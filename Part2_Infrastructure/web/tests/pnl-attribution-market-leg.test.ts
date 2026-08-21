/**
 * The market leg is measured, understated, or withheld — never invented.
 *
 * `market = Σ(signed notional × beta) × reference return` is one line of
 * arithmetic over three inputs that can each go missing, and every way of
 * papering over a missing one produces a number that reads as a measurement:
 *
 *  - An unmeasurable beta must never become 1.
 *  - A book where *no* beta is measurable must not report a market leg of zero.
 *    "The market contributed nothing" and "we could not tell what the market
 *    contributed" are opposite claims about the same book.
 *  - A withheld market leg must withhold the **residual** too. The subtraction
 *    still works: `dayPnl - 0` is a perfectly good number, it sums correctly,
 *    and it is day P&L relabelled as skill. The tests below pin that the leg is
 *    renamed to `Unattributed` rather than merely recomputed.
 *
 * Two fields travel with the leg and have to travel with its absence as well.
 * `unmeasuredSymbols` means "excluded from a market leg that exists", so it is
 * empty on every path that withholds the leg entirely. And the reference pair —
 * `referenceSymbol` with `referenceReturn` — is what `PnlWaterfall.tsx` gates
 * its closing paragraph on: a symbol left standing beside a withheld leg makes
 * the panel describe a beta attribution it never performed. That defect
 * survived an earlier pass because the tests around it asserted the leg values
 * and not the scalars beside them.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildPnlWaterfall,
  type PnlWaterfall,
  RECONCILIATION_TOLERANCE,
} from "../lib/pnl-attribution";
import {
  AUDITED_SESSION,
  BETAS,
  build,
  DAY_PNL,
  EXPECTED_MARKET,
  leg,
  makeBook,
  POSITIONS,
  REFERENCE_RETURN,
  required,
  sum,
} from "./helpers/pnl-attribution-fixtures";

describe("no reference return withholds the residual as well as the market leg", () => {
  const waterfall = build({ referenceReturn: null });

  it("withholds the market leg rather than reporting zero", () => {
    const market = required(waterfall, "market");
    assert.equal(market.value, null);
    assert.equal(market.basis, "withheld");
    assert.match(market.note, /could not be measured/i);
  });

  it("replaces the residual with a single leg named Unattributed", () => {
    assert.equal(leg(waterfall, "residual"), undefined);
    const unattributed = required(waterfall, "unattributed");
    assert.equal(unattributed.label, "Unattributed");
    assert.equal(unattributed.basis, "derived");
    // Day P&L less the costs that *were* measured, and nothing else.
    assert.equal(unattributed.value, DAY_PNL + 5_760 + 3_240);
    assert.equal(
      waterfall.legs.filter((candidate) => candidate.key === "unattributed").length,
      1,
    );
  });

  it("is not complete, even though the arithmetic still adds up", () => {
    assert.equal(waterfall.complete, false);
    assert.ok(Math.abs(sum(waterfall) - DAY_PNL) <= RECONCILIATION_TOLERANCE);
  });

  it("drops the reference symbol along with the move it would have applied", () => {
    // This used to assert the symbol survived, on the reasoning that reporting
    // what *would* have been used is informative. It is not, to the only reader
    // there is: `PnlWaterfall.tsx` gates its closing paragraph on the pair, so a
    // symbol with no move beside it renders "the market leg uses BTCUSDT at …,
    // applied through each position's measured beta" for a leg that was
    // withheld. The symbol is still named in the leg's own note, which is where
    // it explains an absence instead of implying a measurement.
    assert.equal(waterfall.referenceSymbol, null);
    assert.equal(waterfall.referenceReturn, null);
    const market = waterfall.legs.find((leg) => leg.key === "market");
    assert.ok(market?.note.includes("BTCUSDT"), "the note still has to say which reference failed");
  });

  it("names nothing in unmeasuredSymbols, because no leg excluded anything", () => {
    // The field means "excluded from a market leg that exists". With no market
    // leg, listing symbols would imply the leg is merely understated.
    assert.deepEqual(waterfall.unmeasuredSymbols, []);
  });
});

describe("unmeasurable betas understate the market leg instead of inventing one", () => {
  const partial = new Map(BETAS);
  partial.set("SOLUSDT", null);
  const waterfall = build({ betaBySymbol: partial });

  it("names the excluded symbols", () => {
    assert.deepEqual(waterfall.unmeasuredSymbols, ["SOLUSDT"]);
  });

  it("computes the market leg over the measurable positions only", () => {
    const market = required(waterfall, "market");
    // 0.01 × (3.6m + 2.88m − 1.035m); SOL's 2.175m of beta-adjusted exposure is gone.
    assert.equal(market.value, 54_450);
    assert.ok(market.value! < EXPECTED_MARKET, "an excluded position must understate, not inflate");
    assert.match(market.note, /understated/);
    assert.match(market.note, /SOLUSDT/);
  });

  it("still reconciles, because the residual absorbs the excluded exposure", () => {
    assert.ok(Math.abs(sum(waterfall) - DAY_PNL) <= RECONCILIATION_TOLERANCE);
    const residual = required(waterfall, "residual");
    const full = required(build(), "residual");
    assert.ok(residual.value! > full.value!, "the residual must grow by what the market leg lost");
  });

  it("treats a symbol missing from the beta map exactly like a null beta", () => {
    const missing = new Map(BETAS);
    missing.delete("BNBUSDT");
    assert.deepEqual(build({ betaBySymbol: missing }).unmeasuredSymbols, ["BNBUSDT"]);
  });

  it("withholds the market leg entirely when not one position is measurable", () => {
    const none = new Map<string, number | null>(POSITIONS.map((p) => [p.symbol, null]));
    const blind = build({ betaBySymbol: none });
    const market = required(blind, "market");
    // Zero here would read as "the market contributed nothing", which is a
    // different claim from "nothing could be measured".
    assert.equal(market.value, null);
    assert.equal(market.basis, "withheld");
    assert.equal(leg(blind, "residual"), undefined);
    assert.equal(required(blind, "unattributed").value, DAY_PNL + 5_760 + 3_240);
  });

  it("reports a genuine zero for a book that holds nothing", () => {
    const flat = build({ positions: [], betaBySymbol: new Map() });
    const market = required(flat, "market");
    assert.equal(market.value, 0);
    assert.equal(market.basis, "measured");
    assert.deepEqual(flat.unmeasuredSymbols, []);
    assert.equal(flat.complete, true);
  });
});

describe("unmeasuredSymbols means excluded from a market leg that exists", () => {
  const none = new Map<string, number | null>(POSITIONS.map((p) => [p.symbol, null]));

  it("is empty on every path that withholds the market leg", () => {
    // The field's contract, and the sentence the panel prints from it: "the
    // market leg excludes them and is understated by whatever they moved".
    // Neither is true of a leg that does not exist.
    const withheldMarket = [
      build({ betaBySymbol: none }),
      build({ referenceReturn: null }),
      build({ book: makeBook({ sandbox: true }), referenceReturn: 0.05 }),
    ];
    for (const waterfall of withheldMarket) {
      assert.equal(required(waterfall, "market").value, null);
      assert.deepEqual(waterfall.unmeasuredSymbols, []);
    }
  });

  it("keeps the names in the withheld leg's own note instead", () => {
    // Dropping them from the field must not drop them from the output: the
    // reason the leg is missing is still the symbols that could not be measured.
    const note = required(build({ betaBySymbol: none }), "market").note;
    for (const position of POSITIONS) assert.match(note, new RegExp(position.symbol));
  });

  it("is non-empty exactly when the market leg is a number that excluded something", () => {
    const partial = new Map(BETAS);
    partial.set("SOLUSDT", null);
    for (const waterfall of [build(), build({ betaBySymbol: partial }), build({ betaBySymbol: none })]) {
      const market = required(waterfall, "market");
      assert.equal(
        waterfall.unmeasuredSymbols.length > 0,
        market.value !== null && /understated/.test(market.note),
        `unmeasuredSymbols disagrees with the ${market.basis} market leg it describes`,
      );
    }
  });
});

describe("a withheld market leg takes its reference pair with it", () => {
  /** Every path that withholds the market leg, so none can drift from the others. */
  const withheldPaths: Array<{ name: string; build: () => PnlWaterfall | null }> = [
    {
      name: "no reference return",
      build: () => buildPnlWaterfall({
        book: makeBook({ session: AUDITED_SESSION }),
        positions: POSITIONS,
        betaBySymbol: BETAS,
        referenceSymbol: "BTCUSDT",
        referenceReturn: null,
      }),
    },
    {
      name: "no measurable beta on any holding",
      build: () => buildPnlWaterfall({
        book: makeBook({ session: AUDITED_SESSION }),
        positions: POSITIONS,
        betaBySymbol: new Map(POSITIONS.map((p) => [p.symbol, null])),
        referenceSymbol: "BTCUSDT",
        referenceReturn: REFERENCE_RETURN,
      }),
    },
    {
      name: "sandbox block supplying no market leg",
      build: () => buildPnlWaterfall({
        book: makeBook({
          sandbox: true,
          session: { ...AUDITED_SESSION, basis: "generated", market_pnl: undefined },
        }),
        positions: POSITIONS,
        betaBySymbol: BETAS,
        referenceSymbol: "BTCUSDT",
        referenceReturn: REFERENCE_RETURN,
      }),
    },
  ];

  for (const path of withheldPaths) {
    it(`nulls referenceSymbol and referenceReturn when the leg is withheld — ${path.name}`, () => {
      const waterfall = path.build();
      assert.ok(waterfall);
      const market = waterfall.legs.find((leg) => leg.key === "market");
      // Either the leg is withheld or it is absent entirely; both mean there is
      // no beta attribution for the panel's closing paragraph to describe.
      assert.ok(market === undefined || market.value === null, path.name);
      assert.equal(waterfall.referenceSymbol, null, `${path.name}: referenceSymbol survived`);
      assert.equal(waterfall.referenceReturn, null, `${path.name}: referenceReturn survived`);
      assert.deepEqual(waterfall.unmeasuredSymbols, [], `${path.name}: unmeasuredSymbols survived`);
    });
  }

  it("keeps the pair when the leg really was measured", () => {
    const waterfall = buildPnlWaterfall({
      book: makeBook({ session: AUDITED_SESSION }),
      positions: POSITIONS,
      betaBySymbol: BETAS,
      referenceSymbol: "BTCUSDT",
      referenceReturn: REFERENCE_RETURN,
    });
    assert.ok(waterfall);
    assert.equal(waterfall.referenceSymbol, "BTCUSDT");
    assert.equal(waterfall.referenceReturn, REFERENCE_RETURN);
  });
});
