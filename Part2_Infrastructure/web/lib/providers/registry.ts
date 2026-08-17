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

import {
  type LatencyStats,
  latencyStats,
  outageFor,
} from "../observability";
import { alphavantage } from "./alphavantage";
import { binance } from "./binance";
import { bybit } from "./bybit";
import { applicableAssets, inapplicableReason, isApplicable, ROUTE_MATRIX } from "./capabilities";
import { checkBars, checkQuote } from "./contracts";
import { firecrawl } from "./firecrawl";
import { fmp } from "./fmp";
import { massive } from "./massive";
import { openbb } from "./openbb";
import {
  type BreakerSnapshot,
  breakerSnapshot,
  dispatch,
  isConfigured,
  licenceBlock,
  licenceBlocks,
  quotaState,
  store,
  Store,
  TTL_MS,
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
  NotApplicableError,
  OhlcvBar,
  Priority,
  Quote,
  Sourced,
} from "./types";

export const ADAPTERS: Adapter[] = [
  bybit,
  binance,
  fmp,
  tiingo,
  massive,
  alphavantage,
  firecrawl,
  openbb,
];

export const BY_ID = new Map(ADAPTERS.map((a) => [a.meta.id, a]));

// --------------------------------------------------------------------------
// Symbol classification — lives in symbols.ts (adapters need it too, and the
// registry imports every adapter, so it must sit below both). Re-exported here
// because this module is the public face of the provider layer.
// --------------------------------------------------------------------------

export { classify, EQUITY_SYMBOL_RE, isValidSymbol, PAIR_SYMBOL_RE } from "./symbols";
export { applicableAssets, CAPABILITY_ASSETS, inapplicableReason, isApplicable, ROUTE_MATRIX } from "./capabilities";
import { classify } from "./symbols";

// --------------------------------------------------------------------------
// Candidate selection
// --------------------------------------------------------------------------

export function candidatesFor(capability: Capability, asset: AssetClass): Adapter[] {
  return ADAPTERS.filter(
    (a) => a.meta.capabilities.includes(capability)
      && (a.meta.capabilityAssets?.[capability] ?? a.meta.assets).includes(asset),
  ).sort((a, b) => (a.meta.rank[capability] ?? 99) - (b.meta.rank[capability] ?? 99));
}

export interface Options {
  priority?: Priority;
  provider?: string | null;
  env?: NodeJS.ProcessEnv;
  store?: Store;
}

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
  search: (query: string, limit: number) => `search:${query}:${limit}`,
  scrape: (url: string) => `scrape:${url}`,
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
    { capability: "search", cacheKey: cacheKeys.search(query, limit), pin: opts.provider, ...opts },
  );
}

export function scrapeUrl(url: string, opts: Options = {}): Promise<Sourced<Document>> {
  return dispatch(
    candidatesFor("scrape", "equity"),
    (a, ctx) => a.scrape!(url, ctx),
    { capability: "scrape", cacheKey: cacheKeys.scrape(url), pin: opts.provider, ...opts },
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
      // Checked here, not left to the pinned dispatch's throw: the catch below
      // would record the outage as "failed", and a fault an operator caused
      // deliberately must never be reported as one they did not.
      const outage = outageFor(id);
      if (outage) {
        attempts.push({
          provider: id,
          reason: "simulated_outage",
          detail: `restores in ${Math.max(0, Math.ceil((outage.expiresAt - Date.now()) / 1000))}s`,
        });
        return null;
      }
      try {
        // Each leg goes through `dispatch` pinned to itself, so it still gets
        // the cache, the breaker and the quota ledger — a consensus check must
        // not be the thing that burns Alpha Vantage's day.
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
  /** Full breaker shape — failure count and cooldown, not just the boolean. */
  breaker: BreakerSnapshot;
  /** p50/p95/p99 over the recent window, with the sample count that produced them. */
  latency: LatencyStats;
  /** Set while an operator is deliberately holding this provider out of routing. */
  simulatedOutage: { expiresAt: number; note: string } | null;
  /**
   * Capabilities this key has been refused (401/402/403), learned by dispatch
   * on this instance and skipped without a call until they expire.
   */
  licence: Array<{ capability: Capability; status: number | null; expiresAt: number }>;
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
  return ADAPTERS.map((a) => {
    // `breakerSnapshot`, not `breakerOpen`: the latter retires an elapsed
    // breaker as a side effect of being asked. A status endpoint that half-opens
    // circuits merely by being polled would make the health panel a participant
    // in the behaviour it is supposed to be reporting.
    const breaker = breakerSnapshot(a.meta.id, s);
    const outage = outageFor(a.meta.id);
    return {
      id: a.meta.id,
      label: a.meta.label,
      docs: a.meta.docs,
      signup: a.meta.signup,
      capabilities: a.meta.capabilities,
      assets: a.meta.assets,
      keyEnv: a.meta.keyEnv || "(none — public)",
      configured: isConfigured(a, env),
      circuitOpen: breaker.state === "open",
      quota: quotaState(a, s),
      rank: a.meta.rank,
      breaker,
      latency: latencyStats(a.meta.id),
      simulatedOutage: outage ? { expiresAt: outage.expiresAt, note: outage.note } : null,
      licence: licenceBlocks(a.meta.id, s).map((block) => ({
        capability: block.capability,
        status: block.status,
        expiresAt: Date.now() + block.expiresInMs,
      })),
    };
  });
}

// --------------------------------------------------------------------------
// Failover graph
// --------------------------------------------------------------------------

/** Why a provider is or is not routable right now, in dispatch's own order. */
export type RouteState =
  | "ready"
  | "simulated_outage"
  | "not_configured"
  | "circuit_open"
  /** This key was refused this capability (401/402/403); skipped until the block expires. */
  | "unlicensed"
  | "quota_exhausted"
  | "quota_reserved";

export interface FailoverNode {
  provider: string;
  label: string;
  /** Position in the ranked chain for this capability, 1-based. */
  rank: number;
  state: RouteState;
  detail: string;
  latency: LatencyStats;
  /** True for the node a request issued right now would actually land on. */
  active: boolean;
  /**
   * Out-of-band health-probe verdict, where one exists (today: OpenBB).
   *
   * Kept separate from `state` rather than folded into it, because they are
   * different facts and collapsing them makes the graph wrong either way. A
   * provider whose service is down is still *configured*, so `dispatch` will
   * genuinely try it first and only fail over after it times out — reporting it
   * as skipped would be a lie about routing. Reporting it as healthy would be a
   * lie about the service. Both are stated.
   */
  health: { ok: boolean; detail: string } | null;
}

export interface FailoverRoute {
  capability: Capability;
  asset: AssetClass;
  nodes: FailoverNode[];
  /** Provider id a request would reach, or null when the whole chain is dark. */
  activeProvider: string | null;
  /** Cache TTL in front of this chain, from the runtime's per-capability table. */
  cacheTtlMs: number;
}

/**
 * Evaluate one provider exactly the way `dispatch` will.
 *
 * The order of these checks is not cosmetic — it is copied from the dispatch
 * loop, because a graph that shows "quota spent" where the code would have said
 * "circuit open" is worse than no graph: it sends someone to fix the wrong
 * thing. `priority` matters too, since the reserve fences background traffic out
 * of budget an interactive lookup could still spend.
 */
function routeState(
  adapter: Adapter,
  capability: Capability,
  env: NodeJS.ProcessEnv,
  s: Store,
  priority: Priority,
): { state: RouteState; detail: string } {
  const outage = outageFor(adapter.meta.id);
  if (outage) {
    const seconds = Math.ceil((outage.expiresAt - Date.now()) / 1000);
    return { state: "simulated_outage", detail: `${outage.note} — restores in ${seconds}s` };
  }
  if (!isConfigured(adapter, env)) {
    return { state: "not_configured", detail: `set ${adapter.meta.keyEnv}` };
  }
  const breaker = breakerSnapshot(adapter.meta.id, s);
  if (breaker.state === "open") {
    return {
      state: "circuit_open",
      detail: `${breaker.failures} consecutive failures — probes in ${Math.ceil(breaker.cooldownRemainingMs / 1000)}s`,
    };
  }
  const licence = licenceBlock(adapter.meta.id, capability, s);
  if (licence) {
    const hours = Math.max(1, Math.round(licence.expiresInMs / 3_600_000));
    return {
      state: "unlicensed",
      detail: `HTTP ${licence.status ?? "?"} on ${capability}; learned on this instance, re-probes in ${hours} h`,
    };
  }
  const quota = quotaState(adapter, s);
  if (quota && quota.remaining <= 0) {
    return { state: "quota_exhausted", detail: `${quota.used}/${quota.limit} spent this ${quota.window}` };
  }
  if (quota && priority === "background" && quota.remaining <= quota.reserve) {
    return {
      state: "quota_reserved",
      detail: `${quota.remaining} left, all of it reserved for interactive lookups`,
    };
  }
  return {
    state: "ready",
    detail: breaker.state === "half_open"
      ? "cooldown elapsed — next call probes this provider"
      : "configured and routable",
  };
}

/** Health-probe verdicts keyed by provider id, for providers that have one. */
export type ReadinessOverlay = Record<string, { ready: boolean; statusDetail: string }>;

/** The ranked chain for one capability/asset pair, with live state on each node. */
export function failoverRoute(
  capability: Capability,
  asset: AssetClass,
  env: NodeJS.ProcessEnv = process.env,
  s: Store = store,
  priority: Priority = "interactive",
  readiness: ReadinessOverlay = {},
): FailoverRoute {
  const chain = candidatesFor(capability, asset);
  let activeProvider: string | null = null;

  const nodes: FailoverNode[] = chain.map((adapter, index) => {
    const { state, detail } = routeState(adapter, capability, env, s, priority);
    // First ready node in ranked order wins, exactly as the dispatch loop does.
    const active = state === "ready" && activeProvider === null;
    if (active) activeProvider = adapter.meta.id;
    const probe = readiness[adapter.meta.id];
    return {
      provider: adapter.meta.id,
      label: adapter.meta.label,
      rank: index + 1,
      state,
      detail,
      latency: latencyStats(adapter.meta.id),
      active,
      health: probe ? { ok: probe.ready, detail: probe.statusDetail } : null,
    };
  });

  return { capability, asset, nodes, activeProvider, cacheTtlMs: TTL_MS[capability] };
}

/**
 * Every capability/asset pair a façade can actually dispatch. The pairs come
 * from `ROUTE_MATRIX` in `./capabilities`, derived from the same table the
 * façades gate on — a routing diagram that shows a route the gate refuses is
 * the same defect as one that hides a route it admits.
 */
export function failoverGraph(
  env: NodeJS.ProcessEnv = process.env,
  s: Store = store,
  priority: Priority = "interactive",
  readiness: ReadinessOverlay = {},
): FailoverRoute[] {
  const routes: FailoverRoute[] = [];
  for (const { capability, assets } of ROUTE_MATRIX) {
    for (const asset of assets) {
      if (!candidatesFor(capability, asset).length) continue;
      routes.push(failoverRoute(capability, asset, env, s, priority, readiness));
    }
  }
  return routes;
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
