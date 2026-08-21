/**
 * What the module does when the payload arrives thinner or stranger than typed.
 *
 * Two failure sources, one policy. A gateway rolled back or partially deployed
 * sends less than the contract promises — no `fees`, no `slippage_cost`, no
 * generated `market_pnl` — and those branches only ever fire in production, so
 * they are the ones with no natural coverage. Separately, the numbers
 * themselves can be degenerate: a flat day makes day P&L zero, a broken equity
 * block makes it NaN, and a position can carry a notional that is not a number.
 *
 * The policy in both cases is that a leg is withheld with a note, never
 * substituted with 0, and that a waterfall which cannot be built honestly is
 * returned as `null` rather than half-real. Zero is a measurement. A missing
 * field is not, and neither is NaN.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildPnlWaterfall,
  type PnlLeg,
  RECONCILIATION_TOLERANCE,
} from "../lib/pnl-attribution";
import {
  AUDITED_SESSION,
  BETAS,
  build,
  DAY_PNL,
  EXPECTED_MARKET,
  makeBook,
  POSITIONS,
  REFERENCE_RETURN,
  required,
  sum,
} from "./helpers/pnl-attribution-fixtures";

describe("branches that only fire on a gateway sending less than it used to", () => {
  it("withholds the slippage leg when the block carries no slippage figure at all", () => {
    const waterfall = build({
      book: makeBook({ session: { ...AUDITED_SESSION, slippage_cost: undefined } }),
    });
    const slippage = required(waterfall, "slippage");
    assert.equal(slippage.value, null);
    assert.equal(slippage.basis, "withheld");
    assert.match(slippage.note, /carries no slippage figure/i);
    assert.equal(waterfall.complete, false);
  });

  it("withholds the fee leg when the block carries no fee total", () => {
    const waterfall = build({ book: makeBook({ session: { ...AUDITED_SESSION, fees: undefined } }) });
    const fees = required(waterfall, "fees");
    assert.equal(fees.value, null);
    assert.equal(fees.basis, "withheld");
    assert.match(fees.note, /no fee total/i);
  });

  it("withholds the sandbox's market leg when its own block supplies none", () => {
    // A generated book with no generated market leg: measuring one against real
    // prices would attribute a synthetic P&L to a real market move.
    const waterfall = build({
      book: makeBook({
        sandbox: true,
        session: { ...AUDITED_SESSION, basis: "generated", market_pnl: undefined },
      }),
      referenceReturn: 0.05,
    });
    const market = required(waterfall, "market");
    assert.equal(market.value, null);
    assert.equal(market.basis, "withheld");
    assert.match(market.note, /supplies no market leg/i);
    assert.deepEqual(waterfall.unmeasuredSymbols, []);
    // The cost legs are still readable — only the market leg is unavailable.
    assert.equal(required(waterfall, "fees").value, -5_760);
    assert.equal(required(waterfall, "unattributed").value, DAY_PNL + 5_760 + 3_240);
  });

  it("declines to state a reference move the generated block never stated", () => {
    const waterfall = build({
      book: makeBook({
        sandbox: true,
        session: {
          ...AUDITED_SESSION, basis: "generated", market_pnl: 61_000,
          reference_symbol: undefined, reference_return: undefined,
        },
      }),
    });
    const market = required(waterfall, "market");
    assert.equal(market.value, 61_000);
    assert.match(market.note, /an unstated size/i);
    assert.equal(waterfall.referenceSymbol, null);
    assert.equal(waterfall.referenceReturn, null);
  });

  it("reports carried mark-to-market as null when the equity block cannot support it", () => {
    // Absent and zero are different claims here too: zero says the book carries
    // nothing in from earlier sessions, which is a statement about its history.
    const broken = makeBook({ session: AUDITED_SESSION });
    (broken.equity as { realized_pnl: unknown }).realized_pnl = null;
    assert.equal(build({ book: broken }).carriedMarkToMarket, null);

    const noUnrealized = makeBook({ session: AUDITED_SESSION });
    (noUnrealized.equity as { unrealized_pnl: number }).unrealized_pnl = Number.NaN;
    assert.equal(build({ book: noUnrealized }).carriedMarkToMarket, null);
  });
});

describe("degenerate numbers stay numbers", () => {
  it("survives a flat session without dividing by day P&L", () => {
    const waterfall = build({ book: makeBook({ dayPnl: 0, session: AUDITED_SESSION }) });
    assert.equal(waterfall.dayPnl, 0);
    for (const candidate of waterfall.legs) {
      assert.ok(candidate.value === null || Number.isFinite(candidate.value), `${candidate.key} is not finite`);
    }
    assert.equal(required(waterfall, "residual").value, -EXPECTED_MARKET + 9_000);
    assert.ok(Math.abs(sum(waterfall)) <= RECONCILIATION_TOLERANCE);
    assert.equal(waterfall.complete, true);
  });

  it("never substitutes 0 for a withheld leg, in any withholding path", () => {
    const withheld: PnlLeg[] = [
      ...build({ referenceReturn: null }).legs,
      ...build({ book: makeBook() }).legs,
      ...build({ book: makeBook({ sandbox: true }) }).legs,
      ...build({ betaBySymbol: new Map() }).legs,
    ].filter((candidate) => candidate.basis === "withheld");

    assert.ok(withheld.length >= 6, "expected several withheld legs across these paths");
    for (const candidate of withheld) {
      assert.equal(candidate.value, null, `${candidate.key} was withheld but carries a value`);
      assert.ok(candidate.note.length > 0, `${candidate.key} was withheld without saying why`);
    }
  });

  it("returns null rather than a half-real waterfall on a broken equity block", () => {
    const broken = makeBook({ session: AUDITED_SESSION });
    (broken.equity as { daily_pnl: number }).daily_pnl = Number.NaN;
    assert.equal(
      buildPnlWaterfall({
        book: broken,
        positions: POSITIONS,
        betaBySymbol: BETAS,
        referenceSymbol: "BTCUSDT",
        referenceReturn: REFERENCE_RETURN,
      }),
      null,
    );
  });

  it("ignores a position whose notional is not a number", () => {
    const waterfall = build({
      positions: [...POSITIONS, { symbol: "XRPUSDT", signedNotional: Number.NaN }],
      betaBySymbol: new Map(BETAS).set("XRPUSDT", 1.1),
    });
    assert.equal(required(waterfall, "market").value, EXPECTED_MARKET);
    assert.deepEqual(waterfall.unmeasuredSymbols, []);
  });
});
