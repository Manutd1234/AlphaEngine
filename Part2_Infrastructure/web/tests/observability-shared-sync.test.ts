/**
 * The shared ops ledger: queues, overlay, and honest fallback.
 *
 * Serverless instances do not share memory, so each one records its own latency
 * samples, outages and quota spend, pushes them to a gateway-backed ledger, and
 * reads back a merged overlay of what every instance has seen. Three things can
 * go wrong in that loop, and all three end in a console that is confidently
 * wrong rather than visibly degraded.
 *
 * A drain that is not restored on failure loses the samples. A restore that
 * doubles them inflates the count. So a drained body comes back oldest-first,
 * deltas recorded while the push was in flight ride along behind it, and a
 * finding queued meanwhile keeps its own monotonic seq — re-restoring the same
 * body twice cannot duplicate one.
 *
 * A stale overlay is the failure that looks most like success: the numbers are
 * still there, they are just from a sync that stopped happening. Past
 * `SHARED_STALE_MS` the overlay is not believed — reads fall back to the local
 * bucket, `sharedOpsStatus` declares itself unbacked, and a missing
 * `data_quality` block from an older gateway is null rather than trusted.
 *
 * And an overlay is a read model, not a second authority: an outage another
 * instance set blocks routing here, clearing it locally clears the overlay copy
 * *and* queues the command, so the next sync cannot resurrect it. Findings are
 * redacted before they are queued, because a violation message carries the URL
 * that produced it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  activeOutages,
  applySharedOpsState,
  clearAllOutages,
  clearOutage,
  clearSecrets,
  latencyStats,
  outageFor,
  queueContractFinding,
  recordLatency,
  recordQuotaReset,
  recordQuotaSpend,
  registerSecret,
  resetTelemetry,
  restorePendingOps,
  SHARED_STALE_MS,
  sharedDataQuality,
  sharedOpsStatus,
  type SharedOpsViewWire,
  simulateOutage,
  takePendingOps,
} from "../lib/observability";
import { isSharedOpsView } from "../lib/ops-sync";
import {
  hydrateQuotaLedger,
  MemoryStore,
} from "../lib/providers/runtime";

describe("the shared ledger sync: queues, overlay, and honest fallback", () => {
  const emptyLedger = (): SharedOpsViewWire["data_quality"] => ({
    backend: "sqlite",
    retention_days: 7,
    window_minutes: 1440,
    observed_at: new Date().toISOString(),
    first_observed_at: null,
    last_observed_at: null,
    instances: 0,
    total: { evaluated: 0, passed: 0, fatal: 0, warn: 0, drift: 0, not_evaluated: 0 },
    by_provider: [],
    by_capability: [],
    recent: [],
    escalations: [],
  });
  const view = (overrides: Partial<SharedOpsViewWire> = {}): SharedOpsViewWire => ({
    schema_version: 1,
    observed_at: new Date().toISOString(),
    window_seconds: 900,
    instances: ["remote-1", "remote-2"],
    latency: [],
    outages: [],
    quota: [],
    data_quality: emptyLedger(),
    ...overrides,
  });

  it("drains recorded samples into the sync body and clears the queue", () => {
    resetTelemetry({ latency: true, shared: true });
    recordLatency("shared-key", 100, true);
    recordLatency("shared-key", 200, false);
    const body = takePendingOps();
    const batch = body.latency.find((b) => b.key === "shared-key");
    assert.equal(batch?.samples.length, 2);
    assert.deepEqual(takePendingOps().latency, [], "a second drain must be empty");
    resetTelemetry({ latency: true, shared: true });
  });

  it("a failed push restores the drained body without losing newer deltas", () => {
    resetTelemetry({ latency: true, shared: true });
    recordLatency("k", 10, true);
    const body = takePendingOps();
    recordLatency("k", 20, true); // recorded while the push was in flight
    restorePendingOps(body);
    const retry = takePendingOps();
    const samples = retry.latency.find((b) => b.key === "k")?.samples ?? [];
    assert.deepEqual(samples.map((s) => s.ms), [10, 20], "restored samples come back oldest-first");
    resetTelemetry({ latency: true, shared: true });
  });

  it("a fresh overlay becomes the read model, supplemented by post-drain samples", () => {
    resetTelemetry({ latency: true, shared: true });
    const drainedAt = Date.now() - 1_000;
    applySharedOpsState(
      view({
        latency: [{ key: "merged", samples: [
          { ts: drainedAt - 5_000, ms: 50, ok: true },
          { ts: drainedAt - 4_000, ms: 60, ok: true },
        ] }],
      }),
      drainedAt,
    );
    recordLatency("merged", 70, true); // after the drain — not yet pushed
    const stats = latencyStats("merged");
    assert.equal(stats.n, 3, "two merged samples plus one local supplement");
    assert.equal(stats.max, 70);
    resetTelemetry({ latency: true, shared: true });
  });

  it("a stale overlay is not believed: reads fall back to the local bucket", () => {
    resetTelemetry({ latency: true, shared: true });
    applySharedOpsState(
      view({ latency: [{ key: "old", samples: [{ ts: Date.now(), ms: 999, ok: true }] }] }),
      Date.now(),
    );
    const later = Date.now() + SHARED_STALE_MS + 1_000;
    assert.equal(latencyStats("old", later).n, 0, "the overlay aged out and nothing local exists");
    assert.equal(sharedOpsStatus(later).backed, false);
    resetTelemetry({ latency: true, shared: true });
  });

  it("an outage set by another instance blocks routing here", () => {
    resetTelemetry({ shared: true, outages: true });
    applySharedOpsState(
      view({ outages: [{ provider: "remote-outage", expires_at: Date.now() + 60_000, note: "drill" }] }),
      Date.now(),
    );
    assert.equal(outageFor("remote-outage")?.note, "drill");
    assert.ok(activeOutages().some((o) => o.provider === "remote-outage"));
    resetTelemetry({ shared: true, outages: true });
  });

  it("clearing locally also clears the overlay and queues the command — no resurrection", () => {
    resetTelemetry({ shared: true, outages: true });
    applySharedOpsState(
      view({ outages: [{ provider: "p", expires_at: Date.now() + 60_000, note: "n" }] }),
      Date.now(),
    );
    assert.ok(outageFor("p"));
    assert.equal(clearOutage("p"), true, "an overlay-only outage is still a known outage");
    assert.equal(outageFor("p"), null, "cleared, not waiting for the next sync to disagree");
    const body = takePendingOps();
    assert.deepEqual(body.outages_cleared, ["p"]);
    resetTelemetry({ shared: true, outages: true });
  });

  it("set-after-clear in one batch keeps the set", () => {
    resetTelemetry({ shared: true, outages: true });
    simulateOutage("flip", 30_000);
    clearOutage("flip");
    simulateOutage("flip", 30_000);
    const body = takePendingOps();
    assert.equal(body.outages_set.length, 1);
    assert.deepEqual(body.outages_cleared, [], "the newer set must not ride with a stale clear");
    clearAllOutages();
    resetTelemetry({ shared: true, outages: true });
  });

  it("quota deltas accumulate per window and a reset supersedes them", () => {
    resetTelemetry({ shared: true });
    recordQuotaSpend("fmp", "2026-08-11");
    recordQuotaSpend("fmp", "2026-08-11");
    recordQuotaReset("fmp", "2026-08-11");
    const body = takePendingOps();
    assert.deepEqual(body.quota, [], "spend before a reset is meaningless to push");
    assert.deepEqual(body.quota_reset, [{ provider: "fmp", window: "2026-08-11" }]);
    resetTelemetry({ shared: true });
  });

  it("hydration replaces local counters and an explicit zero deletes one", () => {
    const s = new MemoryStore();
    s.incr("quota:fmp:2026-08-11", 86_400_000);
    hydrateQuotaLedger(
      [
        { provider: "fmp", window: "2026-08-11", spent: 7 },
        { provider: "tiingo", window: "2026-08-11", spent: 0 },
      ],
      s,
    );
    assert.equal(s.get("quota:fmp:2026-08-11"), 7, "shared total replaces the local count");
    assert.equal(s.get("quota:tiingo:2026-08-11"), undefined, "zero means a propagated reset");
  });

  it("the sync response validator refuses shapes the overlay cannot hold", () => {
    assert.equal(isSharedOpsView(view()), true);
    assert.equal(isSharedOpsView({ ...view(), schema_version: 2 }), false);
    assert.equal(isSharedOpsView({ ...view(), observed_at: "not-a-date" }), false);
    assert.equal(isSharedOpsView({ ...view(), latency: "nope" }), false);
    assert.equal(isSharedOpsView(null), false);
  });

  it("contract findings drain into the sync body with a per-instance seq, and a restore never doubles one", () => {
    resetTelemetry({ shared: true });
    queueContractFinding({
      capability: "quote", provider: "fmp", symbol: "AAPL", key: "quote:AAPL:*", passed: false,
      violations: [{ check: "quote.price_positive", severity: "fatal", message: "no positive price" }],
      notEvaluated: 1,
    });
    queueContractFinding({
      capability: "bars", provider: "massive", symbol: null, key: "bars:AAPL:1d:120:*", passed: true,
      violations: [], notEvaluated: 0,
    });
    const body = takePendingOps();
    assert.equal(body.findings.length, 2);
    assert.deepEqual(body.findings.map((f) => f.seq), [1, 2], "the seq is monotonic from this instance");
    assert.equal(body.findings[0].fatal, 1);
    assert.equal(body.findings[0].passed, false);
    assert.equal(body.findings[1].symbol, null);
    assert.deepEqual(takePendingOps().findings, [], "a drain empties the queue");
    // A push that failed after the drain: the body comes back, but a finding
    // queued meanwhile keeps its own seq, and re-restoring cannot double any.
    queueContractFinding({ capability: "quote", provider: "fmp", symbol: "MSFT", key: "k", passed: true, violations: [], notEvaluated: 0 });
    restorePendingOps(body);
    restorePendingOps(body);
    const again = takePendingOps();
    assert.deepEqual(again.findings.map((f) => f.seq), [1, 2, 3]);
    resetTelemetry({ shared: true });
  });

  it("a finding's message is redacted before it is queued", () => {
    resetTelemetry({ shared: true });
    registerSecret("hunter2hunter2hunter2");
    queueContractFinding({
      capability: "quote", provider: "alphavantage", symbol: "AAPL", key: "k", passed: true,
      violations: [{ check: "quote.freshness", severity: "warn", message: "stale — https://v.test/q?apikey=hunter2hunter2hunter2" }],
      notEvaluated: 0,
    });
    const [finding] = takePendingOps().findings;
    assert.doesNotMatch(finding.checks[0].message, /hunter2hunter2hunter2/);
    clearSecrets();
    resetTelemetry({ shared: true });
  });

  it("the merged quality ledger is read only while the overlay is fresh, and a missing block is null", () => {
    resetTelemetry({ shared: true });
    const now = Date.now();
    applySharedOpsState(view(), now, now);
    const ledger = sharedDataQuality(now);
    assert.ok(ledger, "a fresh sync carries the ledger");
    assert.equal(ledger!.backend, "sqlite");
    assert.equal(sharedDataQuality(now + SHARED_STALE_MS + 1), null, "a stale overlay is not believed");
    // An older gateway omits the block: guarded, not trusted.
    applySharedOpsState({ ...view(), data_quality: undefined as unknown as SharedOpsViewWire["data_quality"] }, now, now);
    assert.equal(sharedDataQuality(now), null);
    resetTelemetry({ shared: true });
  });
});
