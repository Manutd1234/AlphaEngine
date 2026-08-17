/**
 * Each vendor spells a symbol its own way, and a wrong spelling is not an
 * error — it is an empty answer with HTTP 200.
 *
 * Alpha Vantage's news endpoint answered `tickers=BTCUSDT` with an empty feed
 * and the desk read "no stories for this symbol"; the vendor wanted
 * `CRYPTO:BTC`. These tests pin the URL each adapter actually builds for a
 * crypto pair, an fx pair and an equity, against a fake fetch that records
 * what it was asked and answers nothing — the assertion is on the request,
 * which is the half of the conversation this codebase controls.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { alphavantage } from "../lib/providers/alphavantage";
import { _ticker, massive } from "../lib/providers/massive";
import { openbb } from "../lib/providers/openbb";
import { candidatesFor } from "../lib/providers/registry";
import { classify, cryptoBase, usdPair } from "../lib/providers/symbols";
import { tiingo } from "../lib/providers/tiingo";
import type { FetchCtx } from "../lib/providers/types";

/** A FetchCtx that records every URL and answers an empty payload. */
function recorder(answer: unknown = {}): { ctx: FetchCtx; urls: string[] } {
  const urls: string[] = [];
  const ctx: FetchCtx = {
    key: "k",
    baseUrl: "https://vendor.test",
    json: async (url) => {
      urls.push(String(url));
      return answer;
    },
  };
  return { ctx, urls };
}

describe("cryptoBase", () => {
  it("strips a recognised quote asset from a recognised base", () => {
    assert.equal(cryptoBase("BTCUSDT"), "BTC");
    assert.equal(cryptoBase("solusdc"), "SOL");
    assert.equal(cryptoBase("ETHBTC"), "ETH");
  });
  it("is null for anything classify does not call crypto", () => {
    assert.equal(cryptoBase("BTC"), null, "a bare base is an equity listing, not a pair");
    assert.equal(cryptoBase("AAPL"), null);
    assert.equal(cryptoBase("EURUSD"), null);
    assert.equal(classify("EURUSD"), "fx");
  });
  it("keeps usdPair for the vendors that quote against USD", () => {
    assert.equal(usdPair("BTCUSDT"), "BTCUSD");
  });
});

describe("Alpha Vantage news spells the ticker the vendor's way", () => {
  it("crypto → CRYPTO:<base>, fx → FOREX:<ccy>, equity untouched", async () => {
    const { ctx, urls } = recorder({ feed: [] });
    await alphavantage.news!(["BTCUSDT"], 8, ctx);
    await alphavantage.news!(["EURUSD"], 8, ctx);
    await alphavantage.news!(["AAPL", "msft"], 8, ctx);
    assert.match(urls[0], /tickers=CRYPTO%3ABTC/);
    assert.match(urls[1], /tickers=FOREX%3AEUR/);
    assert.match(urls[2], /tickers=AAPL%2CMSFT/);
    assert.doesNotMatch(urls[0], /BTCUSDT/, "the raw pair must not reach the vendor");
  });
});

describe("Massive news", () => {
  it("is an equity-only capability: the crypto news chain does not include it", () => {
    assert.ok(!candidatesFor("news", "crypto").some((a) => a.meta.id === "massive"));
    assert.ok(candidatesFor("news", "equity").some((a) => a.meta.id === "massive"));
    // The narrowing is per capability: crypto quotes and bars still route to it.
    assert.ok(candidatesFor("quote", "crypto").some((a) => a.meta.id === "massive"));
  });
  it("still spells a crypto ticker X:<base>USD in case the entitlement flips", async () => {
    assert.equal(_ticker("BTCUSDT", "crypto"), "X:BTCUSD");
    assert.equal(_ticker("aapl", "equity"), "AAPL");
    const { ctx, urls } = recorder({ results: [] });
    await massive.news!(["BTCUSDT"], 8, ctx);
    assert.match(urls[0], /ticker=X%3ABTCUSD/);
  });
});

describe("OpenBB news tells the service the asset class", () => {
  it("so the service can spell a pair BTC-USD for YFinance", async () => {
    const { ctx, urls } = recorder({ ok: true, data: [] });
    await openbb.news!(["BTCUSDT"], 8, ctx);
    await openbb.news!(["AAPL"], 8, ctx);
    assert.match(urls[0], /\/news\?/);
    assert.match(urls[0], /asset=crypto/);
    assert.match(urls[1], /asset=equity/);
  });
});

describe("Tiingo news", () => {
  it("names a pair the way its quote and bars paths do", async () => {
    const { ctx, urls } = recorder([]);
    await tiingo.news!(["BTCUSDT", "AAPL"], 8, ctx);
    assert.match(urls[0], /tickers=btcusd%2Caapl/);
  });
});
