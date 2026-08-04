/**
 * Provider contracts — one shape per question, not one shape per vendor.
 * =====================================================================
 *
 * Seven upstreams answer overlapping questions in seven different JSON shapes,
 * with seven different auth schemes, seven quota regimes and seven ways of
 * failing. The point of this file is that **nothing downstream of it knows that**.
 * A route asks for a quote; it gets a `Quote`. Which vendor answered, how long it
 * took and how much of that vendor's monthly allowance is left are attached as
 * provenance rather than folded into the data.
 *
 * The normalised types are deliberately narrow. Every provider returns far more
 * fields than these; widening the interface to the union of all of them would
 * push the vendor differences right back into the callers, which is the thing we
 * are trying to avoid. If a field is not available from at least two providers it
 * does not belong here — it belongs in `raw`.
 */

/** What a provider can answer. Routing is by capability, never by vendor name. */
export type Capability =
  | "quote"        // last price + session stats for a symbol
  | "bars"         // OHLCV history
  | "news"         // headlines, optionally with sentiment
  | "fundamentals" // company profile, valuation, financial statements
  | "search"       // open-web search returning readable documents
  | "scrape";      // fetch one URL as clean text

export type AssetClass = "equity" | "crypto" | "fx";

/**
 * How urgent the caller is — the input to quota rationing.
 *
 * With Alpha Vantage's free plan at 25 calls **per day**, a 60-second dashboard
 * poll exhausts the entire day in half an hour and the desk then has no data
 * on the afternoon it actually matters. So background refreshes and human-driven
 * lookups are not the same request even when they hit the same endpoint:
 * `background` may only spend down to the reserve, `interactive` may spend it.
 */
export type Priority = "interactive" | "background";

export interface QuotaPolicy {
  /** Calls permitted per window on the tier we assume (documented free tier). */
  calls: number;
  window: "minute" | "day" | "month";
  /**
   * Fraction of the allowance withheld from `background` callers.
   *
   * Not a safety margin against miscounting — a deliberate split, so that
   * automated polling cannot consume the budget a person needs later.
   */
  reserve: number;
}

export interface ProviderMeta {
  id: string;
  label: string;
  docs: string;
  capabilities: Capability[];
  assets: AssetClass[];
  /** Env var holding the credential. Absent from the environment ⇒ not configured. */
  keyEnv: string;
  /** Optional env var overriding the base URL (self-hosted OpenBB, Massive's legacy polygon.io host). */
  baseUrlEnv?: string;
  quota: QuotaPolicy | null;
  /**
   * Preference order per capability, lower first.
   *
   * Ranked by *fitness for the question*, not by vendor quality: Massive is
   * ranked first for equity bars because it serves real intraday aggregates,
   * while Alpha Vantage is ranked last everywhere because 25 calls/day makes it
   * a fallback by arithmetic regardless of how good the data is.
   */
  rank: Partial<Record<Capability, number>>;
  /** One line the UI shows when the provider is unconfigured. */
  signup: string;
}

// --------------------------------------------------------------------------
// Normalised payloads
// --------------------------------------------------------------------------

export interface Quote {
  symbol: string;
  /** Last traded price, or the mid where the provider only serves quotes. */
  price: number;
  change: number | null;
  changePct: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  prevClose: number | null;
  volume: number | null;
  currency: string;
  /**
   * When the *market data* was stamped — not when we fetched it.
   *
   * These differ by up to 15 minutes on delayed feeds and by three days on a
   * weekend EOD close. Collapsing the two is how a stale print gets treated as
   * live, so they stay separate all the way to the UI.
   */
  asOf: string;
  /** True when the provider's tier is known to serve delayed or EOD-only data. */
  delayed: boolean;
}

export interface OhlcvBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  summary: string | null;
  tickers: string[];
  /** Only Alpha Vantage scores sentiment; null everywhere else rather than 0. */
  sentiment: number | null;
}

export interface Fundamentals {
  symbol: string;
  name: string | null;
  exchange: string | null;
  sector: string | null;
  industry: string | null;
  currency: string | null;
  marketCap: number | null;
  peRatio: number | null;
  eps: number | null;
  beta: number | null;
  dividendYield: number | null;
  sharesOutstanding: number | null;
  description: string | null;
}

export interface Document {
  url: string;
  title: string | null;
  /** Readable text — markdown where the provider produces it. */
  content: string;
  /** Characters, so the UI can show cost/size without re-measuring. */
  length: number;
  publishedAt: string | null;
}

// --------------------------------------------------------------------------
// Envelope
// --------------------------------------------------------------------------

export interface Provenance {
  provider: string;
  label: string;
  fetchedAt: string;
  latencyMs: number;
  cached: boolean;
  delayed: boolean;
  /** null when the provider publishes no quota we can account for. */
  quotaRemaining: number | null;
  quotaWindow: string | null;
}

/** Why a provider that *could* have answered was not asked. */
export type SkipReason =
  | "not_configured"
  | "no_capability"
  | "asset_unsupported"
  | "circuit_open"
  | "quota_exhausted"
  | "quota_reserved"
  /**
   * An operator knocked this provider out from the systems console to watch
   * failover happen. Distinct from every other reason on purpose: a fault
   * someone caused deliberately must never be mistaken for one they did not.
   */
  | "simulated_outage"
  | "failed";

export interface Attempt {
  provider: string;
  reason: SkipReason;
  detail?: string;
}

export interface Sourced<T> {
  data: T;
  provenance: Provenance;
  /**
   * Every provider we did not use, and why.
   *
   * A failover that silently succeeds is indistinguishable from a primary that
   * never broke. Surfacing the skipped list is what makes a degraded answer
   * visibly degraded — the UI can say "Massive is rate-limited, this came from
   * Tiingo" instead of quietly changing feed under the user.
   */
  attempts: Attempt[];
}

/** Thrown by adapters; carries whether a retry could plausibly help. */
export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly status: number | null = null,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/**
 * The adapter surface. Every method is optional — capability is declared in
 * `meta.capabilities` and checked before dispatch, so an adapter implements only
 * what its vendor actually serves.
 */
export interface Adapter {
  meta: ProviderMeta;
  quote?(symbol: string, asset: AssetClass, ctx: FetchCtx): Promise<Quote>;
  bars?(symbol: string, asset: AssetClass, interval: string, limit: number, ctx: FetchCtx): Promise<OhlcvBar[]>;
  news?(symbols: string[], limit: number, ctx: FetchCtx): Promise<NewsItem[]>;
  fundamentals?(symbol: string, ctx: FetchCtx): Promise<Fundamentals>;
  search?(query: string, limit: number, ctx: FetchCtx): Promise<Document[]>;
  scrape?(url: string, ctx: FetchCtx): Promise<Document>;
}

export interface FetchCtx {
  key: string;
  baseUrl: string;
  /**
   * Pre-bound fetch returning parsed JSON, with timeout, bounded retry and
   * error normalisation already applied. Takes a `RequestInit`, so adapters
   * that need POST (Firecrawl) use the same path as the GET ones.
   */
  json(url: string, init?: RequestInit): Promise<unknown>;
}
