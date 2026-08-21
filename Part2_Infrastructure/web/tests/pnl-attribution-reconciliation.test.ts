/**
 * The four legs add back up to day P&L, and the plug says what it is.
 *
 * This is the cheap half of the decomposition, and it is still worth pinning:
 * the residual is a plug, so the legs sum to day P&L by construction and a
 * failure here means a sign flew the wrong way — which is exactly the bug that
 * would otherwise make execution cost look like a source of P&L.
 *
 * The other half of the argument is the plug's honesty. A residual is what is
 * left over, not a measurement of skill, so it is named `Residual` and it has
 * to disclose which withheld cost legs it is carrying: telling a reader the
 * residual absorbs a fee that was in fact measured and already subtracted
 * invites them to subtract it a second time.
 *
 * The withholding paths that make a leg unmeasurable live in the sibling
 * suites — `pnl-attribution-market-leg`, `-session-scope`, `-degradation`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RECONCILIATION_TOLERANCE } from "../lib/pnl-attribution";
import {
  AUDITED_SESSION,
  build,
  DAY_PNL,
  EXPECTED_MARKET,
  makeBook,
  required,
  sum,
} from "./helpers/pnl-attribution-fixtures";

describe("the happy path reconciles, and the costs point the right way", () => {
  it("splits day P&L into four legs that add back up to it", () => {
    const waterfall = build();
    assert.equal(waterfall.dayPnl, DAY_PNL);
    assert.equal(waterfall.legs.length, 4);
    assert.ok(
      Math.abs(sum(waterfall) - DAY_PNL) <= RECONCILIATION_TOLERANCE,
      `legs sum to ${sum(waterfall)}, not ${DAY_PNL}`,
    );
    assert.equal(waterfall.complete, true);
  });

  it("measures the market leg from signed notional × beta × the reference return", () => {
    const market = required(build(), "market");
    assert.equal(market.basis, "measured");
    assert.ok(market.value !== null);
    assert.ok(Math.abs(market.value - EXPECTED_MARKET) < 1e-6, `${market.value} !== ${EXPECTED_MARKET}`);
  });

  it("signs fees and slippage as costs, so a waterfall cannot draw them as gains", () => {
    const waterfall = build();
    assert.equal(required(waterfall, "fees").value, -5_760);
    assert.equal(required(waterfall, "slippage").value, -3_240);
    assert.equal(required(waterfall, "fees").basis, "audited");
    assert.equal(required(waterfall, "slippage").basis, "audited");
  });

  it("plugs the residual, and calls it a residual rather than alpha", () => {
    const residual = required(build(), "residual");
    assert.equal(residual.basis, "derived");
    assert.equal(residual.value, DAY_PNL - EXPECTED_MARKET + 5_760 + 3_240);
    // The leg may only mention alpha in order to disclaim it. Anything the UI
    // could read as a label — the key, the label itself — must not.
    assert.equal(residual.label, "Residual");
    assert.match(residual.note, /not alpha/i);
    for (const candidate of build().legs) {
      assert.ok(!/alpha/i.test(candidate.label), `${candidate.key} is labelled with "alpha"`);
    }
  });

  it("reports carried mark-to-market as the gap day P&L leaves over the session's own P&L", () => {
    // Realised + unrealised here is exactly day P&L, so the carry is zero — the
    // single-session case. It is the *field* being derived rather than assumed
    // that matters; a multi-day book legitimately carries a non-zero number.
    const waterfall = build({ book: makeBook({ session: AUDITED_SESSION, realized: 51_400, unrealized: 91_100 }) });
    assert.equal(waterfall.carriedMarkToMarket, 0);

    const carried = build({
      book: makeBook({ session: AUDITED_SESSION, realized: 20_000, unrealized: 40_000 }),
    });
    assert.equal(carried.carriedMarkToMarket, DAY_PNL - 60_000);
  });
});

describe("the residual names the cost legs it is actually carrying", () => {
  it("blames slippage alone when fees were measured and subtracted", () => {
    const waterfall = build({
      book: makeBook({ session: { ...AUDITED_SESSION, slippage_cost: undefined } }),
    });
    // The fee leg is a number and is already out of the plug. Telling a reader
    // the residual absorbs it invites them to subtract it a second time.
    assert.equal(required(waterfall, "fees").value, -5_760);
    const residual = required(waterfall, "residual");
    assert.equal(residual.value, DAY_PNL - EXPECTED_MARKET + 5_760);
    assert.match(residual.note, /absorbing the withheld slippage leg, which is inside day P&L/i);
    assert.doesNotMatch(residual.note, /fee/i);
  });

  it("blames fees alone when slippage was measured and subtracted", () => {
    const waterfall = build({
      book: makeBook({ session: { ...AUDITED_SESSION, fees: undefined } }),
    });
    assert.equal(required(waterfall, "slippage").value, -3_240);
    const residual = required(waterfall, "residual");
    assert.equal(residual.value, DAY_PNL - EXPECTED_MARKET + 3_240);
    assert.match(residual.note, /absorbing the withheld fee leg, which is inside day P&L/i);
    assert.doesNotMatch(residual.note, /slippage/i);
  });

  it("names both, in the plural, only when both are withheld", () => {
    const residual = required(build({ book: makeBook() }), "residual");
    assert.match(residual.note, /withheld fee and slippage legs, which are inside day P&L/i);
  });

  it("says nothing about withheld costs when both were measured", () => {
    assert.doesNotMatch(required(build(), "residual").note, /withheld/i);
  });

  it("applies the same rule to the unattributed leg", () => {
    const one = build({
      book: makeBook({ session: { ...AUDITED_SESSION, slippage_cost: undefined } }),
      referenceReturn: null,
    });
    assert.match(required(one, "unattributed").note, /absorbs the withheld slippage leg\./i);
    assert.doesNotMatch(required(one, "unattributed").note, /fee/i);

    const both = build({ book: makeBook(), referenceReturn: null });
    assert.match(required(both, "unattributed").note, /absorbs the withheld fee and slippage legs\./i);

    assert.doesNotMatch(
      required(build({ referenceReturn: null }), "unattributed").note,
      /withheld/i,
    );
  });
});
