/**
 * A generated book is attributed from generated figures, or not at all.
 *
 * The sandbox produces its own session block with `basis: "generated"`, and the
 * whole guard here is that the real-market path must not run against it.
 * Measuring a beta-weighted market leg from live prices and subtracting it from
 * a synthetic P&L attributes part of an invented number to a real market move —
 * and because the reference return arrives from a client-side kline, it would
 * also move the figure between a server render and a client hydrate.
 *
 * So the generated block is read, or nothing is: its `market_pnl` is used
 * verbatim, its cost legs are labelled `generated` rather than `audited`, and a
 * sandbox book carrying no generated block withholds everything rather than
 * falling back to the measured path. The mirror case matters just as much — a
 * sandbox book whose block claims *audited* fills is a contradiction, and
 * audited costs are not evidence about a book that was invented.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RECONCILIATION_TOLERANCE } from "../lib/pnl-attribution";
import type { SessionAttribution } from "../lib/portfolio";
import {
  AUDITED_SESSION,
  build,
  DAY_PNL,
  makeBook,
  required,
  SESSION_DATE,
  sum,
} from "./helpers/pnl-attribution-fixtures";

describe("the sandbox attributes only what it generated", () => {
  const generated: SessionAttribution = {
    session_date: SESSION_DATE,
    fills: 81,
    fees: 5_760,
    slippage_cost: 3_240,
    fills_without_slippage: 0,
    basis: "generated",
    market_pnl: 61_000,
    reference_symbol: "BTCUSDT",
    reference_return: 0.008,
  };

  it("reads the supplied market leg instead of running the beta path", () => {
    const waterfall = build({
      book: makeBook({ sandbox: true, session: generated }),
      // Deliberately supplies a real measured return that would produce a very
      // different leg. It must be ignored: attributing part of a generated P&L
      // to a real market move is a fabricated attribution, and it would also
      // move the number between a server render and a client hydrate.
      referenceReturn: 0.05,
    });
    const market = required(waterfall, "market");
    assert.equal(market.value, 61_000);
    assert.equal(market.basis, "generated");
    assert.equal(waterfall.referenceReturn, 0.008);
    assert.equal(waterfall.referenceSymbol, "BTCUSDT");
    assert.deepEqual(waterfall.unmeasuredSymbols, []);
  });

  it("labels its cost legs generated, never audited", () => {
    const waterfall = build({ book: makeBook({ sandbox: true, session: generated }) });
    assert.equal(required(waterfall, "fees").basis, "generated");
    assert.equal(required(waterfall, "slippage").basis, "generated");
    assert.equal(waterfall.complete, true);
    assert.ok(Math.abs(sum(waterfall) - DAY_PNL) <= RECONCILIATION_TOLERANCE);
  });

  it("withholds everything when a sandbox book carries no generated block", () => {
    const waterfall = build({ book: makeBook({ sandbox: true }), referenceReturn: 0.05 });
    assert.equal(required(waterfall, "market").value, null);
    assert.equal(required(waterfall, "fees").value, null);
    assert.equal(waterfall.referenceSymbol, null);
    assert.equal(required(waterfall, "unattributed").value, DAY_PNL);
  });

  it("refuses a sandbox book whose block claims audited fills", () => {
    const waterfall = build({ book: makeBook({ sandbox: true, session: AUDITED_SESSION }) });
    assert.equal(required(waterfall, "fees").value, null);
    assert.equal(required(waterfall, "market").value, null);
  });
});
