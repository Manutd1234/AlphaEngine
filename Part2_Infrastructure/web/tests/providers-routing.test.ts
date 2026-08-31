/**
 * Who gets asked, and who is refused before anything is spent.
 *
 * Nothing here touches the network — and two of the decisions here happen
 * before a request would leave the process at all. First, what the symbol IS:
 * a pair is crypto, but a bare base can be a real equity listing, and a symbol
 * routed to the wrong asset class reaches a vendor that answers confidently
 * about a different instrument. Second, whether the capability applies to the
 * symbol at all: fundamentals describe an issuer, so asking for them on a
 * crypto pair can only burn quota to be told 404 by every provider in the
 * chain.
 *
 * So the refusal is asserted to cost nothing — no quota key, no breaker record,
 * because nobody was reached — and the reason it gives names the capability,
 * the scope and the symbol, so the reader is not left guessing which of the
 * three was wrong.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { NextRequest } from "next/server";

import { GET as quoteRoute } from "../app/api/quote/route";
import {
  applicableAssets,
  inapplicableReason,
  isApplicable,
  ROUTE_MATRIX,
} from "../lib/providers/capabilities";
import { cacheHeaders } from "../lib/providers/http";
import {
  classify,
  cacheKeys,
  candidatesFor,
  getFundamentals,
  getNews,
  getQuote,
  isValidSymbol,
  searchWeb,
} from "../lib/providers/registry";
import { MemoryStore } from "../lib/providers/runtime";
import { NotApplicableError, ProviderError } from "../lib/providers/types";
import { withEnvironment } from "./helpers/reliability-fixtures";

test("classify: pairs are crypto, bare bases are not", () => {
  assert.equal(classify("BTCUSDT"), "crypto");
  assert.equal(classify("ETHUSD"), "crypto");
  // BTC alone is a real NYSE listing (Bitcoin Depot) — must stay equity.
  assert.equal(classify("BTC"), "equity");
  assert.equal(classify("AAPL"), "equity");
  assert.equal(classify("EURUSD"), "fx");
  // SOLUSD is crypto (SOL is a known base), not fx.
  assert.equal(classify("SOLUSD"), "crypto");
});

test("isValidSymbol accepts class shares and rejects injection shapes", () => {
  assert.ok(isValidSymbol("BRK.B"));
  assert.ok(isValidSymbol("AAPL"));
  assert.ok(isValidSymbol("BTCUSDT"));
  assert.ok(!isValidSymbol("A;DROP"));
  assert.ok(!isValidSymbol(""));
});

test("candidatesFor orders by rank and filters by asset", () => {
  const eq = candidatesFor("bars", "equity").map((a) => a.meta.id);
  // Massive leads the equity bars chain. Its rank moved 1 -> 2 when Bybit was
  // inserted ahead of Binance for crypto and every rank below shifted by one;
  // the assertion is on the resulting ORDER rather than the literal, which is
  // what should survive that kind of renumbering.
  assert.ok(!eq.includes("binance"), "a crypto-only venue reached the equity chain");
  assert.ok(!eq.includes("bybit"), "a crypto-only venue reached the equity chain");
  assert.equal(eq[0], "massive");
  const cr = candidatesFor("quote", "crypto").map((a) => a.meta.id);
  assert.equal(cr[0], "binance"); // keyless baseline first — Bybit serves bars only
  const crBars = candidatesFor("bars", "crypto").map((a) => a.meta.id);
  assert.equal(crBars[0], "bybit"); // the nearer origin: 6.2ms vs 72.7ms
});

// --------------------------------------------------------------------------
// Applicability — the gate before dispatch
// --------------------------------------------------------------------------

test("CAPABILITY_ASSETS: the failover graph draws exactly the nine desk routes", () => {
  const pairs = ROUTE_MATRIX.flatMap((r) => r.assets.map((a) => `${r.capability}/${a}`));
  assert.deepEqual(pairs, [
    "quote/crypto", "quote/equity",
    "bars/crypto", "bars/equity",
    "news/crypto", "news/equity",
    "fundamentals/equity",
    "search/equity",
    "scrape/equity",
  ]);
  // fx is accepted by the price façades even though the desk draws no fx route:
  // classify("EURUSD") is fx and /api/quote?symbol=EURUSD reaches a vendor today.
  assert.equal(isApplicable("quote", "fx"), true);
  assert.equal(isApplicable("fundamentals", "crypto"), false);
  assert.equal(isApplicable("fundamentals", "fx"), false);
  assert.deepEqual([...applicableAssets("fundamentals")], ["equity"]);
  assert.deepEqual([...applicableAssets("search")], []);
  assert.equal(isApplicable("scrape", "crypto"), true, "symbol-less capabilities are never gated");
});

test("getFundamentals: a crypto symbol is refused before any provider is asked", async () => {
  const s = new MemoryStore();
  await assert.rejects(
    getFundamentals("BTCUSDT", { store: s, env: {} as NodeJS.ProcessEnv }),
    (err: unknown) => {
      assert.ok(err instanceof NotApplicableError, "a NotApplicableError, not a generic failure");
      assert.equal(err.status, 422);
      assert.equal(err.provider, "registry");
      assert.equal(err.capability, "fundamentals");
      assert.equal(err.asset, "crypto");
      assert.deepEqual([...err.applicable], ["equity"]);
      assert.match(err.message, /equity-only/);
      assert.match(err.message, /BTCUSDT is classified as crypto/);
      assert.match(err.message, /nothing is spent/);
      return true;
    },
  );
  // Nothing was spent and nothing was counted: the ledger has no quota or
  // breaker record for any provider, because none was reached.
  assert.deepEqual(s.keys("quota:"), []);
  assert.deepEqual(s.keys("breaker:"), []);
});

test("inapplicableReason names the capability, the scope and the symbol", () => {
  assert.equal(
    inapplicableReason("fundamentals", "BTCUSDT", "crypto"),
    "Fundamentals describe an issuer, so the capability is equity-only; BTCUSDT is classified as crypto, so no provider is asked and nothing is spent.",
  );
  assert.doesNotMatch(inapplicableReason("fundamentals", "ETHUSDT", "crypto"), / · /);
});

test("unpinned provider exhaustion fails closed with its upstream evidence", async () => {
  const env = {} as NodeJS.ProcessEnv;
  const quoteStore = new MemoryStore();
  const requests = [
    getQuote("AAPL", { env, store: quoteStore }),
    getNews(["AAPL"], 5, { env, store: new MemoryStore() }),
    getFundamentals("AAPL", { env, store: new MemoryStore() }),
    searchWeb("Federal Reserve policy", 5, { env, store: new MemoryStore() }),
  ];

  for (const request of requests) {
    await assert.rejects(request, (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      const attempts = (error as ProviderError & { attempts: Array<{ provider: string }> }).attempts;
      assert.ok(attempts.length > 0, "the upstream failure evidence was dropped");
      assert.ok(attempts.every((attempt) => attempt.provider !== "sandbox"));
      return true;
    });
  }
  assert.deepEqual(quoteStore.keys("quote:"), [], "provider exhaustion must not enter the quote cache");
});

test("an explicit provider pin also fails closed", async () => {
  await assert.rejects(
    getQuote("AAPL", {
      provider: "fmp",
      env: {} as NodeJS.ProcessEnv,
      store: new MemoryStore(),
    }),
    ProviderError,
  );
});

test("a warm response from another provider cannot satisfy an explicit pin", async () => {
  const store = new MemoryStore();
  store.set(cacheKeys.search("inflation", 3, "firecrawl"), {
    data: [{ title: "wrong provider", url: "https://example.test", snippet: "cached" }],
    provenance: {
      provider: "tavily",
      label: "Tavily",
      fetchedAt: new Date(0).toISOString(),
      latencyMs: 1,
      cached: false,
      delayed: false,
      quotaRemaining: null,
      quotaLimit: null,
      quotaWindow: null,
    },
    attempts: [],
  }, 5_000);

  await assert.rejects(
    searchWeb("inflation", 3, {
      provider: "firecrawl",
      env: {} as NodeJS.ProcessEnv,
      store,
    }),
    ProviderError,
  );
});

test("synthetic responses are never cacheable at the HTTP edge", () => {
  assert.deepEqual(cacheHeaders(15, true), { "cache-control": "no-store" });
  assert.match(String((cacheHeaders(15, false) as Record<string, string>)["cache-control"]), /s-maxage=15/);
});

test("the quote route reports provider exhaustion without fabricating a quote", async () => {
  await withEnvironment({
    FMP_API_KEY: undefined,
    TIINGO_API_KEY: undefined,
    MASSIVE_API_KEY: undefined,
    ALPHAVANTAGE_API_KEY: undefined,
    OPENBB_API_URL: undefined,
  }, async () => {
    const response = await quoteRoute(new NextRequest("http://local.test/api/quote?symbol=ZZZQ"));
    const body = await response.json() as {
      quotes: Array<{ error?: string; attempts?: Array<{ provider?: string }>; provenance?: unknown }>;
    };
    assert.equal(response.status, 200);
    assert.match(body.quotes[0]?.error ?? "", /provider/i);
    assert.ok((body.quotes[0]?.attempts?.length ?? 0) > 0);
    assert.equal(body.quotes[0]?.provenance, undefined);
  });
});
