/**
 * What each REST provider's raw predicate is for, one vendor at a time.
 *
 * A raw check exists because the shapes below are all HTTP 200. Alpha Vantage
 * answers a spent quota with a `Note`, Massive answers a missing entitlement
 * with `status: "NOT_AUTHORIZED"`, OpenBB answers a downstream outage with
 * `{ok: false, error}`, FMP answers a bad key with an object where the adapter
 * indexes rows. Nothing above the envelope can tell any of those from a
 * successful call that found nothing — so the ledger is told here, and each
 * refusal is recorded as a refusal rather than as an empty result.
 *
 * The bodies in this file are INVENTED: written down from the vendor's
 * documented shape, because the keys are Sensitive in the deployment and no
 * machine that can run the suite can read them. That is enough to prove a
 * predicate fires on a break it names. It is not enough to prove it stays
 * quiet on real data, which is why `-fixtures` exists beside it and why these
 * providers report `warn` until a capture is committed.
 *
 * Siblings: `-calibration` (severity is earned, not assumed), `-fixtures` (the
 * committed vendor captures), `-healthy-bodies` (the one-sided claim that no
 * predicate rejects a body its own adapter would have parsed).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { rawViolations } from "../lib/providers/raw-contract-check";

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

  it("records ok:false as the service declining, not as an empty result", () => {
    // The service answers a downstream outage with HTTP 200 and
    // `{ok:false, error}`. Nothing above the envelope can tell that from a
    // successful call that found nothing, so the ledger is told here — the
    // same job Massive's `status` check and Bybit's `retCode` check do.
    const violations = rawViolations("openbb", "bars", {
      ok: false, error: "OpenBB/YFinance bars is temporarily unavailable.",
    });
    assert.ok(violations.some((v) => v.check === "raw.openbb.declined"), JSON.stringify(violations));
  });

  it("accepts a healthy envelope", () => {
    // `data`, not `results`. This body said `results` — a key the service has
    // never sent — so it was a healthy-body test written against a shape its
    // producer does not produce, which proves nothing about the producer.
    assert.deepEqual(rawViolations("openbb", "bars", { ok: true, data: [] }), []);
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
