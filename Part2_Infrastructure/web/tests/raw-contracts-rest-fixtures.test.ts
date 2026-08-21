/**
 * The predicates measured against bodies the vendors actually sent.
 *
 * This is the difference between a predicate and a guess, and it is the whole
 * evidence base for the calibration rule. Its sibling `-predicates` uses
 * bodies those tests made up from documented shapes; the bodies here were
 * captured by `scripts/capture-provider-fixtures.mjs` and committed, which is
 * the only evidence that can support the claim a check does not fire on
 * healthy data.
 *
 * Both directions are checked, because a predicate that never fires is as
 * useless as one that always does: the captured body must raise nothing, and
 * the captured body CORRUPTED must raise the named check. Mutating a real
 * capture is the point — an invented corruption only proves the predicate
 * disagrees with an invention.
 *
 * The last test is where this file meets the rule. OpenBB is this project's
 * own service, needs no credential, and therefore has a healthy capture; FMP,
 * Tiingo and Massive have only a refusal, so they stay at `warn` no matter how
 * confident their predicates look.
 *
 * Siblings: `-calibration` (severity is earned, not assumed), `-predicates`
 * (each predicate fires on the break it names), `-healthy-bodies` (the
 * one-sided table of written-down healthy shapes).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { rawViolations } from "../lib/providers/raw-contract-check";
import { rawSeverity } from "../lib/providers/raw-contracts-rest";
import { fixture } from "./helpers/raw-fixtures";

describe("the predicates against real vendor bodies", () => {
  /**
   * This is the difference between a predicate and a guess.
   *
   * `raw-contracts-rest-predicates.test.ts` uses bodies those tests made up.
   * These use bodies the vendor actually sent, captured by
   * scripts/capture-provider-fixtures.mjs and committed — which is the only
   * evidence that can support the claim a check does not fire on healthy data.
   */

  it("Alpha Vantage: a real daily series raises nothing", () => {
    assert.deepEqual(rawViolations("alphavantage", "bars", fixture("alphavantage/bars")), []);
  });

  it("Alpha Vantage: a real global quote raises nothing", () => {
    assert.deepEqual(rawViolations("alphavantage", "quote", fixture("alphavantage/quote")), []);
  });

  it("Alpha Vantage: the numbered-field check reaches a quote's fields", () => {
    // The bug the fixture found. `Global Quote` carries "01. symbol" directly,
    // where `Time Series (Daily)` nests a row under a date — so looking one
    // level down unconditionally landed on the symbol STRING and skipped.
    // Renaming the fields on a real quote body must now be caught.
    const quote = JSON.parse(JSON.stringify(fixture("alphavantage/quote"))) as Record<string, Record<string, string>>;
    quote["Global Quote"] = { symbol: "IBM", price: "237.16" };
    assert.ok(
      rawViolations("alphavantage", "quote", quote)
        .some((v) => v.check === "raw.alphavantage.numbered-fields"),
      "a quote with un-numbered fields slipped through",
    );
  });

  it("Firecrawl: a real anonymous scrape raises nothing", () => {
    assert.deepEqual(rawViolations("firecrawl", "news", fixture("firecrawl/news")), []);
  });

  it("FMP: the real 401 envelope is caught as an error envelope", () => {
    // The captured body is `{"Error Message": "Invalid API KEY…"}` — an OBJECT
    // where the adapter indexes rows[0]. Without this check it normalises to
    // undefined fields rather than raising.
    const violations = rawViolations("fmp", "quote", fixture("fmp/unauthenticated"));
    assert.ok(violations.some((v) => v.check === "raw.fmp.error-envelope"), JSON.stringify(violations));
  });

  it("Tiingo: the real 403 envelope is caught as an error envelope", () => {
    const violations = rawViolations("tiingo", "quote", fixture("tiingo/unauthenticated"));
    assert.ok(violations.some((v) => v.check === "raw.tiingo.error-envelope"), JSON.stringify(violations));
  });

  it("Massive: the real 401 envelope is caught as a refusal", () => {
    const violations = rawViolations("massive", "quote", fixture("massive/unauthenticated"));
    assert.ok(violations.some((v) => v.check === "raw.massive.declined"), JSON.stringify(violations));
  });

  it("OpenBB: the real captured body raises nothing", () => {
    // The service is this project's own, needs no credential, and was running
    // locally when this was captured — which is why it is the one of the four
    // uncaptured providers that could be calibrated at all.
    assert.deepEqual(rawViolations("openbb", "quote", fixture("openbb/quote")), []);
  });

  it("OpenBB: corrupting the captured body fires the named check", () => {
    // The other half of calibration. A predicate that never fires is as
    // useless as one that always does, and these mutations are applied to the
    // body the service actually sent rather than to an invented one.
    const body = () => JSON.parse(JSON.stringify(fixture("openbb/quote"))) as Record<string, unknown>;
    const fires = (mutate: (b: Record<string, unknown>) => void, check: string) => {
      const corrupted = body();
      mutate(corrupted);
      const violations = rawViolations("openbb", "quote", corrupted);
      assert.ok(violations.some((v) => v.check === check), `${check} did not fire: ${JSON.stringify(violations)}`);
    };
    fires((b) => { delete b.ok; }, "raw.openbb.ok-missing");
    fires((b) => { b.ok = "true"; }, "raw.openbb.ok-missing");
    fires((b) => { delete b.data; }, "raw.openbb.data-missing");
    fires((b) => { b.ok = false; b.error = "temporarily unavailable"; }, "raw.openbb.declined");
  });

  it("OpenBB may now fail a response over; the three refusal-only providers may not", () => {
    // Rewritten rather than loosened. This listed four providers under the
    // word "three" because OpenBB had no healthy capture. It has one now, so
    // it moves to the other side of the same rule: severity is earned by a
    // committed healthy body, and FMP, Tiingo and Massive still have only a
    // refusal.
    assert.equal(rawSeverity("openbb"), "fatal", "a healthy OpenBB body is committed but the checks still cannot act");
    for (const provider of ["fmp", "tiingo", "massive"]) {
      assert.equal(rawSeverity(provider), "warn", `${provider} was promoted without a healthy capture`);
    }
  });
});
