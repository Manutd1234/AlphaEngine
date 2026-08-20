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

import { isDataQualityView, type DataQualityViewWire } from "@/lib/data-quality-ledger";

export { instanceId, startedAt } from "./identity";
export { EventRing, emit, eventCursor, eventsSince } from "./ring";
export type { EventField, EventInput, EventLevel, EventOrigin, TraceEvent } from "./ring";
export { LATENCY_BUCKET_MIN_SAMPLES, LATENCY_BUCKET_MS, LatencyRing, globalLatency, latencyByClass, latencyKeys, latencyRing, latencyStats, latencyWindow, percentile, recordLatency } from "./latency";
export type { LatencySample, LatencyStats, LatencyWindow, LatencyWindowSeries } from "./latency";
export { CacheLedger, cacheLedger, cacheStats, recordCacheLookup } from "./cache";
export type { CacheCounters } from "./cache";
export { OUTAGE_MAX_MS, OutageRegistry, activeOutages, clearAllOutages, clearOutage, outageFor, outageRegistry, simulateOutage } from "./outages";
export type { SimulatedOutage } from "./outages";
export { OpsLedger, SHARED_STALE_MS, applySharedOpsState, opsLedger, queueContractFinding, recordQuotaReset, recordQuotaSpend, restorePendingOps, sharedDataQuality, sharedOpsStatus, takePendingOps } from "./ledger";
export type { SharedContractFindingWire, SharedLatencySampleWire, SharedOpsStatus, SharedOpsSyncBody, SharedOpsViewWire } from "./ledger";
export { clearSecrets, redact, redactHeaders, redactUrl, registerSecret } from "./redaction";
export { MAX_BODY_CHARS, captureBody, currentCapture, recordUpstream, resetTelemetry, setCaptureResolver } from "./capture";
export type { CaptureScope, CapturedBody, UpstreamCall, UpstreamRecord } from "./capture";
