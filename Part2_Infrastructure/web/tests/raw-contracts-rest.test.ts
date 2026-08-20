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

import { alphavantage } from "../lib/providers/alphavantage";
import { evaluateContract } from "../lib/providers/contract-gate";
import { firecrawl } from "../lib/providers/firecrawl";
import { fmp } from "../lib/providers/fmp";
import { massive } from "../lib/providers/massive";
import { checkRawBody, RAW_CHECKED, rawViolations } from "../lib/providers/raw-contract-check";
import { RAW_CALIBRATED, rawSeverity } from "../lib/providers/raw-contracts-rest";
import { tiingo } from "../lib/providers/tiingo";

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

// --------------------------------------------------------------------------
// The one-sided claim a predicate has to earn
// --------------------------------------------------------------------------

/**
 * A healthy body, per (provider, capability), in the shape the vendor sends.
 *
 * These are documented vendor shapes read back off the adapters that consume
 * them — not captures, and the table says so rather than implying otherwise.
 * That is exactly why the assertion below is ONE-SIDED: an invented body can
 * never prove a predicate catches a real break, but it can prove a predicate
 * fires on data the adapter beside it would have parsed happily, which is the
 * failure that took a keyed provider out of production with a valid key.
 *
 * The four rows that were red before this table existed:
 *   • alphavantage/fundamentals — `OVERVIEW` has no series key. `fatal`.
 *   • alphavantage/news        — `NEWS_SENTIMENT` has no series key. `fatal`.
 *   • firecrawl/search         — v2 groups rows under `data.web`. `fatal`.
 *   • massive/fundamentals     — `results` is one object, not a list. `warn`.
 */
const HEALTHY: Array<{ provider: string; capability: string; what: string; body: unknown }> = [
  {
    provider: "alphavantage", capability: "quote", what: "GLOBAL_QUOTE",
    body: {
      "Global Quote": {
        "01. symbol": "IBM", "02. open": "232.26", "03. high": "238.61", "04. low": "230.51",
        "05. price": "237.16", "06. volume": "5342567", "07. latest trading day": "2026-08-19",
        "08. previous close": "232.67", "09. change": "4.49", "10. change percent": "1.9298%",
      },
    },
  },
  {
    provider: "alphavantage", capability: "bars", what: "TIME_SERIES_DAILY",
    body: {
      "Meta Data": { "2. Symbol": "IBM" },
      "Time Series (Daily)": {
        "2026-08-19": { "1. open": "232.26", "2. high": "238.61", "3. low": "230.51", "4. close": "237.16", "5. volume": "5342567" },
      },
    },
  },
  {
    provider: "alphavantage", capability: "fundamentals", what: "OVERVIEW",
    body: {
      Symbol: "IBM", AssetType: "Common Stock", Name: "International Business Machines",
      Exchange: "NYSE", Currency: "USD", Sector: "TECHNOLOGY", Industry: "COMPUTER & OFFICE EQUIPMENT",
      MarketCapitalization: "220000000000", PERatio: "35.1", EPS: "6.75", Beta: "0.7",
      DividendYield: "0.0284", SharesOutstanding: "925000000", Description: "IBM provides…",
    },
  },
  {
    provider: "alphavantage", capability: "news", what: "NEWS_SENTIMENT",
    body: {
      items: "50", sentiment_score_definition: "x", relevance_score_definition: "y",
      feed: [{
        title: "IBM raises guidance", url: "https://example.com/a", time_published: "20260819T120000",
        summary: "…", source: "Example Wire", overall_sentiment_score: 0.21,
        ticker_sentiment: [{ ticker: "IBM", relevance_score: "0.9" }],
      }],
    },
  },
  {
    provider: "massive", capability: "quote", what: "/v2/aggs/…/prev",
    body: { status: "OK", request_id: "r", resultsCount: 1, results: [{ T: "AAPL", o: 1, h: 2, l: 0.5, c: 1.5, v: 100, t: 1_755_000_000_000 }] },
  },
  {
    provider: "massive", capability: "bars", what: "/v2/aggs/…/range",
    body: { status: "OK", results: [{ o: 1, h: 2, l: 0.5, c: 1.5, v: 100, t: 1_755_000_000_000 }] },
  },
  {
    provider: "massive", capability: "news", what: "/v2/reference/news",
    body: { status: "OK", count: 1, results: [{ id: "n1", title: "t", article_url: "https://example.com/n", published_utc: "2026-08-19T12:00:00Z", publisher: { name: "Example" }, tickers: ["AAPL"] }] },
  },
  {
    provider: "massive", capability: "fundamentals", what: "/v3/reference/tickers/{t} — results is ONE object",
    body: { status: "OK", request_id: "r", results: { ticker: "AAPL", name: "Apple Inc.", primary_exchange: "XNAS", currency_name: "usd", market_cap: 3.4e12, sic_description: "Electronic Computers" } },
  },
  {
    provider: "tiingo", capability: "quote", what: "/iex — last is null out of hours",
    body: [{ ticker: "AAPL", last: null, tngoLast: 231.4, prevClose: 230.1, open: 230.5, high: 232, low: 229.8, volume: 1_000, timestamp: "2026-08-19T20:00:00Z" }],
  },
  {
    provider: "tiingo", capability: "bars", what: "/tiingo/daily/{t}/prices",
    body: [{ date: "2026-08-19T00:00:00.000Z", open: 1, high: 2, low: 0.5, close: 1.5, volume: 100, adjClose: 1.5, adjOpen: 1, adjHigh: 2, adjLow: 0.5, adjVolume: 100 }],
  },
  {
    provider: "tiingo", capability: "news", what: "/tiingo/news — a story, not a price row",
    body: [{ id: 1, title: "AAPL ships", url: "https://example.com/s", description: "…", publishedDate: "2026-08-19T12:00:00Z", crawlDate: "2026-08-19T12:01:00Z", source: "example.com", tickers: ["aapl"], tags: [] }],
  },
  {
    provider: "fmp", capability: "quote", what: "/stable/quote",
    body: [{ symbol: "AAPL", price: 231.4, previousClose: 230.1, change: 1.3, changePercentage: 0.56, open: 230.5, dayHigh: 232, dayLow: 229.8, volume: 1_000, timestamp: 1_755_000_000 }],
  },
  {
    provider: "fmp", capability: "bars", what: "/stable/historical-price-eod/full",
    body: [{ symbol: "AAPL", date: "2026-08-19", open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }],
  },
  {
    provider: "fmp", capability: "fundamentals", what: "/stable/profile",
    body: [{ symbol: "AAPL", companyName: "Apple Inc.", exchangeFullName: "NASDAQ Global Select", sector: "Technology", industry: "Consumer Electronics", currency: "USD", marketCap: 3.4e12, beta: 1.2, lastDividend: 1.0, price: 231.4, description: "Apple designs…" }],
  },
  {
    provider: "fmp", capability: "news", what: "/stable/news/stock",
    body: [{ symbol: "AAPL", publishedDate: "2026-08-19 12:00:00", title: "t", url: "https://example.com/f", publisher: "Example", text: "…" }],
  },
  {
    provider: "firecrawl", capability: "search", what: "v2 — rows grouped under data.web",
    body: { success: true, data: { web: [{ url: "https://example.com", title: "Example", description: "An example", markdown: "# Example" }] } },
  },
  {
    provider: "firecrawl", capability: "search", what: "v1 — a flat data array",
    body: { success: true, data: [{ url: "https://example.com", markdown: "# Example", metadata: { sourceURL: "https://example.com", title: "Example" } }] },
  },
  {
    provider: "firecrawl", capability: "search", what: "no results is an answer, not a broken shape",
    body: { success: true, data: { web: [] } },
  },
  {
    provider: "firecrawl", capability: "scrape", what: "the document directly under data",
    body: { success: true, data: { markdown: "# Example Domain", metadata: { sourceURL: "https://example.com", title: "Example Domain", statusCode: 200 } } },
  },
  {
    // One row covers OpenBB completely, and not by hand-waving: the predicate
    // ignores `capability` because the envelope is the same `{ok, data}` on
    // all four routes — it is our own service, not a vendor with four schemas.
    // Verified live against quote, bars, news and fundamentals in both asset
    // classes before this was promoted to `fatal`.
    //
    // The body is the COMMITTED CAPTURE, not a written-down shape. Every other
    // row here has to be invented because the vendor wants a key nobody on
    // this machine can read; OpenBB needs no credential at all, so inventing
    // its body would be guessing at the one thing here we can measure — and
    // the guess said `results`, a key the service has never sent.
    provider: "openbb", capability: "quote", what: "the captured service envelope",
    body: fixture("openbb/quote"),
  },
];

describe("no predicate rejects a body its own adapter would have parsed", () => {
  for (const { provider, capability, what, body } of HEALTHY) {
    it(`${provider} ${capability}: ${what}`, () => {
      const violations = rawViolations(provider, capability, body);
      assert.deepEqual(
        violations, [],
        `a healthy ${provider} ${capability} body raised ${JSON.stringify(violations)}`,
      );
    });
  }
});

describe("the healthy-body table covers every capability its adapter declares", () => {
  /**
   * The guard against this table quietly going out of date.
   *
   * A predicate is dispatched by `checkRawBody(provider, capability, …)` for
   * EVERY capability the adapter declares, so a capability with no row above
   * is a capability whose healthy shape nothing checks — which is precisely
   * how `alphavantage` reached `fatal` on `fundamentals` and `news`. Adding a
   * capability to an adapter now turns this red until a body is written down.
   */
  const covered = new Set(HEALTHY.map((c) => `${c.provider}:${c.capability}`));
  for (const adapter of [alphavantage, fmp, tiingo, massive, firecrawl]) {
    it(`${adapter.meta.id} declares ${adapter.meta.capabilities.join(", ")}`, () => {
      const missing = adapter.meta.capabilities
        .filter((capability) => !covered.has(`${adapter.meta.id}:${capability}`));
      assert.deepEqual(missing, [], `no healthy body written down for ${adapter.meta.id} ${missing.join(", ")}`);
    });
  }
});

describe("the narrowed predicates still catch a real break", () => {
  // The other half of every fix above: a check that no longer fires on good
  // data must still fire on bad, or it has been deleted rather than corrected.

  it("Alpha Vantage: a news feed that stopped being an array", () => {
    const violations = rawViolations("alphavantage", "news", { items: "1", feed: { "0": {} } });
    assert.ok(violations.some((v) => v.check === "raw.alphavantage.feed-type"), JSON.stringify(violations));
  });

  it("Alpha Vantage: an advisory is still named on an uncalibrated capability", () => {
    const violations = rawViolations("alphavantage", "fundamentals", { Information: "rate limit reached" });
    assert.ok(violations.some((v) => v.check === "raw.alphavantage.advisory"), JSON.stringify(violations));
  });

  it("Alpha Vantage: an empty Global Quote is a 404, not a renamed field set", () => {
    // The vendor's honest "no such symbol". The adapter answers it with a 404;
    // calling it a shape violation would blame the vendor for the input.
    assert.deepEqual(rawViolations("alphavantage", "quote", { "Global Quote": {} }), []);
  });

  it("Massive: fundamentals results that is neither object nor row set", () => {
    const violations = rawViolations("massive", "fundamentals", { status: "OK", results: "AAPL" });
    assert.ok(violations.some((v) => v.check === "raw.massive.results-type"), JSON.stringify(violations));
  });

  it("Massive: a bars body whose results stopped being a list", () => {
    const violations = rawViolations("massive", "bars", { status: "OK", results: { c: 1 } });
    assert.ok(violations.some((v) => v.check === "raw.massive.results-type"), JSON.stringify(violations));
  });

  it("Tiingo: a story with no url or title — the rows the adapter silently drops", () => {
    const violations = rawViolations("tiingo", "news", [{ id: 1, headline: "renamed", link: "https://example.com" }]);
    assert.ok(violations.some((v) => v.check === "raw.tiingo.news-fields"), JSON.stringify(violations));
  });

  it("Tiingo: a price row with no recognisable price field still fires", () => {
    const violations = rawViolations("tiingo", "quote", [{ ticker: "aapl", somethingElse: 1 }]);
    assert.ok(violations.some((v) => v.check === "raw.tiingo.row-fields"), JSON.stringify(violations));
  });

  it("Firecrawl: grouped rows with nothing readable in them", () => {
    const violations = rawViolations("firecrawl", "search", { success: true, data: { web: [{ url: "https://example.com" }] } });
    assert.ok(violations.some((v) => v.check === "raw.firecrawl.content-missing"), JSON.stringify(violations));
  });
});

describe("a warn cannot fail a request, and that is the gate's arithmetic", () => {
  /**
   * Asserted against the gate itself, not against a comment.
   *
   * `evaluateContract` is what decides whether a raw violation fails a
   * provider: `passed` is recomputed as the normaliser's verdict AND no fatal
   * raw violation. An uncalibrated provider's `warn` therefore travels with
   * the provenance and never trips failover — the claim the whole `warn`
   * default rests on, and the reason it is pinned here rather than assumed.
   */
  it("a warn-only raw violation leaves an otherwise passing contract passing", () => {
    const evaluated = evaluateContract(
      () => ({ provider: "tiingo", capability: "news", passed: true, violations: [], notEvaluated: [] }),
      [],
      "tiingo",
      "news",
      { violations: [{ check: "raw.tiingo.news-fields", severity: "warn", message: "m" }], body: [], seen: true },
    );
    assert.equal(evaluated?.passed, true, "a warn must not fail the contract");
    assert.equal(evaluated?.violations.length, 1, "and must still be reported");
  });

  it("a fatal raw violation fails a contract the normaliser was happy with", () => {
    const evaluated = evaluateContract(
      () => ({ provider: "binance", capability: "bars", passed: true, violations: [], notEvaluated: [] }),
      [],
      "binance",
      "bars",
      { violations: [{ check: "raw.binance.bars.is_array", severity: "fatal", message: "m" }], body: [], seen: true },
    );
    assert.equal(evaluated?.passed, false);
  });
});
