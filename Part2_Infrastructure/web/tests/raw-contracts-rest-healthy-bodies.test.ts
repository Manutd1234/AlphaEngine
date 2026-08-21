/**
 * The one-sided claim a predicate has to earn: it must not reject a body its
 * own adapter would have parsed.
 *
 * An invented body can never prove a predicate catches a real break — that is
 * what `-fixtures` is for. It can prove the opposite, and the opposite is the
 * failure that took a keyed provider out of production with a valid key: a
 * check firing on data the adapter beside it would have read happily. Four
 * rows here were red before this table existed.
 *
 * The table is guarded against quietly going out of date, because a
 * capability with no row is a capability whose healthy shape nothing checks —
 * which is precisely how `alphavantage` reached `fatal` on `fundamentals` and
 * `news`. Every capability an adapter declares must have a body written down.
 *
 * And the narrowing that made these pass is checked from the other side. A
 * predicate that no longer fires on good data must still fire on bad, or it
 * was deleted rather than corrected — so each fix above has a matching break
 * below it.
 *
 * Siblings: `-calibration` (severity is earned, not assumed), `-predicates`
 * (each provider's predicate, one vendor at a time), `-fixtures` (the same
 * predicates against real captured bodies).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { alphavantage } from "../lib/providers/alphavantage";
import { firecrawl } from "../lib/providers/firecrawl";
import { fmp } from "../lib/providers/fmp";
import { massive } from "../lib/providers/massive";
import { rawViolations } from "../lib/providers/raw-contract-check";
import { tiingo } from "../lib/providers/tiingo";
import { fixture } from "./helpers/raw-fixtures";

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
