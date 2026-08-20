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
import { describe, it } from "node:test";

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

  it("the calibrated set is exactly the providers with committed fixtures", () => {
    // If a fixture is captured, add the provider here in the same commit —
    // and if this list grows without one, that is the drift it exists to catch.
    assert.deepEqual([...RAW_CALIBRATED].sort(), ["binance", "bybit"]);
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
