/**
 * The telemetry kernel — what the systems console is actually looking at.
 * ======================================================================
 *
 * The provider layer already *decides* well: it ranks, fails over, breaks
 * circuits and rations quota. What it could not do until this file existed is
 * *account* for any of that after the fact. "Which provider answered?" was
 * answerable for the request in front of you and for no other, because the
 * provenance envelope is per-response and nothing kept it.
 *
 * So this module keeps four things, all bounded, all in memory:
 *
 *   1. **A structured event ring.** Every dispatch decision — cache hit, skip,
 *      success, failure, breaker transition, quota threshold, operator action —
 *      lands here as a typed record with a monotonic sequence number. A console
 *      polls `?since=<seq>` and gets exactly what it has not seen. Sequence
 *      numbers rather than timestamps because two events inside the same
 *      millisecond are common and a timestamp cursor drops one of them.
 *
 *   2. **Latency samples per provider.** A ring of the last N calls, from which
 *      p50/p95/p99 are computed on read. Percentiles over a bounded recent
 *      window, not since-boot averages: a provider that was slow an hour ago and
 *      is fine now should stop being reported as slow.
 *
 *   3. **Cache hit/miss counters.** Per capability and global. The hit rate is
 *      the single number that says whether the quota ledger is under real
 *      pressure or whether the cache is absorbing it.
 *
 *   4. **Simulated outages.** An operator-set, self-expiring block list. This is
 *      the only piece here that *changes* behaviour rather than observing it,
 *      and it exists because "does failover actually work" should be answerable
 *      by pressing a button, not by waiting for a vendor to have a bad day.
 *
 * ── Isomorphic on purpose ───────────────────────────────────────────────────
 * No Node imports, no DOM. The server instance keeps its ring and the browser
 * keeps its own, and the console merges the two timelines by timestamp with an
 * `origin` tag on every line. A WebSocket frame that never touched the server is
 * a real event in the data path and belongs on the same screen as a server-side
 * failover — but it must never be presented as though the server saw it.
 *
 * ── The honest limitation, and its repair ───────────────────────────────────
 * The stores here are per *function instance*: two concurrent Vercel instances
 * keep two ledgers. The repair is the gateway-backed sync at the bottom of this
 * file — each instance pushes its deltas to the gateway's shared web-ops ledger
 * and hydrates the merged view back, so latency percentiles, simulated outages
 * and quota counters converge across instances within one sync. When the
 * gateway is unreachable the overlay goes stale and every read falls back to
 * the local per-instance truth, disclosed via `instance.scope` in the payload.
 * The event ring stays deliberately per-instance (the events route reports
 * whose ring you are reading).
 */

// --------------------------------------------------------------------------
// Instance identity
// --------------------------------------------------------------------------

/**
 * Random per-process id, shown in every telemetry payload.
 *
 * Deliberately not derived from a Vercel env var: those identify a *deployment*,
 * and the thing a reader needs to distinguish is two live instances of the same
 * deployment holding two different ledgers.
 */
export const instanceId: string = Math.random().toString(36).slice(2, 10);

export const startedAt: number = Date.now();

// --------------------------------------------------------------------------
// Event ring
// --------------------------------------------------------------------------

export type EventLevel = "debug" | "info" | "warn" | "error";

/** Where the record was produced. Never inferred — always stated by the writer. */
export type EventOrigin = "server" | "browser";

export type EventField = string | number | boolean | null;

export interface TraceEvent {
  /** Monotonic within an origin. The cursor a poller sends back as `since`. */
  seq: number;
  ts: number;
  level: EventLevel;
  /** Subsystem, e.g. `Dispatch`, `Breaker`, `Quota`, `Cache`, `Operator`. */
  source: string;
  message: string;
  fields: Record<string, EventField>;
  origin: EventOrigin;
}

export interface EventInput {
  level?: EventLevel;
  source: string;
  message: string;
  fields?: Record<string, EventField | undefined>;
}

const EVENT_CAPACITY = 600;

/**
 * Fixed-capacity ring with a monotonic cursor.
 *
 * `since()` returns everything newer than a sequence number *and* reports the
 * oldest sequence still held, so a client that fell behind the ring can tell it
 * lost lines instead of silently showing a discontinuous log.
 */
export class EventRing {
  private items: TraceEvent[] = [];
  private cursor = 0;

  constructor(private capacity = EVENT_CAPACITY) {}

  push(event: Omit<TraceEvent, "seq">): TraceEvent {
    const record: TraceEvent = { ...event, seq: ++this.cursor };
    this.items.push(record);
    if (this.items.length > this.capacity) {
      this.items.splice(0, this.items.length - this.capacity);
    }
    return record;
  }

  /** Everything with `seq > since`, oldest first, capped at `limit`. */
  since(since: number, limit = 200): TraceEvent[] {
    const fresh = this.items.filter((e) => e.seq > since);
    // Keep the NEWEST `limit`, not the oldest: a client that has been away is
    // better served by the current state of the world than by the first page of
    // a backlog it will never finish paging through.
    return fresh.slice(Math.max(0, fresh.length - limit));
  }

  all(): TraceEvent[] {
    return [...this.items];
  }

  /** Lowest sequence still retained; 0 when the ring is empty. */
  oldestSeq(): number {
    return this.items[0]?.seq ?? 0;
  }

  latestSeq(): number {
    return this.cursor;
  }

  size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items = [];
  }
}

const events = new EventRing();

/**
 * Record one event.
 *
 * `undefined` field values are dropped rather than serialised as `null`: an
 * absent field and a field that is genuinely null mean different things on a
 * diagnostic line, and JSON collapses them if we do not.
 */
export function emit(input: EventInput, origin: EventOrigin = "server"): TraceEvent {
  const fields: Record<string, EventField> = {};
  for (const [key, value] of Object.entries(input.fields ?? {})) {
    if (value !== undefined) fields[key] = value;
  }
  return events.push({
    ts: Date.now(),
    level: input.level ?? "info",
    source: input.source,
    message: input.message,
    fields,
    origin,
  });
}

export function eventsSince(since: number, limit = 200): TraceEvent[] {
  return events.since(since, limit);
}

export function eventCursor(): { latest: number; oldest: number; retained: number; capacity: number } {
  return {
    latest: events.latestSeq(),
    oldest: events.oldestSeq(),
    retained: events.size(),
    capacity: EVENT_CAPACITY,
  };
}

// --------------------------------------------------------------------------
// Latency
// --------------------------------------------------------------------------

export interface LatencySample {
  ts: number;
  ms: number;
  ok: boolean;
}

export interface LatencyStats {
  /** Samples the percentiles were computed from. Small `n` ⇒ weak p99. */
  n: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
  /** Fraction of the window's calls that threw, 0–1. */
  errorRate: number;
  /** Epoch ms of the most recent sample, or null when the window is empty. */
  lastAt: number | null;
}

const LATENCY_CAPACITY = 120;

/** Samples older than this are dropped on read, so stats describe *now*. */
const LATENCY_WINDOW_MS = 15 * 60_000;

const latencySamples = new Map<string, LatencySample[]>();

/**
 * `at` is the observation time and defaults to now.
 *
 * Parameterised only so bucketing can be tested: every property worth pinning
 * about `latencyWindow` is about samples landing in DIFFERENT buckets, and a
 * test cannot produce that if the clock is read internally. Production callers
 * pass nothing and get `Date.now()`, exactly as before.
 */
export function recordLatency(key: string, ms: number, ok: boolean, at = Date.now()): void {
  const sample = { ts: at, ms, ok };
  const bucket = latencySamples.get(key) ?? [];
  bucket.push(sample);
  if (bucket.length > LATENCY_CAPACITY) bucket.splice(0, bucket.length - LATENCY_CAPACITY);
  latencySamples.set(key, bucket);
  queuePendingSample(key, sample);
}

/**
 * Nearest-rank percentile.
 *
 * Not linear interpolation: with n in the tens, interpolation invents a value
 * that no call actually took. Nearest-rank always returns a latency some request
 * genuinely experienced, which is the number an operator can go and find in the
 * log.
 */
export function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

/**
 * The samples a read should describe: the gateway-merged view when it is
 * fresh, supplemented by whatever this instance recorded since it last synced;
 * the local per-instance bucket when the overlay is stale or absent.
 */
function windowedSamples(key: string, now: number): LatencySample[] {
  const cutoff = now - LATENCY_WINDOW_MS;
  const local = latencySamples.get(key) ?? [];
  if (!sharedFresh(now)) return local.filter((s) => s.ts >= cutoff);
  const merged = (shared!.latency.get(key) ?? []).filter((s) => s.ts >= cutoff);
  // Our own pushed samples came back inside the overlay; only what was
  // recorded after the last drain is missing from it.
  for (const s of local) if (s.ts > shared!.drainedAtMs && s.ts >= cutoff) merged.push(s);
  return merged;
}

// Failures are included in the percentiles on purpose: a timeout is latency
// the caller paid for and excluding it makes a dying provider look fast. The
// error rate is reported alongside so the two are never confused.
function statsOf(bucket: LatencySample[]): LatencyStats {
  if (!bucket.length) {
    return { n: 0, p50: null, p95: null, p99: null, max: null, errorRate: 0, lastAt: null };
  }
  const sorted = bucket.map((s) => s.ms).sort((a, b) => a - b);
  const failures = bucket.filter((s) => !s.ok).length;
  let lastAt = bucket[0].ts;
  for (const s of bucket) if (s.ts > lastAt) lastAt = s.ts;
  return {
    n: bucket.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1],
    errorRate: failures / bucket.length,
    lastAt,
  };
}

export function latencyStats(key: string, now = Date.now()): LatencyStats {
  return statsOf(windowedSamples(key, now));
}

/** Every key that has at least one sample in the window. */
export function latencyKeys(now = Date.now()): string[] {
  const cutoff = now - LATENCY_WINDOW_MS;
  return [...latencySamples.entries()]
    .filter(([, bucket]) => bucket.some((s) => s.ts >= cutoff))
    .map(([key]) => key);
}

/**
 * The history behind the scalars, bucketed for the wire.
 *
 * `latencySamples` has held timestamped samples the whole time and only
 * `statsOf` aggregates ever escaped, so the client could show a p95 and had no
 * way to show whether it had been climbing. This exposes the shape without
 * shipping the raw samples: ~1,300 `{ts,ms,ok}` would be about 50KB per poll,
 * and 15 one-minute buckets per key is 2-3KB.
 *
 * The per-bucket statistic is p50, NOT p95. A 60-second bucket on this traffic
 * holds single digits, and a "p95" over three calls is the maximum wearing a
 * percentile's name — the exact theatre `LATENCY_MIN_SAMPLES` exists to stop.
 * The headline stays the 15-minute p95 from `latencyStats`; this is the trend
 * beneath it, and the caption says which is which.
 *
 * Reads through `windowedSamples`, so the sparkline and the chip describe the
 * same pool including the gateway-merged overlay. Two different sources for one
 * number is how they end up disagreeing on screen.
 */
export const LATENCY_BUCKET_MS = 60_000;
export const LATENCY_BUCKET_MIN_SAMPLES = 3;

export interface LatencyWindowSeries {
  key: string;
  /**
   * Oldest first. `null` where fewer than `minSamples` calls landed in the
   * bucket — never 0, because a minute with no traffic is not a fast minute.
   */
  p50: Array<number | null>;
  n: number[];
}

export interface LatencyWindow {
  /** Epoch ms of the START of bucket 0. */
  startedAt: number;
  bucketMs: number;
  buckets: number;
  minSamplesPerBucket: number;
  /** Only keys with at least one sample in the window; an all-null row is omitted. */
  series: LatencyWindowSeries[];
}

export function latencyWindow(
  now = Date.now(),
  bucketMs = LATENCY_BUCKET_MS,
  minSamples = LATENCY_BUCKET_MIN_SAMPLES,
): LatencyWindow {
  const buckets = Math.max(1, Math.round(LATENCY_WINDOW_MS / bucketMs));
  const startedAt = now - buckets * bucketMs;

  const keys = new Set<string>(latencySamples.keys());
  if (sharedFresh(now)) for (const key of shared!.latency.keys()) keys.add(key);

  const series: LatencyWindowSeries[] = [];
  for (const key of keys) {
    const samples = windowedSamples(key, now);
    if (!samples.length) continue;

    const lanes: number[][] = Array.from({ length: buckets }, () => []);
    for (const sample of samples) {
      const index = Math.floor((sample.ts - startedAt) / bucketMs);
      if (index >= 0 && index < buckets) lanes[index].push(sample.ms);
    }

    const p50 = lanes.map((lane) => {
      if (lane.length < minSamples) return null;
      return percentile([...lane].sort((a, b) => a - b), 50);
    });
    // An all-null row is a key with traffic too thin to plot anywhere in the
    // window; omitting it is the difference between "no line" and "a flat line".
    if (p50.every((v) => v == null)) continue;
    series.push({ key, p50, n: lanes.map((lane) => lane.length) });
  }

  return {
    startedAt,
    bucketMs,
    buckets,
    minSamplesPerBucket: minSamples,
    series: series.sort((a, b) => a.key.localeCompare(b.key)),
  };
}

/** p50 across every provider's window — the "is the data plane slow" number. */
export function globalLatency(now = Date.now()): LatencyStats {
  const keys = new Set<string>(latencySamples.keys());
  if (sharedFresh(now)) for (const key of shared!.latency.keys()) keys.add(key);
  const all: LatencySample[] = [];
  for (const key of keys) all.push(...windowedSamples(key, now));
  return statsOf(all);
}

// --------------------------------------------------------------------------
// Cache accounting
// --------------------------------------------------------------------------

export interface CacheCounters {
  hits: number;
  misses: number;
  /** null until at least one lookup — 0% and "no data" are not the same. */
  hitRate: number | null;
}

const cacheByCapability = new Map<string, { hits: number; misses: number }>();

export function recordCacheLookup(capability: string, hit: boolean): void {
  const row = cacheByCapability.get(capability) ?? { hits: 0, misses: 0 };
  if (hit) row.hits += 1;
  else row.misses += 1;
  cacheByCapability.set(capability, row);
}

function rate(hits: number, misses: number): number | null {
  const total = hits + misses;
  return total ? hits / total : null;
}

export function cacheStats(): { total: CacheCounters; byCapability: Record<string, CacheCounters> } {
  let hits = 0;
  let misses = 0;
  const byCapability: Record<string, CacheCounters> = {};
  for (const [capability, row] of cacheByCapability) {
    hits += row.hits;
    misses += row.misses;
    byCapability[capability] = { ...row, hitRate: rate(row.hits, row.misses) };
  }
  return { total: { hits, misses, hitRate: rate(hits, misses) }, byCapability };
}

// --------------------------------------------------------------------------
// Simulated outages
// --------------------------------------------------------------------------

export interface SimulatedOutage {
  provider: string;
  expiresAt: number;
  note: string;
}

/**
 * Self-expiring on purpose.
 *
 * A permanent operator-set block is a foot-gun: someone verifies failover on a
 * Friday, walks away, and the deployment serves degraded data until a human
 * notices. An expiry means the worst case is a bounded window, and the remaining
 * time is shown in the UI so nobody is surprised by the restore either.
 */
export const OUTAGE_MAX_MS = 15 * 60_000;

const outages = new Map<string, SimulatedOutage>();

export function simulateOutage(provider: string, ttlMs = OUTAGE_MAX_MS, note = "operator-simulated outage"): SimulatedOutage {
  const bounded = Math.min(OUTAGE_MAX_MS, Math.max(10_000, ttlMs));
  const record: SimulatedOutage = { provider, expiresAt: Date.now() + bounded, note };
  outages.set(provider, record);
  // Mirror into the shared overlay and queue the command, so every other
  // instance honours the outage after its next sync — and so a clear queued
  // earlier in this same batch cannot cancel a newer set.
  shared?.outages.set(provider, record);
  pending.outageCleared = pending.outageCleared.filter((p) => p !== provider);
  pending.outageSet = pending.outageSet.filter((o) => o.provider !== provider);
  pending.outageSet.push(record);
  return record;
}

export function clearOutage(provider: string): boolean {
  const known = outages.delete(provider);
  const knownShared = shared?.outages.delete(provider) ?? false;
  pending.outageSet = pending.outageSet.filter((o) => o.provider !== provider);
  if (!pending.outageCleared.includes(provider)) pending.outageCleared.push(provider);
  return known || knownShared;
}

export function clearAllOutages(): number {
  const n = activeOutages().length;
  outages.clear();
  shared?.outages.clear();
  pending.outageSet = [];
  pending.outageCleared = ["*"];
  return n;
}

export function outageFor(provider: string, now = Date.now()): SimulatedOutage | null {
  const record = outages.get(provider);
  if (record) {
    if (record.expiresAt > now) return record;
    outages.delete(provider);
  }
  if (sharedFresh(now)) {
    const remote = shared!.outages.get(provider);
    if (remote) {
      if (remote.expiresAt > now) return remote;
      shared!.outages.delete(provider);
    }
  }
  return null;
}

export function activeOutages(now = Date.now()): SimulatedOutage[] {
  const providers = new Set<string>(outages.keys());
  if (sharedFresh(now)) for (const provider of shared!.outages.keys()) providers.add(provider);
  return [...providers]
    .map((provider) => outageFor(provider, now))
    .filter((o): o is SimulatedOutage => o !== null);
}

// --------------------------------------------------------------------------
// Shared operational state — the gateway-backed ledger sync
// --------------------------------------------------------------------------
//
// The mechanics live in `lib/ops-sync.ts` (server-only, since it talks to the
// gateway); this module owns the two data structures the sync moves between:
// the *pending queues* of deltas this instance has produced since its last
// successful push, and the *overlay* — the merged cross-instance view the
// gateway returned. Reads above consult the overlay while it is fresh and fall
// back to the local buckets when it is not, so a gateway outage degrades to
// exactly the per-instance behaviour this file always had.

/** Overlay older than this stops being believed. Two health polls' worth. */
export const SHARED_STALE_MS = 90_000;

const PENDING_SAMPLE_CAP = 480;

export interface SharedLatencySampleWire {
  ts: number;
  ms: number;
  ok: boolean;
}

/** Request body of `POST /api/ops/web-state/sync` — the gateway's wire shape. */
export interface SharedOpsSyncBody {
  schema_version: 1;
  instance: string;
  latency: Array<{ key: string; samples: SharedLatencySampleWire[] }>;
  quota: Array<{ provider: string; window: string; spent: number }>;
  quota_reset: Array<{ provider: string; window: string }>;
  outages_set: Array<{ provider: string; expires_at: number; note: string }>;
  outages_cleared: string[];
}

/** Response body of the same route. */
export interface SharedOpsViewWire {
  schema_version: 1;
  observed_at: string;
  window_seconds: number;
  instances: string[];
  latency: Array<{ key: string; samples: SharedLatencySampleWire[] }>;
  outages: Array<{ provider: string; expires_at: number; note: string }>;
  quota: Array<{ provider: string; window: string; spent: number }>;
}

const pending = {
  samples: [] as Array<{ key: string; ts: number; ms: number; ok: boolean }>,
  /** Delta spend per `${provider}|${window}` since the last successful push. */
  quota: new Map<string, number>(),
  quotaResets: [] as Array<{ provider: string; window: string }>,
  outageSet: [] as SimulatedOutage[],
  outageCleared: [] as string[],
};

let shared: {
  fetchedAtMs: number;
  /** When the request body now inside the overlay was drained locally. */
  drainedAtMs: number;
  observedAtMs: number;
  windowSeconds: number;
  instances: string[];
  latency: Map<string, LatencySample[]>;
  outages: Map<string, SimulatedOutage>;
} | null = null;

function sharedFresh(now: number): boolean {
  return shared !== null && now - shared.fetchedAtMs <= SHARED_STALE_MS;
}

function queuePendingSample(key: string, sample: LatencySample): void {
  pending.samples.push({ key, ...sample });
  if (pending.samples.length > PENDING_SAMPLE_CAP) {
    pending.samples.splice(0, pending.samples.length - PENDING_SAMPLE_CAP);
  }
}

/** Called by the quota ledger (`providers/runtime.ts`) on every spend. */
export function recordQuotaSpend(provider: string, window: string, spent = 1): void {
  const key = `${provider}|${window}`;
  pending.quota.set(key, (pending.quota.get(key) ?? 0) + spent);
}

/** Called by the quota ledger when an operator resets a window. */
export function recordQuotaReset(provider: string, window: string): void {
  pending.quota.delete(`${provider}|${window}`);
  if (!pending.quotaResets.some((r) => r.provider === provider && r.window === window)) {
    pending.quotaResets.push({ provider, window });
  }
}

/**
 * Drain every pending queue into a sync request body. The caller owns the
 * result: on a failed push it hands the body to {@link restorePendingOps} so
 * nothing is lost, on a successful one the returned overlay supersedes it.
 */
export function takePendingOps(): SharedOpsSyncBody {
  const byKey = new Map<string, SharedLatencySampleWire[]>();
  for (const { key, ts, ms, ok } of pending.samples) {
    const bucket = byKey.get(key) ?? [];
    bucket.push({ ts, ms, ok });
    byKey.set(key, bucket);
  }
  const body: SharedOpsSyncBody = {
    schema_version: 1,
    instance: instanceId,
    latency: [...byKey.entries()].map(([key, samples]) => ({ key, samples })),
    quota: [...pending.quota.entries()].map(([key, spent]) => {
      const [provider, window] = key.split("|");
      return { provider, window, spent };
    }),
    quota_reset: pending.quotaResets.slice(),
    outages_set: pending.outageSet.map((o) => ({
      provider: o.provider,
      expires_at: o.expiresAt,
      note: o.note,
    })),
    outages_cleared: pending.outageCleared.slice(),
  };
  pending.samples = [];
  pending.quota.clear();
  pending.quotaResets = [];
  pending.outageSet = [];
  pending.outageCleared = [];
  return body;
}

/**
 * Put a drained body back after a failed push.
 *
 * Anything the instance did *after* the drain wins over what is being
 * restored: a provider the operator has since re-outaged must not be
 * re-queued as cleared, and vice versa.
 */
export function restorePendingOps(body: SharedOpsSyncBody): void {
  const restored = body.latency.flatMap(({ key, samples }) =>
    samples.map((s) => ({ key, ...s })),
  );
  pending.samples = [...restored, ...pending.samples].slice(-PENDING_SAMPLE_CAP);
  for (const { provider, window, spent } of body.quota) {
    const key = `${provider}|${window}`;
    // A reset queued since the drain supersedes the older spend.
    if (pending.quotaResets.some((r) => r.provider === provider && r.window === window)) continue;
    pending.quota.set(key, (pending.quota.get(key) ?? 0) + spent);
  }
  for (const reset of body.quota_reset) {
    if (!pending.quotaResets.some((r) => r.provider === reset.provider && r.window === reset.window)) {
      pending.quotaResets.push(reset);
    }
  }
  const clearedAll = pending.outageCleared.includes("*");
  for (const o of body.outages_set) {
    if (clearedAll || pending.outageCleared.includes(o.provider)) continue;
    if (pending.outageSet.some((p) => p.provider === o.provider)) continue;
    pending.outageSet.push({ provider: o.provider, expiresAt: o.expires_at, note: o.note });
  }
  for (const provider of body.outages_cleared) {
    if (provider !== "*" && pending.outageSet.some((p) => p.provider === provider)) continue;
    if (!pending.outageCleared.includes(provider)) pending.outageCleared.push(provider);
  }
}

/** Install the gateway's merged view as the read overlay. */
export function applySharedOpsState(view: SharedOpsViewWire, drainedAtMs: number, now = Date.now()): void {
  const observedAtMs = Date.parse(view.observed_at);
  shared = {
    fetchedAtMs: now,
    drainedAtMs,
    observedAtMs: Number.isFinite(observedAtMs) ? observedAtMs : now,
    windowSeconds: view.window_seconds,
    instances: view.instances,
    latency: new Map(
      view.latency.map(({ key, samples }) => [
        key,
        samples.map((s) => ({ ts: s.ts, ms: s.ms, ok: s.ok })),
      ]),
    ),
    outages: new Map(
      view.outages
        .filter((o) => o.expires_at > now)
        .map((o) => [o.provider, { provider: o.provider, expiresAt: o.expires_at, note: o.note }]),
    ),
  };
}

export interface SharedOpsStatus {
  /** True while the merged overlay is fresh enough to be the read model. */
  backed: boolean;
  instances: string[];
  observedAt: string | null;
  ageMs: number | null;
  windowSeconds: number | null;
}

export function sharedOpsStatus(now = Date.now()): SharedOpsStatus {
  if (!shared) return { backed: false, instances: [], observedAt: null, ageMs: null, windowSeconds: null };
  return {
    backed: sharedFresh(now),
    instances: shared.instances,
    observedAt: new Date(shared.observedAtMs).toISOString(),
    ageMs: now - shared.fetchedAtMs,
    windowSeconds: shared.windowSeconds,
  };
}

// --------------------------------------------------------------------------
// Redaction
// --------------------------------------------------------------------------

/**
 * Credential values the console must never echo.
 *
 * Registered rather than read from `process.env` here so this module stays
 * isomorphic — and so the redactor covers values that arrived some other way.
 * Short values are ignored: a two-character "key" would blank unrelated text.
 */
const secrets = new Set<string>();

const MIN_SECRET_LENGTH = 8;

export function registerSecret(value: string | undefined | null): void {
  const trimmed = value?.trim();
  if (trimmed && trimmed.length >= MIN_SECRET_LENGTH) secrets.add(trimmed);
}

export function clearSecrets(): void {
  secrets.clear();
}

/** Query parameters whose *value* is a credential regardless of its content. */
const SECRET_PARAM_RE = /^(api[-_]?key|apikey|token|access[-_]?token|auth|key|secret|password|pwd|sig|signature)$/i;

const MASK = "«redacted»";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replace every registered secret literal anywhere in `text`. */
export function redact(text: string): string {
  let out = text;
  for (const secret of secrets) {
    out = out.replace(new RegExp(escapeRegExp(secret), "g"), MASK);
  }
  return out;
}

/**
 * A URL safe to display.
 *
 * Two independent passes, because either alone leaks. Blanking known parameter
 * names misses a vendor that calls its key something unexpected; blanking known
 * secret literals misses a key that is not registered because its env var was
 * read somewhere else. Both run, and a URL that fails to parse is redacted as a
 * plain string rather than returned raw.
 */
export function redactUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return redact(raw);
  }
  for (const name of [...parsed.searchParams.keys()]) {
    if (SECRET_PARAM_RE.test(name)) parsed.searchParams.set(name, MASK);
  }
  // Credentials in the authority component (https://user:pass@host) never
  // survive to a screen.
  if (parsed.username || parsed.password) {
    parsed.username = MASK;
    parsed.password = "";
  }
  return redact(parsed.toString());
}

/** Header names whose values are credentials. */
const SECRET_HEADER_RE = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|apikey)$/i;

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = SECRET_HEADER_RE.test(name) ? MASK : redact(value);
  }
  return out;
}

// --------------------------------------------------------------------------
// Payload capture
// --------------------------------------------------------------------------

export interface CapturedBody {
  /** Parsed JSON, size-bounded and redacted. `null` when nothing was retained. */
  value: unknown;
  /** Serialised size of the ORIGINAL body, before truncation. */
  bytes: number;
  truncated: boolean;
}

/**
 * A single upstream HTTP call, as the inspector shows it.
 *
 * `url` is post-redaction by construction — the raw string is never stored, so
 * there is no path by which a later change accidentally serialises it.
 */
export interface UpstreamCall {
  provider: string;
  method: string;
  url: string;
  status: number | null;
  ms: number;
  ok: boolean;
  error?: string;
  body?: CapturedBody;
}

/** Bodies above this are truncated. Enough for a quote, short of a year of bars. */
export const MAX_BODY_CHARS = 24_000;

/**
 * Bounded, redacted snapshot of a JSON value.
 *
 * Arrays are the size risk here — a bars response is thousands of rows — so long
 * arrays keep a head sample and say how many elements were dropped, which is
 * what a developer inspecting a schema actually needs. Depth is bounded for the
 * same reason a JSON tree widget needs it: an unexpectedly recursive payload
 * should not be able to hang the page that is meant to be debugging it.
 */
export function captureBody(value: unknown, maxChars = MAX_BODY_CHARS): CapturedBody {
  let serialised: string;
  try {
    serialised = JSON.stringify(value) ?? "null";
  } catch {
    return { value: "«unserialisable body»", bytes: 0, truncated: true };
  }
  const bytes = serialised.length;
  if (bytes <= maxChars) {
    return { value: JSON.parse(redact(serialised)), bytes, truncated: false };
  }

  // Over budget: keep a structurally faithful *sample* rather than a cut string,
  // because the reason to open a raw payload is almost always to check a shape,
  // and a shape survives sampling while it does not survive truncation.
  const sampled = JSON.stringify(shrink(value, 0)) ?? "null";
  if (sampled.length > maxChars) {
    // Still over after sampling. Degrade to a plain string so the result is
    // always valid JSON — a half-closed object would break the tree viewer that
    // is supposed to be the debugging tool.
    return { value: `${redact(sampled.slice(0, maxChars))}…`, bytes, truncated: true };
  }
  return { value: JSON.parse(redact(sampled)), bytes, truncated: true };
}

const MAX_ARRAY_SAMPLE = 25;
const MAX_DEPTH = 8;

function shrink(value: unknown, depth: number): unknown {
  if (depth >= MAX_DEPTH) return "«depth limit»";
  if (Array.isArray(value)) {
    const head = value.slice(0, MAX_ARRAY_SAMPLE).map((item) => shrink(item, depth + 1));
    return value.length > MAX_ARRAY_SAMPLE
      ? [...head, `«+${value.length - MAX_ARRAY_SAMPLE} more elements»`]
      : head;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = shrink(item, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && value.length > 500) return `${value.slice(0, 500)}…`;
  return value;
}

// --------------------------------------------------------------------------
// Capture scope
// --------------------------------------------------------------------------

/**
 * The buffer an in-flight inspection writes its upstream calls into.
 *
 * `dispatch` opens one of these only when a caller asked to inspect, so the
 * normal request path allocates nothing and retains no bodies. Which scope is
 * "current" is resolved by an injected function rather than a module variable:
 * on the server that resolver is backed by `AsyncLocalStorage`, so concurrent
 * requests cannot write into each other's buffer. In the browser there is no
 * such hazard and no resolver is installed.
 */
export interface CaptureScope {
  calls: UpstreamCall[];
  /** Capture response bodies, not just call metadata. */
  bodies: boolean;
}

type CaptureResolver = () => CaptureScope | null;

let resolveCapture: CaptureResolver = () => null;

export function setCaptureResolver(resolver: CaptureResolver): void {
  resolveCapture = resolver;
}

export function currentCapture(): CaptureScope | null {
  return resolveCapture();
}

export interface UpstreamRecord {
  provider: string;
  method?: string;
  url: string;
  status?: number | null;
  ms: number;
  ok: boolean;
  error?: string;
  /** Parsed response body. Retained only inside an active capture scope. */
  payload?: unknown;
  /**
   * Contribute a latency sample under this key.
   *
   * Set only by callers that have no dispatch layer above them — the direct
   * exchange clients in `venues.ts` and `marketdata.ts`, which `/api/depth` and
   * `/api/tca` reach without going through the registry at all. Registry traffic
   * is sampled once at the dispatch boundary instead, and the keys are kept
   * distinct (`venue:binance` vs `binance`) so the two measurements — one hop
   * versus a whole failover-eligible attempt — are never averaged together.
   */
  latencyKey?: string;
}

/**
 * The single funnel every outbound provider request reports through.
 *
 * Called from `httpJson` (all keyed adapters) and from the direct exchange
 * clients in `venues.ts` / `marketdata.ts` that Binance reaches without going
 * through it. Recording in one place is what makes the health matrix's latency
 * column mean the same thing for every row.
 */
export function recordUpstream(record: UpstreamRecord, origin: EventOrigin = "server"): void {
  const url = redactUrl(record.url);
  // No unconditional `recordLatency` here. Registry provider latency is measured
  // once, at the dispatch boundary, so the health matrix's p50 means "what the
  // registry paid for an answer" for every row — counting a retried request's
  // three hops as three samples would make the flakiest provider look like the
  // busiest one. Only callers with nothing above them opt in via `latencyKey`.
  if (record.latencyKey) recordLatency(record.latencyKey, record.ms, record.ok);

  const scope = currentCapture();
  if (scope) {
    const call: UpstreamCall = {
      provider: record.provider,
      method: record.method ?? "GET",
      url,
      status: record.status ?? null,
      ms: record.ms,
      ok: record.ok,
      error: record.error,
    };
    if (scope.bodies && record.payload !== undefined) call.body = captureBody(record.payload);
    scope.calls.push(call);
  }

  emit(
    {
      level: record.ok ? "debug" : "warn",
      source: "Upstream",
      message: record.ok
        ? `${record.provider} ${record.method ?? "GET"} ${record.ms}ms`
        : `${record.provider} ${record.method ?? "GET"} failed after ${record.ms}ms`,
      fields: {
        provider: record.provider,
        url,
        status: record.status ?? null,
        ms: record.ms,
        error: record.error,
      },
    },
    origin,
  );
}

// --------------------------------------------------------------------------
// Reset (operator action + test isolation)
// --------------------------------------------------------------------------

export function resetTelemetry(
  options: { events?: boolean; latency?: boolean; cache?: boolean; outages?: boolean; shared?: boolean } = {},
): void {
  if (options.events) events.clear();
  if (options.latency) {
    // Clearing observation clears what *this instance* can see — its buckets,
    // its unpushed queue, and its copy of the merged view. The gateway ledger
    // keeps other instances' history and the next sync re-reads it; erasing
    // the shared record from here would let one instance rewrite the fleet's.
    latencySamples.clear();
    pending.samples = [];
    shared?.latency.clear();
  }
  if (options.cache) cacheByCapability.clear();
  if (options.outages) outages.clear();
  if (options.shared) {
    // Test isolation: forget the overlay and every pending delta.
    shared = null;
    pending.samples = [];
    pending.quota.clear();
    pending.quotaResets = [];
    pending.outageSet = [];
    pending.outageCleared = [];
  }
}
