/**
 * The part that makes seven flaky upstreams behave like one dependable one.
 * =========================================================================
 *
 * Writing seven `fetch` wrappers is an afternoon. Making them safe to put in
 * front of a trading desk is this file, and it is four mechanisms:
 *
 *   1. **Quota ledger.**   Alpha Vantage's free plan is 25 calls *per day* and
 *      Firecrawl's is 1,000 credits *per month*. Nothing about a naive
 *      integration warns you before you spend a day's allowance on a dashboard
 *      that auto-refreshes. Calls are counted before they are made, and
 *      background polling is fenced out of a reserve so a human lookup still
 *      works at 4pm.
 *
 *   2. **Circuit breaker.** A dead provider that times out costs every request
 *      its full timeout. After N consecutive failures the provider is skipped
 *      outright until a probe succeeds, so one broken vendor cannot add 8s to
 *      the latency of a route that has three working alternatives.
 *
 *   3. **Cache.**          A quota defence first and a latency optimisation
 *      second. TTL is per capability, because a fundamentals record is good for
 *      a day and a quote is good for seconds.
 *
 *   4. **Failover with provenance.** Try providers in ranked order; return the
 *      first success *along with the list of everything skipped and why*. A
 *      failover the user cannot see is a failover they will trust wrongly.
 *
 * ── An honest limitation ────────────────────────────────────────────────────
 * On Vercel this state lives in module scope, which is per *function instance*.
 * Two concurrent instances keep two ledgers, so the quota count is a floor, not
 * an exact figure, and the breaker opens per instance. That is the correct
 * trade for a case study — no external dependency to stand up — but it is a real
 * limitation and it is stated rather than hidden. `Store` is an interface with
 * one in-memory implementation precisely so that swapping in Vercel KV or Redis
 * is a single new class and no changes anywhere else.
 */

import {
  Adapter,
  Attempt,
  Capability,
  FetchCtx,
  Priority,
  ProviderError,
  Provenance,
  Sourced,
} from "./types";

// --------------------------------------------------------------------------
// Store
// --------------------------------------------------------------------------

export interface Store {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T, ttlMs?: number): void;
  incr(key: string, ttlMs: number): number;
  del(key: string): void;
}

interface Entry {
  value: unknown;
  expiresAt: number;
}

export class MemoryStore implements Store {
  private map = new Map<string, Entry>();
  /** Bound so a long-lived instance cannot grow unboundedly on varied symbols. */
  constructor(private maxEntries = 2_000) {}

  get<T>(key: string): T | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return e.value as T;
  }

  set<T>(key: string, value: T, ttlMs = 60_000): void {
    if (this.map.size >= this.maxEntries) {
      // Evict the oldest insertion. Map preserves insertion order, so the first
      // key is the least recently *written* — good enough here, and it avoids
      // carrying an LRU structure for a cache whose entries all expire anyway.
      const oldest = this.map.keys().next();
      if (!oldest.done) this.map.delete(oldest.value);
    }
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  incr(key: string, ttlMs: number): number {
    const current = this.get<number>(key) ?? 0;
    const next = current + 1;
    // Re-setting the TTL on every increment would slide the window forward
    // forever and the counter would never reset. Keep the original expiry.
    const existing = this.map.get(key);
    const expiresAt = existing && existing.expiresAt > Date.now()
      ? existing.expiresAt
      : Date.now() + ttlMs;
    this.map.set(key, { value: next, expiresAt });
    return next;
  }

  del(key: string): void {
    this.map.delete(key);
  }
}

export const store: Store = new MemoryStore();

// --------------------------------------------------------------------------
// Quota ledger
// --------------------------------------------------------------------------

const WINDOW_MS = { minute: 60_000, day: 86_400_000, month: 2_678_400_000 } as const;

/**
 * Label of the current window, used as the counter key.
 *
 * Deliberately calendar-aligned rather than rolling: vendors reset on calendar
 * boundaries, so a rolling window would let us believe we had budget on the 1st
 * that the vendor had already reset, and vice versa. Month uses UTC, whereas
 * most vendors reset on the account's signup anniversary — that makes our count
 * conservative near a boundary, which is the direction that fails safely.
 */
export function windowKey(window: "minute" | "day" | "month", now = Date.now()): string {
  const d = new Date(now);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  if (window === "month") return `${y}-${m}`;
  const day = String(d.getUTCDate()).padStart(2, "0");
  if (window === "day") return `${y}-${m}-${day}`;
  return `${y}-${m}-${day}T${String(d.getUTCHours()).padStart(2, "0")}:${String(
    d.getUTCMinutes(),
  ).padStart(2, "0")}`;
}

export interface QuotaState {
  used: number;
  limit: number;
  remaining: number;
  reserve: number;
  window: string;
}

export function quotaState(adapter: Adapter, s: Store = store): QuotaState | null {
  const q = adapter.meta.quota;
  if (!q) return null;
  const key = `quota:${adapter.meta.id}:${windowKey(q.window)}`;
  const used = s.get<number>(key) ?? 0;
  return {
    used,
    limit: q.calls,
    remaining: Math.max(0, q.calls - used),
    reserve: Math.ceil(q.calls * q.reserve),
    window: q.window,
  };
}

/** `null` when spending is allowed; otherwise the reason it is not. */
export function quotaBlock(
  adapter: Adapter,
  priority: Priority,
  s: Store = store,
): "quota_exhausted" | "quota_reserved" | null {
  const st = quotaState(adapter, s);
  if (!st) return null;
  if (st.remaining <= 0) return "quota_exhausted";
  // The reserve is the whole point: background polling stops early so that an
  // interactive lookup later in the window still has budget.
  if (priority === "background" && st.remaining <= st.reserve) return "quota_reserved";
  return null;
}

export function spendQuota(adapter: Adapter, s: Store = store): void {
  const q = adapter.meta.quota;
  if (!q) return;
  s.incr(`quota:${adapter.meta.id}:${windowKey(q.window)}`, WINDOW_MS[q.window]);
}

// --------------------------------------------------------------------------
// Circuit breaker
// --------------------------------------------------------------------------

const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 60_000;

interface BreakerState {
  failures: number;
  openedAt: number | null;
}

function breakerKey(id: string) {
  return `breaker:${id}`;
}

export function breakerOpen(id: string, s: Store = store): boolean {
  const st = s.get<BreakerState>(breakerKey(id));
  if (!st?.openedAt) return false;
  if (Date.now() - st.openedAt >= BREAKER_COOLDOWN_MS) {
    // Half-open: let exactly one request through to probe. Clearing the state
    // rather than tracking a separate half-open flag means a probe failure
    // re-counts from one — slower to re-open, but it cannot get stuck open.
    s.del(breakerKey(id));
    return false;
  }
  return true;
}

export function recordSuccess(id: string, s: Store = store): void {
  s.del(breakerKey(id));
}

export function recordFailure(id: string, s: Store = store): void {
  const st = s.get<BreakerState>(breakerKey(id)) ?? { failures: 0, openedAt: null };
  st.failures += 1;
  if (st.failures >= BREAKER_THRESHOLD) st.openedAt = Date.now();
  s.set(breakerKey(id), st, BREAKER_COOLDOWN_MS * 4);
}

// --------------------------------------------------------------------------
// HTTP
// --------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_ATTEMPTS = 3;

/** Statuses where trying again can plausibly change the answer. */
function isRetryable(status: number): boolean {
  // 401/403 are credential problems and 404 is a bad symbol: retrying those
  // burns quota to receive the identical error. 429 is retryable only because
  // we back off — see the delay below.
  return status === 429 || status === 408 || (status >= 500 && status < 600);
}

function backoffMs(attempt: number): number {
  // Full jitter. Several providers share an upstream CDN; synchronised retries
  // from a fan-out would arrive as a burst and re-trigger the same 429.
  const ceiling = Math.min(2_000, 250 * 2 ** attempt);
  return Math.random() * ceiling;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One HTTP call with timeout, bounded retry and error normalisation.
 *
 * Returns parsed JSON. Non-JSON bodies are an error rather than a silent
 * `undefined`: several of these vendors answer an auth failure with an HTML
 * error page and HTTP 200, and `res.json()` on that throws a SyntaxError whose
 * message ("Unexpected token '<'") tells an operator nothing.
 */
export async function httpJson(
  provider: string,
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  let last: ProviderError | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(backoffMs(attempt));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: { accept: "application/json", ...(init.headers ?? {}) },
        cache: "no-store",
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        last = new ProviderError(
          provider,
          `HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
          res.status,
          isRetryable(res.status),
        );
        if (!last.retryable) throw last;
        continue;
      }

      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        throw new ProviderError(
          provider,
          `expected JSON, got ${text.slice(0, 120)}`,
          res.status,
          false,
        );
      }
    } catch (err) {
      if (err instanceof ProviderError) {
        if (!err.retryable) throw err;
        last = err;
        continue;
      }
      // AbortError and network failures: both worth one more try.
      const msg = err instanceof Error ? err.message : String(err);
      const timedOut = err instanceof Error && err.name === "AbortError";
      last = new ProviderError(
        provider,
        timedOut ? `timed out after ${timeoutMs}ms` : msg,
        null,
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  throw last ?? new ProviderError(provider, "request failed");
}

// --------------------------------------------------------------------------
// Dispatch
// --------------------------------------------------------------------------

/** Cache lifetimes, chosen by how fast the underlying fact changes. */
export const TTL_MS: Record<Capability, number> = {
  quote: 15_000,
  bars: 300_000,
  news: 180_000,
  fundamentals: 86_400_000,
  search: 900_000,
  scrape: 3_600_000,
};

export function isConfigured(adapter: Adapter, env: NodeJS.ProcessEnv = process.env): boolean {
  // An empty `keyEnv` declares a keyless public API (Binance). Without this the
  // whole registry would be unusable on a fresh clone with no secrets set, and
  // "works after you obtain seven API keys" is not a working system.
  if (!adapter.meta.keyEnv) return true;
  return Boolean(env[adapter.meta.keyEnv]?.trim());
}

function ctxFor(adapter: Adapter, env: NodeJS.ProcessEnv): FetchCtx {
  const { id, keyEnv, baseUrlEnv } = adapter.meta;
  return {
    key: env[keyEnv]?.trim() ?? "",
    baseUrl: (baseUrlEnv ? env[baseUrlEnv]?.trim() : "") || DEFAULT_BASE_URL[id] || "",
    json: (url, init) => httpJson(id, url, init),
  };
}

/** Falls back to the vendor's documented host when no override is set. */
export const DEFAULT_BASE_URL: Record<string, string> = {
  alphavantage: "https://www.alphavantage.co",
  tiingo: "https://api.tiingo.com",
  // Polygon.io became Massive in Oct 2025; api.polygon.io still resolves, but
  // the new host is the one under active development.
  massive: "https://api.massive.com",
  fmp: "https://financialmodelingprep.com",
  firecrawl: "https://api.firecrawl.dev",
  // OpenBB is a Python library, not a hosted API. This points at whichever
  // process is running it — the AlphaEngine gateway by default.
  openbb: "http://127.0.0.1:8000",
};

export interface DispatchOptions {
  capability: Capability;
  cacheKey: string;
  priority?: Priority;
  /** Explicit provider id, e.g. `?provider=tiingo`. Skips ranked selection. */
  pin?: string | null;
  env?: NodeJS.ProcessEnv;
  store?: Store;
}

/**
 * Try candidates in order; return the first success with full provenance.
 *
 * `candidates` arrives pre-ranked and pre-filtered for asset class by the
 * registry. Everything this function adds is the reliability policy: cache,
 * breaker, quota, and the record of what it skipped.
 */
export async function dispatch<T>(
  candidates: Adapter[],
  run: (adapter: Adapter, ctx: FetchCtx) => Promise<T>,
  opts: DispatchOptions,
): Promise<Sourced<T>> {
  const env = opts.env ?? process.env;
  const s = opts.store ?? store;
  const priority = opts.priority ?? "interactive";
  const attempts: Attempt[] = [];

  const cached = s.get<Sourced<T>>(opts.cacheKey);
  if (cached) {
    return { ...cached, provenance: { ...cached.provenance, cached: true } };
  }

  const pool = opts.pin ? candidates.filter((a) => a.meta.id === opts.pin) : candidates;

  for (const adapter of pool) {
    const { id } = adapter.meta;

    if (!isConfigured(adapter, env)) {
      attempts.push({ provider: id, reason: "not_configured", detail: adapter.meta.keyEnv });
      continue;
    }
    if (breakerOpen(id, s)) {
      attempts.push({ provider: id, reason: "circuit_open", detail: "recent consecutive failures" });
      continue;
    }
    const blocked = quotaBlock(adapter, priority, s);
    if (blocked) {
      const st = quotaState(adapter, s)!;
      attempts.push({
        provider: id,
        reason: blocked,
        detail: `${st.used}/${st.limit} used this ${st.window}`,
      });
      continue;
    }

    const startedAt = Date.now();
    // Counted before the call, not after: a request that times out still hit the
    // vendor's meter. Counting on success only under-counts exactly when we are
    // failing most, which is when the count matters.
    spendQuota(adapter, s);

    try {
      const data = await run(adapter, ctxFor(adapter, env));
      recordSuccess(id, s);

      const q = quotaState(adapter, s);
      const provenance: Provenance = {
        provider: id,
        label: adapter.meta.label,
        fetchedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        cached: false,
        delayed: DELAYED_TIERS.has(id),
        quotaRemaining: q?.remaining ?? null,
        quotaWindow: q?.window ?? null,
      };
      const out: Sourced<T> = { data, provenance, attempts };
      s.set(opts.cacheKey, out, TTL_MS[opts.capability]);
      return out;
    } catch (err) {
      recordFailure(id, s);
      attempts.push({
        provider: id,
        reason: "failed",
        detail: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
    }
  }

  const err = new ProviderError(
    "registry",
    `no provider could serve ${opts.capability}`,
    503,
    false,
  );
  (err as ProviderError & { attempts: Attempt[] }).attempts = attempts;
  throw err;
}

/** Tiers we know serve delayed or end-of-day data, flagged on every response. */
const DELAYED_TIERS = new Set(["alphavantage", "massive"]);
