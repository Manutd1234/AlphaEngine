/**
 * The six keyed providers' raw predicates, and the calibration rule.
 *
 * The rule is the important half. These six have no committed fixture — every
 * key in the deployment is Sensitive in Vercel, so no machine that can run the
 * capture can read the credential — and a predicate that has never seen a real
 * body must not be able to fail a healthy response over.
 *
 * So: uncalibrated providers report `warn`, calibrated ones may report
 * `fatal`, and that is asserted rather than left to whoever writes the next
 * predicate.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { checkRawBody, RAW_CHECKED, rawViolations } from "../lib/providers/raw-contract-check";
import { RAW_CALIBRATED, rawSeverity } from "../lib/providers/raw-contracts-rest";

describe("severity is earned, not assumed", () => {
  it("only providers with a committed fixture may raise fatal", () => {
    for (const provider of RAW_CHECKED) {
      const severity = rawSeverity(provider);
      if (RAW_CALIBRATED.has(provider)) continue;
      assert.equal(severity, "warn", `${provider} has no capture and must not be able to fail a response over`);
    }
  });

  it("a provider is calibrated only if a HEALTHY body is committed for it", () => {
    // Derived from the filesystem, not asserted as a literal list. A provider
    // promoted without a capture fails here, and a capture added without the
    // promotion shows up as the reverse — which is the drift a hard-coded pair
    // of names could not catch in either direction.
    //
    // A `unauthenticated.json` does NOT count. It is the vendor's refusal, and
    // calibration is the claim that the predicate has been held to a body from
    // a working call: the requirement is that it does not fire on good data.
    const root = fileURLToPath(new URL("./fixtures/raw", import.meta.url));
    const withHealthyBody = readdirSync(root)
      .filter((provider) => statSync(join(root, provider)).isDirectory())
      .filter((provider) => readdirSync(join(root, provider))
        .some((f) => f.endsWith(".json") && f !== "unauthenticated.json"))
      .sort();
    assert.deepEqual([...RAW_CALIBRATED].sort(), withHealthyBody);
  });
});

describe("an unknown provider is not silently passed", () => {
  it("returns null rather than an empty pass", () => {
    assert.equal(checkRawBody("nonesuch", "bars", []), null);
  });
});

describe("Alpha Vantage", () => {
  it("names a quota advisory rather than reporting an empty series", () => {
    const violations = rawViolations("alphavantage", "bars", {
      Note: "Thank you for using Alpha Vantage! Our standard API call frequency is 5 calls per minute.",
    });
    assert.equal(violations.length, 1);
    assert.equal(violations[0].check, "raw.alphavantage.advisory");
  });

  it("accepts a healthy daily series", () => {
    const violations = rawViolations("alphavantage", "bars", {
      "Meta Data": { "1. Information": "Daily" },
      "Time Series (Daily)": {
        "2026-08-19": { "1. open": "1.0", "2. high": "2.0", "3. low": "0.5", "4. close": "1.5", "5. volume": "10" },
      },
    });
    assert.deepEqual(violations, [], "a healthy body must not fire a raw check");
  });

  it("catches the numbered field names being renamed", () => {
    const violations = rawViolations("alphavantage", "bars", {
      "Time Series (Daily)": { "2026-08-19": { open: "1.0", high: "2.0", low: "0.5", close: "1.5" } },
    });
    assert.ok(violations.some((v) => v.check === "raw.alphavantage.numbered-fields"));
  });
});

describe("Massive", () => {
  it("records a refusal as a refusal, not as an empty result", () => {
    const violations = rawViolations("massive", "quote", { status: "NOT_AUTHORIZED", message: "no entitlement" });
    assert.ok(violations.some((v) => v.check === "raw.massive.declined"));
  });

  it("accepts a healthy envelope", () => {
    assert.deepEqual(rawViolations("massive", "quote", { status: "OK", results: [{ c: 1 }] }), []);
  });
});

describe("OpenBB", () => {
  it("requires the boolean ok the adapter branches on", () => {
    assert.ok(rawViolations("openbb", "bars", { results: [] }).some((v) => v.check === "raw.openbb.ok-missing"));
  });

  it("requires an error string beside ok:false", () => {
    assert.ok(rawViolations("openbb", "bars", { ok: false }).some((v) => v.check === "raw.openbb.error-missing"));
  });

  it("accepts a healthy envelope", () => {
    assert.deepEqual(rawViolations("openbb", "bars", { ok: true, results: [] }), []);
  });
});

describe("Firecrawl", () => {
  it("catches success:true with nothing readable in it", () => {
    const violations = rawViolations("firecrawl", "news", { success: true, data: { metadata: {} } });
    assert.ok(violations.some((v) => v.check === "raw.firecrawl.content-missing"));
  });

  it("accepts a scrape with markdown", () => {
    assert.deepEqual(rawViolations("firecrawl", "news", { success: true, data: { markdown: "# hello" } }), []);
  });
});

describe("FMP and Tiingo both answer with arrays", () => {
  it("FMP: an object is the error envelope, not a row set", () => {
    const violations = rawViolations("fmp", "quote", { "Error Message": "Invalid API KEY" });
    assert.ok(violations.some((v) => v.check === "raw.fmp.error-envelope"));
  });

  it("FMP: accepts an array of rows", () => {
    assert.deepEqual(rawViolations("fmp", "quote", [{ symbol: "AAPL", price: 1 }]), []);
  });

  it("Tiingo: accepts a crypto body with priceData", () => {
    assert.deepEqual(
      rawViolations("tiingo", "bars", [{ ticker: "btcusd", priceData: [{ open: 1, high: 2, low: 0.5, close: 1.5 }] }]),
      [],
    );
  });

  it("Tiingo: catches a row with no recognisable price field", () => {
    const violations = rawViolations("tiingo", "bars", [{ ticker: "btcusd", somethingElse: 1 }]);
    assert.ok(violations.some((v) => v.check === "raw.tiingo.row-fields"));
  });

  it("Tiingo: an empty array is not a violation", () => {
    assert.deepEqual(rawViolations("tiingo", "bars", []), [], "no rows is a result, not a broken shape");
  });
});

describe("every checked provider has a predicate", () => {
  it("RAW_CHECKED and the dispatcher agree", () => {
    for (const provider of RAW_CHECKED) {
      assert.notEqual(
        checkRawBody(provider, "bars", {}), null,
        `${provider} is listed as checked but the dispatcher returns null`,
      );
    }
  });
});


/** A committed vendor body, by `provider/name`. */
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(
    fileURLToPath(new URL(`./fixtures/raw/${name}.json`, import.meta.url)), "utf8",
  )).body;

describe("the predicates against real vendor bodies", () => {
  /**
   * This is the difference between a predicate and a guess.
   *
   * Everything above uses bodies this file made up. These use bodies the
   * vendor actually sent, captured by scripts/capture-provider-fixtures.mjs and
   * committed — which is the only evidence that can support the claim a check
   * does not fire on healthy data.
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

  it("the three refusal-only providers stay at warn", () => {
    // Their REFUSAL shape is verified above; their healthy shape is not, and
    // that is the direction that matters. A check that has never met a good
    // body must not be able to fail one over.
    for (const provider of ["fmp", "tiingo", "massive", "openbb"]) {
      assert.equal(rawSeverity(provider), "warn", `${provider} was promoted without a healthy capture`);
    }
  });
});
