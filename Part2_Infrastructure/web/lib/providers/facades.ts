/**
 * The capability façades — `getQuote("AAPL")` and its five siblings.
 *
 * Split out of `registry.ts` when that file passed 630 lines. Routes call these.
 * They do not name a vendor, do not know which one answered, and do not change
 * when a key is added or a provider goes down: selection is by capability and
 * asset class, in the ranked order `./adapters` produces, with the reliability
 * policy in `./runtime` applied to every attempt.
 */

import { applicableAssets, inapplicableReason, isApplicable } from "./capabilities";
import {
  checkBars,
  checkFundamentals,
  checkNews,
  checkQuote,
} from "./contracts";
import { dispatch } from "./runtime";
import { candidatesFor, type Options } from "./adapters";
import { classify } from "./symbols";
import {
  AssetClass,
  Capability,
  Document,
  Fundamentals,
  NewsItem,
  NotApplicableError,
  OhlcvBar,
  Quote,
  Sourced,
} from "./types";

/**
 * The applicability gate, consulted by every symbol-keyed façade before
 * dispatch. A capability the asset class cannot answer is refused here — no
 * provider contacted, no quota spent, no breaker or latency sample touched —
 * rather than discovered four vendors later at a call each.
 */
function assertApplicable(capability: Capability, symbol: string, asset: AssetClass): void {
  if (isApplicable(capability, asset)) return;
  throw new NotApplicableError(
    capability,
    symbol,
    asset,
    applicableAssets(capability),
    inapplicableReason(capability, symbol, asset),
  );
}

// --------------------------------------------------------------------------
// Cache keys
// --------------------------------------------------------------------------

/**
 * The cache key each façade uses, as data rather than as a template literal
 * buried in a call site.
 *
 * The pipeline inspector shows the exact key a lookup hit or missed, and the
 * operator console purges by prefix. Both of those are wrong the moment a key
 * is written down twice, so they are written down once, here, and the façades
 * below are the only other consumers.
 */
export const cacheKeys = {
  quote: (symbol: string, provider?: string | null) => `quote:${symbol}:${provider ?? "*"}`,
  bars: (symbol: string, interval: string, limit: number, provider?: string | null) =>
    `bars:${symbol}:${interval}:${limit}:${provider ?? "*"}`,
  news: (symbols: string[], limit: number, provider?: string | null) =>
    `news:${symbols.join(",")}:${limit}:${provider ?? "*"}`,
  fundamentals: (symbol: string, provider?: string | null) =>
    `fundamentals:${symbol}:${provider ?? "*"}`,
  search: (query: string, limit: number, provider?: string | null) =>
    `search:${query}:${limit}:${provider ?? "*"}`,
  scrape: (url: string, provider?: string | null) => `scrape:${url}:${provider ?? "*"}`,
} as const;

// --------------------------------------------------------------------------
// Capability façades
// --------------------------------------------------------------------------

// `async` so the applicability refusal is a rejection, never a synchronous
// throw a `.catch()` caller would miss.
export async function getQuote(symbol: string, opts: Options = {}): Promise<Sourced<Quote>> {
  const asset = classify(symbol);
  assertApplicable("quote", symbol, asset);
  return dispatch(
    candidatesFor("quote", asset),
    (a, ctx) => a.quote!(symbol, asset, ctx),
    {
      capability: "quote",
      cacheKey: cacheKeys.quote(symbol, opts.provider),
      pin: opts.provider,
      symbol,
      // The façade is the only layer that knows the payload's shape, so it is
      // where the expectations are attached.
      contract: (quote, provider) => checkQuote(provider, quote),
      ...opts,
    },
  );
}

export async function getBars(
  symbol: string,
  interval: string,
  limit: number,
  opts: Options = {},
): Promise<Sourced<OhlcvBar[]>> {
  const asset = classify(symbol);
  assertApplicable("bars", symbol, asset);
  return dispatch(
    candidatesFor("bars", asset),
    (a, ctx) => a.bars!(symbol, asset, interval, limit, ctx),
    {
      capability: "bars",
      cacheKey: cacheKeys.bars(symbol, interval, limit, opts.provider),
      pin: opts.provider,
      symbol,
      contract: (bars, provider) => checkBars(provider, bars, limit),
      ...opts,
    },
  );
}

export async function getNews(
  symbols: string[],
  limit: number,
  opts: Options = {},
): Promise<Sourced<NewsItem[]>> {
  // News is asked per-issuer, so the asset class of the *first* symbol picks the
  // pool; a mixed list would otherwise silently exclude every crypto-only feed.
  const asset = symbols.length ? classify(symbols[0]) : "equity";
  if (symbols.length) assertApplicable("news", symbols[0], asset);
  return dispatch(
    candidatesFor("news", asset),
    (a, ctx) => a.news!(symbols, limit, ctx),
    {
      capability: "news",
      cacheKey: cacheKeys.news(symbols, limit, opts.provider),
      pin: opts.provider,
      symbol: symbols[0] ?? null,
      contract: (items, provider) => checkNews(provider, items, limit),
      ...opts,
    },
  );
}

export async function getFundamentals(
  symbol: string,
  opts: Options = {},
): Promise<Sourced<Fundamentals>> {
  // Classified, not pinned to equity: this façade used to hard-code the
  // equity pool, so a crypto symbol walked the whole chain — four calls,
  // one of them Alpha Vantage's, to be told four times there is no issuer.
  const asset = classify(symbol);
  assertApplicable("fundamentals", symbol, asset);
  return dispatch(
    candidatesFor("fundamentals", asset),
    (a, ctx) => a.fundamentals!(symbol, ctx),
    {
      capability: "fundamentals",
      cacheKey: cacheKeys.fundamentals(symbol, opts.provider),
      pin: opts.provider,
      symbol,
      contract: (profile, provider) => checkFundamentals(provider, profile, symbol),
      ...opts,
    },
  );
}

export async function searchWeb(
  query: string,
  limit: number,
  opts: Options = {},
): Promise<Sourced<Document[]>> {
  return dispatch(
    candidatesFor("search", "equity"),
    (a, ctx) => a.search!(query, limit, ctx),
    {
      capability: "search",
      cacheKey: cacheKeys.search(query, limit, opts.provider),
      pin: opts.provider,
      ...opts,
    },
  );
}

export function scrapeUrl(url: string, opts: Options = {}): Promise<Sourced<Document>> {
  return dispatch(
    candidatesFor("scrape", "equity"),
    (a, ctx) => a.scrape!(url, ctx),
    {
      capability: "scrape",
      cacheKey: cacheKeys.scrape(url, opts.provider),
      pin: opts.provider,
      ...opts,
    },
  );
}
