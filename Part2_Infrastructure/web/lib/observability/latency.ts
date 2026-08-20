import { startedAt } from "./identity";
import { queuePendingSample, shared, sharedFresh } from "./ledger";

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

export const latencySamples = new Map<string, LatencySample[]>();

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

/**
 * The same pool, split by what each key measures.
 *
 * `globalLatency` blends three things the reader should not: `plane:*` is the
 * web→gateway hop the health poll itself pays (and, polling every 30s, it
 * supplies most of the samples), `venue:*` and bare provider ids are the
 * upstream REST the desk actually routes on. A single p99 over the union is
 * dominated by whichever the poller manufactures, so a caller that wants to
 * label the number honestly asks for the class it means. Keys are prefixed at
 * every `recordLatency` site; a key with no known prefix counts as upstream,
 * which is the conservative default (it never inflates the hop figure).
 */
export function latencyByClass(now = Date.now()): { gatewayHop: LatencyStats; upstream: LatencyStats } {
  const keys = new Set<string>(latencySamples.keys());
  if (sharedFresh(now)) for (const key of shared!.latency.keys()) keys.add(key);
  const hop: LatencySample[] = [];
  const upstream: LatencySample[] = [];
  for (const key of keys) {
    (key.startsWith("plane:") ? hop : upstream).push(...windowedSamples(key, now));
  }
  return { gatewayHop: statsOf(hop), upstream: statsOf(upstream) };
}
