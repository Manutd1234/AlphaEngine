/**
 * The quote contract — a price that parses and is still wrong.
 *
 * The adapters already handle the loud case: a quote with no price throws and
 * the registry fails over. What is pinned here is everything that *parses* and
 * is still wrong — a high below its low, a "live" price stamped four days ago,
 * a null change field that is really a renamed vendor column. Each of those
 * renders perfectly and produces a number nobody questions.
 *
 * Two behaviours matter as much as the checks themselves:
 *
 *  - A check that could not run must not be reported as passed. Otherwise the
 *    least transparent vendor scores best, which inverts the whole point.
 *  - Only internally impossible data is fatal. Stale is a fact about the world
 *    and gets labelled; inverted is a fact about the record and gets rejected.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkQuote, FRESHNESS_LIMIT_MS, summariseContract } from "../lib/providers/contracts";

import { NOW, quote } from "./helpers/contract-fixtures";

describe("a quote is checked for things that parse and are still wrong", () => {
  it("passes a healthy quote with nothing to report", () => {
    const result = checkQuote("fmp", quote(), NOW);
    assert.equal(result.passed, true);
    assert.deepEqual(result.violations, []);
    assert.equal(summariseContract(result), "passed");
  });

  it("rejects a quote with no usable price", () => {
    for (const price of [0, -1, Number.NaN]) {
      const result = checkQuote("fmp", quote({ price }), NOW);
      assert.equal(result.passed, false, `price ${price} should be fatal`);
      assert.ok(result.violations.some((v) => v.check === "quote.price_positive"));
    }
  });

  it("rejects a high below its low as a broken record, not a market", () => {
    const result = checkQuote("fmp", quote({ high: 66_000, low: 68_000 }), NOW);
    assert.equal(result.passed, false);
    assert.equal(result.violations[0].check, "quote.high_ge_low");
  });

  it("labels a stale quote rather than discarding it", () => {
    const stale = quote({ asOf: new Date(NOW - FRESHNESS_LIMIT_MS - 3_600_000).toISOString() });
    const result = checkQuote("fmp", stale, NOW);
    // Still usable: a trader who can see the age can decide. Dropping it would
    // leave the panel empty and the reason invisible.
    assert.equal(result.passed, true);
    const violation = result.violations.find((v) => v.check === "quote.freshness");
    assert.ok(violation);
    assert.equal(violation.severity, "warn");
  });

  it("flags a future timestamp as a timezone bug", () => {
    const result = checkQuote("fmp", quote({ asOf: new Date(NOW + 3_600_000).toISOString() }), NOW);
    assert.ok(result.violations.some((v) => v.check === "quote.not_from_the_future"));
  });

  it("does not credit a provider for a check it never enabled", () => {
    // No timestamp at all cannot fail a freshness check — and must not pass one.
    const result = checkQuote("binance", quote({ asOf: "" }), NOW);
    assert.ok(result.notEvaluated.includes("quote.freshness"));
    assert.ok(!result.violations.some((v) => v.check === "quote.freshness"));
    assert.match(summariseContract(result), /not evaluated/);
  });

  it("reads a null secondary field as drift, not failure", () => {
    // The price is fine; what is suspect is our mapping of the vendor's schema
    // — the exact misdiagnosis "the change field is null" invites.
    const result = checkQuote("tiingo", quote({ change: null }), NOW);
    assert.equal(result.passed, true);
    const drift = result.violations.find((v) => v.check === "quote.change_derivable");
    assert.ok(drift);
    assert.equal(drift.severity, "drift");
  });

  it("does not call it drift when there is nothing to derive from", () => {
    const result = checkQuote("tiingo", quote({ change: null, prevClose: null }), NOW);
    assert.ok(!result.violations.some((v) => v.check === "quote.change_derivable"));
  });
});
