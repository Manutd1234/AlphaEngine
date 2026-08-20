/**
 * The one place reliability state and cached answers live together.
 *
 * `Store` is an interface with a single in-memory implementation precisely so
 * that swapping in Vercel KV or Redis is one new class and no changes anywhere
 * else. On Vercel this state is per *function instance*: two concurrent
 * instances keep two ledgers, so the quota count is a floor rather than an
 * exact figure and the breaker opens per instance. That is the correct trade
 * for a case study — no external dependency to stand up — but it is a real
 * limitation, and it is stated rather than hidden.
 *
 * The cache and the ledger share one Map on purpose, which is what makes
 * `evict()` below load-bearing rather than housekeeping.
 */

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
const PROTECTED_PREFIXES = ["quota:", "breaker:", "licence:"];

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
