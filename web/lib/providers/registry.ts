/**
 * The registry — one façade over seven vendors.
 * =============================================
 *
 * Routes call `getQuote("AAPL")`. They do not name a vendor, do not know which
 * one answered, and do not change when a key is added or a provider goes down.
 * Selection is by *capability and asset class*, in a ranked order, with the
 * reliability policy in `runtime.ts` applied to every attempt.
 *
 * `consensusQuote` is the piece that exists because this is a trading tool
 * rather than a data viewer. Given more than one configured price source it
 * queries all of them and reports the dispersion, because the failure mode that
 * actually costs money is not an outage — an outage is loud. It is one feed
 * quietly going stale while still returning HTTP 200 with a plausible price. A
 * single source cannot detect that about itself; two can.
 */

import { alphavantage } from "./alphavantage";
import { binance } from "./binance";
import { firecrawl } from "./firecrawl";
import { fmp } from "./fmp";
import { marketstack } from "./marketstack";
import { massive } from "./massive";
import { openbb } from "./openbb";
import {
  breakerOpen,
  dispatch,
  isConfigured,
  quotaState,
  store,
  Store,
} from "./runtime";
import { tiingo } from "./tiingo";
import {
  Adapter,
  AssetClass,
  Attempt,
  Capability,
  Document,
  Fundamentals,
  NewsItem,
  OhlcvBar,
  Priority,
  Quote,
  Sourced,
} from "./types";

export const ADAPTERS: Adapter[] = [
  binance,
  fmp,
  tiingo,
  massive,
  marketstack,
  alphavantage,
  firecrawl,
  openbb,
];

export const BY_ID = new Map(ADAPTERS.map((a) => [a.meta.id, a]));

// --------------------------------------------------------------------------
// Symbol classification
// --------------------------------------------------------------------------

const CRYPTO_QUOTES = ["USDT", "USDC", "BUSD", "USD", "BTC", "ETH"];
const CRYPTO_BASES = new Set([
  "BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX", "MATIC", "POL",
  "DOT", "LINK", "LTC", "TRX", "ATOM", "ARB", "OP", "SUI", "APT", "NEAR",
]);

/**
 * Guess the asset class from the ticker.
 *
 * Deliberately conservative in one direction: `BTCUSDT` is unambiguous, but a
 * bare `BTC` on an equity venue is a real NYSE listing (Bitcoin Depot), so a
 * base symbol only counts as crypto when it carries a recognised quote asset.
 * Getting this wrong routes an equity lookup to Binance and returns "unknown
 * symbol" for a ticker that trades — a confusing failure for a user who typed
 * a valid ticker.
 */
export function classify(symbol: string): AssetClass {
  const s = symbol.toUpperCase();
  for (const q of CRYPTO_QUOTES) {
    if (s.length > q.length && s.endsWith(q) && CRYPTO_BASES.has(s.slice(0, -q.length))) {
      return "crypto";
    }
  }
  if (/^[A-Z]{3}\/?[A-Z]{3}$/.test(s) && !CRYPTO_BASES.has(s.slice(0, 3))) return "fx";
  return "equity";
}

/** Equity tickers are 1–5 letters with an optional class suffix (`BRK.B`). */
export const EQUITY_SYMBOL_RE = /^[A-Z]{1,5}(?:[.-][A-Z]{1,2})?$/;
/** Crypto pairs as the rest of the app writes them. */
export const PAIR_SYMBOL_RE = /^[A-Z0-9]{5,20}$/;

export function isValidSymbol(symbol: string): boolean {
  const s = symbol.toUpperCase();
  return EQUITY_SYMBOL_RE.test(s) || PAIR_SYMBOL_RE.test(s);
}

// --------------------------------------------------------------------------
// Candidate selection
// --------------------------------------------------------------------------

export function candidatesFor(capability: Capability, asset: AssetClass): Adapter[] {
  return ADAPTERS.filter(
    (a) => a.meta.capabilities.includes(capability) && a.meta.assets.includes(asset),
  ).sort((a, b) => (a.meta.rank[capability] ?? 99) - (b.meta.rank[capability] ?? 99));
}

export interface Options {
  priority?: Priority;
  provider?: string | null;
  env?: NodeJS.ProcessEnv;
  store?: Store;
}

// --------------------------------------------------------------------------
// Capability façades
// --------------------------------------------------------------------------

export function getQuote(symbol: string, opts: Options = {}): Promise<Sourced<Quote>> {
  const asset = classify(symbol);
  return dispatch(
    candidatesFor("quote", asset),
    (a, ctx) => a.quote!(symbol, asset, ctx),
    { capability: "quote", cacheKey: `quote:${symbol}:${opts.provider ?? "*"}`, pin: opts.provider, ...opts },
  );
}

export function getBars(
  symbol: string,
  interval: string,
  limit: number,
  opts: Options = {},
): Promise<Sourced<OhlcvBar[]>> {
  const asset = classify(symbol);
  return dispatch(
    candidatesFor("bars", asset),
    (a, ctx) => a.bars!(symbol, asset, interval, limit, ctx),
    {
      capability: "bars",
      cacheKey: `bars:${symbol}:${interval}:${limit}:${opts.provider ?? "*"}`,
      pin: opts.provider,
      ...opts,
    },
  );
}

export function getNews(
  symbols: string[],
  limit: number,
  opts: Options = {},
): Promise<Sourced<NewsItem[]>> {
  // News is asked per-issuer, so the asset class of the *first* symbol picks the
  // pool; a mixed list would otherwise silently exclude every crypto-only feed.
  const asset = symbols.length ? classify(symbols[0]) : "equity";
  return dispatch(
    candidatesFor("news", asset),
    (a, ctx) => a.news!(symbols, limit, ctx),
    {
      capability: "news",
      cacheKey: `news:${symbols.join(",")}:${limit}:${opts.provider ?? "*"}`,
      pin: opts.provider,
      ...opts,
    },
  );
}

export function getFundamentals(
  symbol: string,
  opts: Options = {},
): Promise<Sourced<Fundamentals>> {
  return dispatch(
    candidatesFor("fundamentals", "equity"),
    (a, ctx) => a.fundamentals!(symbol, ctx),
    {
      capability: "fundamentals",
      cacheKey: `fundamentals:${symbol}:${opts.provider ?? "*"}`,
      pin: opts.provider,
      ...opts,
    },
  );
}

export function searchWeb(
  query: string,
  limit: number,
  opts: Options = {},
): Promise<Sourced<Document[]>> {
  return dispatch(
    candidatesFor("search", "equity"),
    (a, ctx) => a.search!(query, limit, ctx),
    { capability: "search", cacheKey: `search:${query}:${limit}`, pin: opts.provider, ...opts },
  );
}

export function scrapeUrl(url: string, opts: Options = {}): Promise<Sourced<Document>> {
  return dispatch(
    candidatesFor("scrape", "equity"),
    (a, ctx) => a.scrape!(url, ctx),
    { capability: "scrape", cacheKey: `scrape:${url}`, pin: opts.provider, ...opts },
  );
}

// --------------------------------------------------------------------------
// Cross-provider reconciliation
// --------------------------------------------------------------------------

export interface ConsensusLeg {
  provider: string;
  label: string;
  price: number;
  asOf: string;
  delayed: boolean;
  latencyMs: number;
  /** Signed distance from the consensus, in basis points. */
  deviationBps: number;
  /** Seconds between this print's stamp and the freshest one in the set. */
  stalenessSec: number;
}

export interface Consensus {
  symbol: string;
  /** Median, not mean — one stuck feed should not drag the reference. */
  price: number | null;
  legs: ConsensusLeg[];
  /** max − min across legs, in bps of the consensus. */
  spreadBps: number | null;
  /** Legs further than `toleranceBps` from the consensus. */
  outliers: string[];
  toleranceBps: number;
  attempts: Attempt[];
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Query every configured price source at once and report where they disagree.
 *
 * The tolerance defaults to 50bps because these providers are legitimately not
 * the same instrument: an EOD close, a delayed composite and a live IEX print
 * for the same ticker will differ by more than a tick and that is not an error.
 * The purpose is not tick-level arbitration — it is catching the leg that is
 * 400bps out because it has been serving a cached Friday close since Tuesday.
 *
 * Deliberately bypasses `dispatch`'s failover: this fans out on purpose and one
 * provider failing is a data point, not a reason to retry elsewhere.
 */
export async function consensusQuote(
  symbol: string,
  toleranceBps = 50,
  opts: Options = {},
): Promise<Consensus> {
  const asset = classify(symbol);
  const pool = candidatesFor("quote", asset);
  const attempts: Attempt[] = [];

  const settled = await Promise.all(
    pool.map(async (adapter) => {
      const { id } = adapter.meta;
      if (!isConfigured(adapter, opts.env ?? process.env)) {
        attempts.push({ provider: id, reason: "not_configured", detail: adapter.meta.keyEnv });
        return null;
      }
      try {
        // Each leg goes through `dispatch` pinned to itself, so it still gets
        // the cache, the breaker and the quota ledger — a consensus check must
        // not be the thing that burns Marketstack's month.
        const r = await getQuote(symbol, { ...opts, provider: id });
        return { adapter, quote: r.data, latencyMs: r.provenance.latencyMs };
      } catch (err) {
        attempts.push({
          provider: id,
          reason: "failed",
          detail: err instanceof Error ? err.message.slice(0, 160) : String(err),
        });
        return null;
      }
    }),
  );

  const ok = settled.filter((x): x is NonNullable<typeof x> => x !== null);
  if (!ok.length) {
    return {
      symbol, price: null, legs: [], spreadBps: null,
      outliers: [], toleranceBps, attempts,
    };
  }

  const prices = ok.map((x) => x.quote.price);
  const consensus = median(prices);
  const freshest = Math.max(...ok.map((x) => Date.parse(x.quote.asOf) || 0));

  const legs: ConsensusLeg[] = ok.map((x) => ({
    provider: x.adapter.meta.id,
    label: x.adapter.meta.label,
    price: x.quote.price,
    asOf: x.quote.asOf,
    delayed: x.quote.delayed,
    latencyMs: x.latencyMs,
    deviationBps: consensus ? ((x.quote.price - consensus) / consensus) * 10_000 : 0,
    stalenessSec: Math.max(0, Math.round((freshest - (Date.parse(x.quote.asOf) || freshest)) / 1000)),
  }));
  legs.sort((a, b) => Math.abs(a.deviationBps) - Math.abs(b.deviationBps));

  return {
    symbol,
    price: consensus,
    legs,
    spreadBps: consensus ? ((Math.max(...prices) - Math.min(...prices)) / consensus) * 10_000 : null,
    outliers: legs.filter((l) => Math.abs(l.deviationBps) > toleranceBps).map((l) => l.provider),
    toleranceBps,
    attempts,
  };
}

// --------------------------------------------------------------------------
// Status
// --------------------------------------------------------------------------

export interface ProviderStatus {
  id: string;
  label: string;
  docs: string;
  signup: string;
  capabilities: Capability[];
  assets: AssetClass[];
  keyEnv: string;
  configured: boolean;
  circuitOpen: boolean;
  quota: { used: number; limit: number; remaining: number; reserve: number; window: string } | null;
  rank: Partial<Record<Capability, number>>;
}

/**
 * The provider matrix, for `/api/providers` and the UI's health strip.
 *
 * Never includes a key or any prefix of one — only the *name* of the variable
 * that would hold it. A status endpoint is the classic place a credential leaks
 * out of an otherwise careful system, usually as a well-meant "first 4 chars so
 * you can tell which key is loaded".
 */
export function providerStatus(
  env: NodeJS.ProcessEnv = process.env,
  s: Store = store,
): ProviderStatus[] {
  return ADAPTERS.map((a) => ({
    id: a.meta.id,
    label: a.meta.label,
    docs: a.meta.docs,
    signup: a.meta.signup,
    capabilities: a.meta.capabilities,
    assets: a.meta.assets,
    keyEnv: a.meta.keyEnv || "(none — public)",
    configured: isConfigured(a, env),
    circuitOpen: breakerOpen(a.meta.id, s),
    quota: quotaState(a, s),
    rank: a.meta.rank,
  }));
}

/** Capability → the providers that could serve it right now. */
export function capabilityMatrix(env: NodeJS.ProcessEnv = process.env) {
  const caps: Capability[] = ["quote", "bars", "news", "fundamentals", "search", "scrape"];
  return Object.fromEntries(
    caps.map((c) => [
      c,
      {
        available: ADAPTERS.filter((a) => a.meta.capabilities.includes(c) && isConfigured(a, env))
          .sort((a, b) => (a.meta.rank[c] ?? 99) - (b.meta.rank[c] ?? 99))
          .map((a) => a.meta.id),
        // What a reviewer needs to know when a capability is dark: which key.
        missing: ADAPTERS.filter((a) => a.meta.capabilities.includes(c) && !isConfigured(a, env))
          .map((a) => a.meta.keyEnv),
      },
    ]),
  );
}
