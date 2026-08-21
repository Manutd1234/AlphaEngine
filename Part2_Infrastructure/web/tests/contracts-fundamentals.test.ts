/**
 * The fundamentals contract — is this profile about the issuer, and is it a
 * profile at all?
 *
 * Two failures hide inside a 200 here. The first is a profile for the wrong
 * company, which renders as a complete, plausible page of numbers under the
 * ticker you asked for — fatal, and tolerant only of class-share spelling
 * (BRK-B and brk.b are the same issuer). The second is a profile with a name
 * and nothing else: every field null, which passes every parser and answers no
 * question anybody asked.
 *
 * The severity ladder is the same argument as the rest of the suite. An
 * implausible P/E is a fact about the market and gets a warning; a NaN that
 * survived normalisation is a fact about the record and gets rejected; a
 * missing name beside a present market cap is drift in our own mapping, not
 * news about the issuer.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkFundamentals } from "../lib/providers/contracts";
import type { Fundamentals } from "../lib/providers/types";

describe("an issuer profile is checked for being about the issuer, and for being a profile", () => {
  const profile = (over: Partial<Fundamentals> = {}): Fundamentals => ({
    symbol: "AAPL",
    name: "Apple Inc.",
    exchange: "NASDAQ",
    sector: "Technology",
    industry: "Consumer Electronics",
    currency: "USD",
    marketCap: 3.1e12,
    peRatio: 31.2,
    eps: 6.4,
    beta: 1.2,
    dividendYield: 0.5,
    sharesOutstanding: 1.5e10,
    description: null,
    ...over,
  });

  it("passes a full profile with nothing left unevaluated", () => {
    const r = checkFundamentals("fmp", profile(), "aapl");
    assert.equal(r.capability, "fundamentals");
    assert.equal(r.passed, true);
    assert.deepEqual(r.violations, []);
    assert.deepEqual(r.notEvaluated, []);
  });

  it("a sub-1 % yield is not drift — AAPL yields half a percent", () => {
    const r = checkFundamentals("fmp", profile({ dividendYield: 0.5 }), "AAPL");
    assert.deepEqual(r.violations, []);
  });

  it("rejects a profile for a different issuer, tolerant of class-share spelling", () => {
    const wrong = checkFundamentals("fmp", profile({ symbol: "MSFT" }), "AAPL");
    assert.equal(wrong.passed, false);
    assert.ok(wrong.violations.some((v) => v.check === "fundamentals.symbol_matches" && v.severity === "fatal"));
    const spelt = checkFundamentals("fmp", profile({ symbol: "BRK-B" }), "brk.b");
    assert.equal(spelt.passed, true);
  });

  it("rejects an all-null profile — a 200 with nothing in it is not an answer", () => {
    const r = checkFundamentals("alphavantage", profile({
      name: null, marketCap: null, peRatio: null, eps: null, sharesOutstanding: null,
    }), "AAPL");
    assert.equal(r.passed, false);
    assert.ok(r.violations.some((v) => v.check === "fundamentals.non_empty"));
    // What could not be checked is listed, not counted as passed.
    assert.ok(r.notEvaluated.includes("fundamentals.market_cap_non_negative"));
    assert.ok(r.notEvaluated.includes("fundamentals.shares_positive"));
    assert.ok(r.notEvaluated.includes("fundamentals.pe_ratio_sane"));
  });

  it("rejects a NaN that survived normalisation, a negative market cap, and non-positive shares", () => {
    const nan = checkFundamentals("x", profile({ eps: Number.NaN }), "AAPL");
    assert.ok(nan.violations.some((v) => v.check === "fundamentals.numeric_finite" && v.severity === "fatal"));
    const neg = checkFundamentals("x", profile({ marketCap: -1 }), "AAPL");
    assert.ok(neg.violations.some((v) => v.check === "fundamentals.market_cap_non_negative" && v.severity === "fatal"));
    const shares = checkFundamentals("x", profile({ sharesOutstanding: 0 }), "AAPL");
    assert.ok(shares.violations.some((v) => v.check === "fundamentals.shares_positive" && v.severity === "fatal"));
    assert.equal(shares.passed, false);
  });

  it("warns on an implausible P/E and an out-of-range yield, and serves the profile", () => {
    const r = checkFundamentals("x", profile({ peRatio: 5_000, dividendYield: 140 }), "AAPL");
    assert.equal(r.passed, true);
    assert.deepEqual(
      r.violations.map((v) => `${v.check}:${v.severity}`).sort(),
      ["fundamentals.dividend_yield_range:warn", "fundamentals.pe_ratio_sane:warn"],
    );
  });

  it("a missing name beside a present market cap is drift — a renamed field, not a market", () => {
    const r = checkFundamentals("x", profile({ name: null }), "AAPL");
    assert.equal(r.passed, true);
    assert.deepEqual(r.violations.map((v) => [v.check, v.severity]), [["fundamentals.name_derivable", "drift"]]);
  });
});
