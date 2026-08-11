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
  emit,
  outageFor,
  recordCacheLookup,
  recordLatency,
  recordQuotaReset,
  recordQuotaSpend,
  recordUpstream,
  redact,
} from "../observability";
// Side-effecting import: installs the AsyncLocalStorage-backed capture resolver
// that `recordUpstream` consults. Server-only, and this module is server-only.
import {
  type ContractResult,
  summariseContract,
  validationTelemetry,
} from "./contracts";
import { quarantinePayload } from "./quarantine";
import "./trace";
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
  /**
   * Milliseconds until `key` expires; `null` when it is absent or already dead.
   *
   * The inspector shows "TTL remaining 4.2s" against a cache hit, which is the
   * difference between "this number is one second old" and "this number is
   * about to be refetched" — and neither is derivable from the value alone.
   */
  ttl(key: string): number | null;
  /** Live (unexpired) keys, optionally filtered by prefix. */
  keys(prefix?: string): string[];
  /** Delete every live key matching `prefix`; returns how many were removed. */
  purge(prefix?: string): number;
}

interface Entry {
  value: unknown;
  expiresAt: number;
}

/**
 * Key namespaces holding reliability state rather than cached answers.
 *
 * Never evicted to make room for a cache entry, and never removed by a purge.
 * Losing a cached quote costs one upstream call; losing the quota ledger costs
 * a vendor's daily allowance.
 */
const PROTECTED_PREFIXES = ["quota:", "breaker:"];

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

  ttl(key: string): number | null {
    const e = this.map.get(key);
    if (!e) return null;
    const remaining = e.expiresAt - Date.now();
    if (remaining <= 0) {
      this.map.delete(key);
      return null;
    }
    return remaining;
  }

  keys(prefix?: string): string[] {
    const now = Date.now();
    const out: string[] = [];
    for (const [key, entry] of this.map) {
      if (entry.expiresAt <= now) continue;
      if (prefix && !key.startsWith(prefix)) continue;
      out.push(key);
    }
    return out;
  }

  purge(prefix?: string): number {
    // Snapshot first: deleting while iterating a Map is defined behaviour, but
    // the live-key filter already walks the map and reusing it keeps the two
    // notions of "live" from drifting apart.
    const doomed = this.keys(prefix);
    for (const key of doomed) this.map.delete(key);
    return doomed.length;
  }

  set<T>(key: string, value: T, ttlMs = 60_000): void {
    if (this.map.size >= this.maxEntries) this.evict();
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  /**
   * Free a slot without destroying the reliability state.
   *
   * The naive version — delete the oldest insertion — has a nasty failure mode
   * in this store, because the cache and the *ledger* share one Map. `incr()`
   * re-setting an existing key does not move it in Map insertion order, so a
   * window's quota counter is written once on the first spend and then sits
   * permanently at the front, first in line to be thrown away. Enough distinct
   * cache keys (`search:{query}` and `scrape:{url}` are caller-supplied, so
   * 2,000 of them is reachable) and the instance forgets it has spent Alpha
   * Vantage's day, stops fencing background traffic, and re-spends the
   * allowance while the console cheerfully reports 0/25 used.
   *
   * So: expired entries are reclaimed first — `purge()` and `keys()` skip dead
   * keys without deleting them, so they otherwise hold the budget forever — and
   * the ledger namespaces are never evictable. Those are bounded by the provider
   * count, so exempting them cannot make the store grow without limit.
   */
  private evict(): void {
    const now = Date.now();
    let reclaimed = false;
    for (const [key, entry] of this.map) {
      if (entry.expiresAt <= now) {
        this.map.delete(key);
        reclaimed = true;
      }
    }
    if (reclaimed) return;

    for (const key of this.map.keys()) {
      if (!PROTECTED_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        this.map.delete(key);
        return;
      }
    }
    // Nothing evictable: every live entry is reliability state. Exceeding the
    // bound is the correct outcome — dropping the ledger to honour a cache
    // limit would trade a memory guarantee for a spending one.
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
  const window = windowKey(q.window);
  s.incr(`quota:${adapter.meta.id}:${window}`, WINDOW_MS[q.window]);
  // Queue the delta for the gateway's shared ledger so other instances stop
  // believing they have budget this instance already spent.
  recordQuotaSpend(adapter.meta.id, window);
}

/**
 * Zero this instance's counter for a provider's current window.
 *
 * Worth being blunt about what this does and does not do: it resets **our
 * ledger**, not the vendor's meter. Alpha Vantage still believes it has served
 * 25 calls today. The reason it exists at all is that the ledger is a *floor*
 * derived from one instance's memory, so after a deploy or an instance swap it
 * can be badly pessimistic and block a provider that has budget left. Anyone
 * pressing this needs to know they may be about to spend a real allowance.
 */
export function resetQuota(adapter: Adapter, s: Store = store): number {
  const q = adapter.meta.quota;
  if (!q) return 0;
  const window = windowKey(q.window);
  const key = `quota:${adapter.meta.id}:${window}`;
  const used = s.get<number>(key) ?? 0;
  s.del(key);
  // Without this the next sync would hydrate the shared total straight back.
  recordQuotaReset(adapter.meta.id, window);
  return used;
}

/**
 * Install the gateway-merged spend totals as this instance's counters.
 *
 * The shared total *replaces* the local count rather than taking the max: the
 * total already contains everything this instance pushed, and replacement is
 * what lets an operator's quota reset propagate instead of every instance
 * re-asserting its stale high-water mark. Spends made between push and
 * response are under-counted until the next sync — convergence, not a race
 * worth a lock. The window's expiry is preserved so hydration never slides a
 * calendar window forward.
 */
export function hydrateQuotaLedger(
  entries: Array<{ provider: string; window: string; spent: number }>,
  s: Store = store,
): void {
  for (const { provider, window, spent } of entries.slice(0, 64)) {
    const key = `quota:${provider}:${window}`;
    if (spent <= 0) {
      s.del(key);
      continue;
    }
    const remaining = s.ttl(key);
    s.set(key, spent, remaining ?? fallbackWindowTtl(window));
  }
}

/** Infer a conservative TTL from the calendar label's own shape. */
function fallbackWindowTtl(window: string): number {
  if (window.includes("T")) return WINDOW_MS.minute;
  if (window.length === 7) return WINDOW_MS.month;
  return WINDOW_MS.day;
}

// --------------------------------------------------------------------------
// Circuit breaker
// --------------------------------------------------------------------------

export const BREAKER_THRESHOLD = 3;
export const BREAKER_COOLDOWN_MS = 60_000;

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
    emit({
      level: "info",
      source: "Breaker",
      message: `${id} cooldown elapsed — half-open, next call probes`,
      fields: { provider: id, state: "half_open" },
    });
    return false;
  }
  return true;
}

/**
 * The breaker as an operator reads it, rather than as dispatch consumes it.
 *
 * `breakerOpen` answers one boolean and, as a side effect, retires an expired
 * breaker. The console needs the shape *behind* that boolean — how many
 * consecutive failures have accrued, how long until the cooldown lets a probe
 * through — and it must be able to ask without mutating anything, because a
 * status panel that silently resets breakers by rendering is not a status panel.
 */
export interface BreakerSnapshot {
  state: "closed" | "open" | "half_open";
  failures: number;
  threshold: number;
  openedAt: number | null;
  /** Milliseconds until a probe is allowed; 0 when one already is. */
  cooldownRemainingMs: number;
}

export function breakerSnapshot(id: string, s: Store = store, now = Date.now()): BreakerSnapshot {
  const st = s.get<BreakerState>(breakerKey(id));
  const failures = st?.failures ?? 0;
  if (!st?.openedAt) {
    return { state: "closed", failures, threshold: BREAKER_THRESHOLD, openedAt: null, cooldownRemainingMs: 0 };
  }
  const remaining = BREAKER_COOLDOWN_MS - (now - st.openedAt);
  return remaining > 0
    ? {
        state: "open",
        failures,
        threshold: BREAKER_THRESHOLD,
        openedAt: st.openedAt,
        cooldownRemainingMs: remaining,
      }
    : {
        state: "half_open",
        failures,
        threshold: BREAKER_THRESHOLD,
        openedAt: st.openedAt,
        cooldownRemainingMs: 0,
      };
}

export function recordSuccess(id: string, s: Store = store): void {
  const had = s.get<BreakerState>(breakerKey(id));
  s.del(breakerKey(id));
  if (had?.openedAt) {
    emit({
      level: "info",
      source: "Breaker",
      message: `${id} probe succeeded — circuit closed`,
      fields: { provider: id, state: "closed" },
    });
  }
}

export function recordFailure(id: string, s: Store = store): void {
  const st = s.get<BreakerState>(breakerKey(id)) ?? { failures: 0, openedAt: null };
  const wasOpen = st.openedAt !== null;
  st.failures += 1;
  if (st.failures >= BREAKER_THRESHOLD) st.openedAt = Date.now();
  s.set(breakerKey(id), st, BREAKER_COOLDOWN_MS * 4);
  if (st.openedAt && !wasOpen) {
    emit({
      level: "error",
      source: "Breaker",
      message: `${id} tripped after ${st.failures} consecutive failures — skipping for ${BREAKER_COOLDOWN_MS / 1000}s`,
      fields: { provider: id, state: "open", failures: st.failures },
    });
  }
}

/** Operator reset. Returns whether a breaker was actually holding the provider out. */
export function resetBreaker(id: string, s: Store = store): boolean {
  const had = s.get<BreakerState>(breakerKey(id));
  s.del(breakerKey(id));
  return Boolean(had?.openedAt);
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
  // OpenBB already enforces its own seven-second worker bound. Retrying the
  // gateway request here would leave multiple non-cancellable Python provider
  // threads running after the caller has moved on, so it gets one bounded
  // attempt and normal registry failover handles the next source.
  const maxAttempts = provider === "openbb" ? 1 : MAX_ATTEMPTS;
  const effectiveTimeoutMs = provider === "openbb" ? Math.min(timeoutMs, 7_500) : timeoutMs;
  const method = (init.method ?? "GET").toUpperCase();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await sleep(backoffMs(attempt));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs);
    const startedAt = Date.now();
    // Every attempt reports exactly once. A retried request is three upstream
    // calls and the inspector shows three, because "it worked" and "it worked on
    // the third try" are different facts about a provider — and the second one
    // is invisible in a per-request latency figure that only counts the winner.
    let reported = false;
    const report = (
      ok: boolean,
      status: number | null,
      extra: { error?: string; payload?: unknown } = {},
    ) => {
      reported = true;
      recordUpstream({ provider, method, url, status, ms: Date.now() - startedAt, ok, ...extra });
    };

    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: { accept: "application/json", ...(init.headers ?? {}) },
        cache: "no-store",
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        report(false, res.status, { error: `HTTP ${res.status}` });
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
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        report(false, res.status, { error: "expected JSON, got a non-JSON body" });
        throw new ProviderError(
          provider,
          `expected JSON, got ${text.slice(0, 120)}`,
          res.status,
          false,
        );
      }
      // Reporting sits outside the parse guard on purpose: a fault in the
      // telemetry path must not be caught and re-labelled as a malformed vendor
      // response, which is exactly the misdiagnosis this console exists to end.
      report(true, res.status, { payload: parsed });
      return parsed;
    } catch (err) {
      if (err instanceof ProviderError) {
        if (!err.retryable) throw err;
        last = err;
        continue;
      }
      // AbortError and network failures: both worth one more try.
      const msg = err instanceof Error ? err.message : String(err);
      const timedOut = err instanceof Error && err.name === "AbortError";
      if (!reported) {
        report(false, null, { error: timedOut ? `timed out after ${effectiveTimeoutMs}ms` : msg });
      }
      last = new ProviderError(
        provider,
        timedOut ? `timed out after ${effectiveTimeoutMs}ms` : msg,
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
  // OpenBB is a Python provider runtime, not a shared public API. This points
  // at the independently deployed, stateless OpenBB_Service.
  openbb: "http://127.0.0.1:8010",
};

export interface DispatchOptions<T = unknown> {
  capability: Capability;
  cacheKey: string;
  priority?: Priority;
  /** Explicit provider id, e.g. `?provider=tiingo`. Skips ranked selection. */
  pin?: string | null;
  env?: NodeJS.ProcessEnv;
  store?: Store;
  /**
   * Expectations the normalised payload must meet before it is believed.
   *
   * Supplied by the capability façade, which is the only layer that knows the
   * shape. A `fatal` violation is treated exactly like a thrown error — the
   * provider is failed and the chain moves on — because a payload that is
   * internally impossible is not a better answer than no answer. Warnings and
   * drift travel with the provenance instead, so a stale-but-usable price is
   * shown *and* labelled rather than silently dropped.
   */
  contract?: (data: T, provider: string) => ContractResult;
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
  opts: DispatchOptions<T>,
): Promise<Sourced<T>> {
  const env = opts.env ?? process.env;
  const s = opts.store ?? store;
  const priority = opts.priority ?? "interactive";
  const attempts: Attempt[] = [];

  const cached = s.get<Sourced<T>>(opts.cacheKey);
  recordCacheLookup(opts.capability, Boolean(cached));
  if (cached) {
    emit({
      level: "debug",
      source: "Cache",
      message: `hit ${opts.cacheKey} (served by ${cached.provenance.provider})`,
      fields: {
        capability: opts.capability,
        key: opts.cacheKey,
        provider: cached.provenance.provider,
        ttlRemainingMs: s.ttl(opts.cacheKey),
      },
    });
    return { ...cached, provenance: { ...cached.provenance, cached: true } };
  }

  const pool = opts.pin ? candidates.filter((a) => a.meta.id === opts.pin) : candidates;

  for (const adapter of pool) {
    const { id } = adapter.meta;

    // Operator-simulated outages are checked first so the reason shown is the
    // one the operator caused. A provider knocked out on purpose reporting
    // "quota spent" would send someone reading the failover graph after a
    // problem that does not exist.
    const outage = outageFor(id);
    if (outage) {
      attempts.push({
        provider: id,
        reason: "simulated_outage",
        detail: `${outage.note}; restores in ${Math.ceil((outage.expiresAt - Date.now()) / 1000)}s`,
      });
      continue;
    }
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
    emitQuotaThreshold(adapter, s);

    try {
      const data = await run(adapter, ctxFor(adapter, env));
      const latencyMs = Date.now() - startedAt;

      // Expectations run after normalisation and before anything is recorded,
      // cached or returned. Order matters: `recordSuccess` *deletes* the
      // breaker's failure count, so evaluating the contract afterwards would
      // clear the counter on every broken response and the breaker could never
      // reach its threshold — a vendor emitting duplicated bar timestamps would
      // be retried forever, burning quota, while the health matrix showed a 0%
      // error rate. The check itself must never be the reason a request dies,
      // so a throwing contract is ignored rather than propagated.
      let contract: ContractResult | undefined;
      if (opts.contract) {
        try {
          const evaluated = opts.contract(data, id);
          // Dispatch owns the provider identity. Normalise it here even when a
          // legacy/custom callback returns a stale label such as "registry", so
          // quarantine and telemetry can never blame the façade for an
          // adapter's payload.
          contract = {
            ...evaluated,
            capability: opts.capability,
            provider: id,
          };
        } catch {
          contract = undefined;
        }
      }
      if (contract) {
        // Telemetry must never weaken the gate. If evidence collection itself
        // ever fails, preserve the evaluated contract so fatal data still
        // fails over and warnings still travel with provenance.
        try {
          validationTelemetry.record(contract);
        } catch {
          // Best-effort, per-instance observability only.
        }
      }
      const contractFailed = Boolean(contract && !contract.passed);

      // One sample per *dispatch*, not per HTTP hop, so the health matrix's p50
      // answers "what did the registry pay for an answer from this provider".
      // A contract failure counts as a failed sample: an answer that cannot be
      // used is not a success however fast it arrived.
      recordLatency(id, latencyMs, !contractFailed);
      if (!contractFailed) recordSuccess(id, s);

      if (contract && contract.violations.length) {
        quarantinePayload(contract, opts.cacheKey, data, redact);
        emit({
          level: contract.passed ? "warn" : "error",
          source: "Contract",
          message: `${opts.capability} from ${id}: ${summariseContract(contract)}`,
          fields: {
            capability: opts.capability,
            provider: id,
            checks: contract.violations.map((v) => v.check).join(","),
            rejected: !contract.passed,
          },
        });
      }

      if (contractFailed) {
        // Failed like any other bad answer, so the breaker and the failover
        // chain treat a provider that returns broken data exactly as they
        // treat one that returns nothing.
        recordFailure(id, s);
        attempts.push({
          provider: id,
          reason: "failed",
          detail: `contract: ${(contract?.violations ?? []).filter((v) => v.severity === "fatal")
            .map((v) => v.check).join(", ")}`,
        });
        continue;
      }

      const q = quotaState(adapter, s);
      const provenance: Provenance = {
        provider: id,
        label: adapter.meta.label,
        fetchedAt: new Date().toISOString(),
        latencyMs,
        cached: false,
        delayed: DELAYED_TIERS.has(id),
        quotaRemaining: q?.remaining ?? null,
        quotaWindow: q?.window ?? null,
        ...(contract
          ? { contract: {
              passed: contract.passed,
              violations: contract.violations,
              notEvaluated: contract.notEvaluated,
            } }
          : {}),
      };
      const out: Sourced<T> = { data, provenance, attempts };
      s.set(opts.cacheKey, out, TTL_MS[opts.capability]);
      emit({
        level: attempts.length ? "warn" : "info",
        source: "Dispatch",
        message: attempts.length
          ? `${opts.capability} served by ${id} in ${latencyMs}ms after ${attempts.length} skipped`
          : `${opts.capability} served by ${id} in ${latencyMs}ms`,
        fields: {
          capability: opts.capability,
          provider: id,
          ms: latencyMs,
          key: opts.cacheKey,
          skipped: attempts.map((a) => `${a.provider}:${a.reason}`).join(",") || null,
        },
      });
      return out;
    } catch (err) {
      recordLatency(id, Date.now() - startedAt, false);
      recordFailure(id, s);
      attempts.push({
        provider: id,
        reason: "failed",
        // Redacted before it is stored, not before it is rendered. Alpha Vantage
        // and FMP carry the key in the query string, and both answer an auth
        // failure with an HTML page that echoes the request URL — which
        // `httpJson` then quotes into this message. Without this, a 401 puts a
        // live credential into the attempts list of a public API response.
        detail: redact(err instanceof Error ? err.message : String(err)).slice(0, 200),
      });
    }
  }

  emit({
    level: "error",
    source: "Dispatch",
    message: `no provider could serve ${opts.capability}`,
    fields: {
      capability: opts.capability,
      key: opts.cacheKey,
      skipped: attempts.map((a) => `${a.provider}:${a.reason}`).join(",") || null,
    },
  });
  const err = new ProviderError(
    "registry",
    `no provider could serve ${opts.capability}`,
    503,
    false,
  );
  (err as ProviderError & { attempts: Attempt[] }).attempts = attempts;
  throw err;
}

/** Consumption levels worth one line in the log, once each, on the way past. */
const QUOTA_THRESHOLDS = [0.5, 0.8, 0.95] as const;

/**
 * Warn on the call that *crosses* a consumption threshold, not on every call
 * above it.
 *
 * A log that repeats "Alpha Vantage above 80%" twenty times is a log nobody
 * reads. Comparing the count before and after this spend fires each line exactly
 * once per window, which is what makes the warning worth acting on.
 */
function emitQuotaThreshold(adapter: Adapter, s: Store): void {
  const st = quotaState(adapter, s);
  if (!st || st.limit <= 0) return;
  const before = st.used - 1;
  for (const threshold of QUOTA_THRESHOLDS) {
    const mark = Math.ceil(st.limit * threshold);
    if (before < mark && st.used >= mark) {
      emit({
        level: threshold >= 0.95 ? "error" : "warn",
        source: "Quota",
        message: `${adapter.meta.id} at ${Math.round((st.used / st.limit) * 100)}% of its ${st.window} allowance (${st.used}/${st.limit})`,
        fields: {
          provider: adapter.meta.id,
          used: st.used,
          limit: st.limit,
          window: st.window,
          reserve: st.reserve,
        },
      });
      return;
    }
  }
}

/** Tiers we know serve delayed or end-of-day data, flagged on every response. */
const DELAYED_TIERS = new Set(["alphavantage", "massive"]);
