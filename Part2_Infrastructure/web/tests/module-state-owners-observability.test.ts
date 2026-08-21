/**
 * The observability stores, which used to be loose module variables.
 *
 * `LatencyRing`, `CacheLedger`, `OutageRegistry` and `OpsLedger` are what the
 * bare `let`s and `Map`s at the file scope of `lib/observability/` became. They
 * are grouped here because they answer one hazard together, and it has already
 * cost this repository a build:
 *
 *   **A singleton other modules hold cannot simply be replaced.** The old
 *   `export let shared` was swapped wholesale by `applySharedOpsState`, and
 *   three modules read it. They were safe only because each re-read the live
 *   binding on every call; one `const s = shared` at module scope in any of
 *   them would have pinned a stale overlay with no error anywhere.
 *
 * So the assertions below are behavioural rather than structural: a store that
 * bounds itself, hands out copies and resets IN PLACE cannot express that bug,
 * because there is no binding to swap and no shared array for a reader to
 * append to. Every "hands out a copy" and every "clears in place" test here is
 * that argument, not a defensive-programming habit.
 *
 * The structural guard on the other hazard — an exported `let` that a second
 * module writes — lives in `module-state-owners-exported-bindings`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CacheLedger } from "../lib/observability/cache";
import { LatencyRing } from "../lib/observability/latency";
import { OpsLedger } from "../lib/observability/ops-ledger";
import { OutageRegistry } from "../lib/observability/outages";

// --------------------------------------------------------------------------
// LatencyRing
// --------------------------------------------------------------------------

describe("LatencyRing bounds itself and hands out copies", () => {
  it("keeps only the newest `capacity` samples per key", () => {
    const ring = new LatencyRing(3);
    for (let i = 0; i < 5; i += 1) ring.record("p", { ts: i, ms: i, ok: true });
    assert.deepEqual(ring.samples("p").map((s) => s.ts), [2, 3, 4]);
  });

  it("keeps keys apart", () => {
    const ring = new LatencyRing();
    ring.record("a", { ts: 1, ms: 10, ok: true });
    ring.record("b", { ts: 1, ms: 20, ok: false });
    assert.deepEqual(ring.keys().sort(), ["a", "b"]);
    assert.equal(ring.samples("a").length, 1);
  });

  it("returns a copy, so a reader cannot append to the ring", () => {
    const ring = new LatencyRing(2);
    ring.record("p", { ts: 1, ms: 1, ok: true });
    ring.samples("p").push({ ts: 99, ms: 99, ok: false });
    assert.equal(ring.samples("p").length, 1);
  });

  it("reports an unknown key as empty rather than throwing", () => {
    assert.deepEqual(new LatencyRing().samples("absent"), []);
  });

  it("filters by cutoff without deleting anything", () => {
    const ring = new LatencyRing();
    ring.record("fresh", { ts: 1_000, ms: 5, ok: true });
    ring.record("stale", { ts: 10, ms: 5, ok: true });
    assert.deepEqual(ring.keysSince(500), ["fresh"]);
    assert.deepEqual(ring.keys().sort(), ["fresh", "stale"]);
  });

  it("clears in place, so every holder of the ring sees the reset", () => {
    const ring = new LatencyRing();
    ring.record("p", { ts: 1, ms: 1, ok: true });
    ring.clear();
    assert.deepEqual(ring.keys(), []);
  });
});

// --------------------------------------------------------------------------
// CacheLedger
// --------------------------------------------------------------------------

describe("CacheLedger counts lookups behind a method", () => {
  it("separates hits from misses per capability", () => {
    const ledger = new CacheLedger();
    ledger.record("quote", true);
    ledger.record("quote", true);
    ledger.record("quote", false);
    ledger.record("bars", false);
    assert.deepEqual(
      ledger.entries().sort((a, b) => a[0].localeCompare(b[0])),
      [["bars", { hits: 0, misses: 1 }], ["quote", { hits: 2, misses: 1 }]],
    );
  });

  it("hands out copied rows, so a reader cannot increment the ledger", () => {
    const ledger = new CacheLedger();
    ledger.record("quote", true);
    ledger.entries()[0][1].hits = 500;
    assert.deepEqual(ledger.entries(), [["quote", { hits: 1, misses: 0 }]]);
  });

  it("clears in place", () => {
    const ledger = new CacheLedger();
    ledger.record("quote", true);
    ledger.clear();
    assert.deepEqual(ledger.entries(), []);
  });
});

// --------------------------------------------------------------------------
// OutageRegistry
// --------------------------------------------------------------------------

describe("OutageRegistry owns this instance's block list", () => {
  const record = (provider: string) => ({ provider, expiresAt: 1_000, note: "drill" });

  it("stores and returns by provider", () => {
    const registry = new OutageRegistry();
    registry.set(record("fmp"));
    assert.equal(registry.get("fmp")?.note, "drill");
    assert.equal(registry.get("tiingo"), undefined);
  });

  it("reports whether a delete removed anything", () => {
    const registry = new OutageRegistry();
    registry.set(record("fmp"));
    assert.equal(registry.delete("fmp"), true);
    assert.equal(registry.delete("fmp"), false);
  });

  it("lists providers and clears in place", () => {
    const registry = new OutageRegistry();
    registry.set(record("fmp"));
    registry.set(record("tiingo"));
    assert.deepEqual(registry.providers().sort(), ["fmp", "tiingo"]);
    registry.clear();
    assert.deepEqual(registry.providers(), []);
  });
});

// --------------------------------------------------------------------------
// OpsLedger — the three exported bindings that became private fields
// --------------------------------------------------------------------------

const view = (over: Partial<Parameters<OpsLedger["applyShared"]>[0]> = {}) => ({
  schema_version: 1 as const,
  observed_at: new Date(1_000).toISOString(),
  window_seconds: 900,
  instances: ["a"],
  latency: [] as Array<{ key: string; samples: Array<{ ts: number; ms: number; ok: boolean }> }>,
  outages: [] as Array<{ provider: string; expires_at: number; note: string }>,
  quota: [] as Array<{ provider: string; window: string; spent: number }>,
  data_quality: null as never,
  ...over,
});

describe("OpsLedger keeps the overlay and the pending queues private", () => {
  it("reports no overlay until one is installed", () => {
    const ledger = new OpsLedger();
    assert.equal(ledger.fresh(Date.now()), false);
    assert.equal(ledger.status(Date.now()).backed, false);
    assert.deepEqual(ledger.sharedLatencyKeys(), []);
  });

  it("treats a missing overlay as `nothing has been drained`, not as time zero", () => {
    // `drainedAtMs` is read as "everything after this is missing from the
    // merge". A 0 here would declare every local sample missing and double-count
    // the whole window the first time an overlay arrived.
    assert.equal(new OpsLedger().drainedAtMs(), Infinity);
  });

  it("goes stale, and a stale overlay stops being the read model", () => {
    const ledger = new OpsLedger();
    ledger.applyShared(view(), 0, 1_000);
    assert.equal(ledger.fresh(1_000), true);
    assert.equal(ledger.fresh(1_000 + 90_001), false);
  });

  it("hands out copied samples, so the overlay cannot be appended to", () => {
    const ledger = new OpsLedger();
    ledger.applyShared(view({ latency: [{ key: "p", samples: [{ ts: 1, ms: 2, ok: true }] }] }), 0, 1_000);
    ledger.sharedSamples("p").push({ ts: 9, ms: 9, ok: false });
    assert.equal(ledger.sharedSamples("p").length, 1);
  });

  it("drains every queue into one body and empties itself", () => {
    const ledger = new OpsLedger();
    ledger.queueSample("p", { ts: 1, ms: 5, ok: true });
    ledger.queueQuotaSpend("fmp", "day", 3);
    const body = ledger.take();
    assert.deepEqual(body.latency, [{ key: "p", samples: [{ ts: 1, ms: 5, ok: true }] }]);
    assert.deepEqual(body.quota, [{ provider: "fmp", window: "day", spent: 3 }]);
    assert.deepEqual(ledger.take().latency, [], "a second drain must find nothing");
  });

  it("restores a failed push without duplicating a finding", () => {
    const ledger = new OpsLedger();
    ledger.queueFinding({
      capability: "quote", provider: "fmp", symbol: "AAPL", key: "k",
      passed: true, violations: [], notEvaluated: 0, at: 1,
    });
    const body = ledger.take();
    ledger.restore(body);
    ledger.restore(body);
    assert.equal(ledger.take().findings.length, 1, "the gateway keys on (instance, seq)");
  });

  it("lets a newer outage win over a clear queued earlier in the same batch", () => {
    const ledger = new OpsLedger();
    ledger.queueOutageCleared("fmp");
    ledger.queueOutage({ provider: "fmp", expiresAt: 9_000, note: "drill" });
    const body = ledger.take();
    assert.deepEqual(body.outages_cleared, []);
    assert.equal(body.outages_set.length, 1);
  });

  it("prunes an expired block out of the overlay on read", () => {
    const ledger = new OpsLedger();
    ledger.applyShared(
      view({ outages: [{ provider: "fmp", expires_at: 2_000, note: "drill" }] }),
      0,
      1_000,
    );
    assert.equal(ledger.sharedOutage("fmp", 1_500)?.note, "drill");
    assert.equal(ledger.sharedOutage("fmp", 2_500), null);
    assert.deepEqual(ledger.sharedOutageProviders(2_500), []);
  });

  it("resets in place rather than being replaced", () => {
    // The hazard the old `export let shared` carried: `applySharedOpsState`
    // swapped the binding, and three modules read it. Resetting a field cannot
    // strand a holder the way replacing the object could.
    const ledger = new OpsLedger();
    ledger.applyShared(view(), 0, 1_000);
    ledger.queueSample("p", { ts: 1, ms: 1, ok: true });
    ledger.reset();
    assert.equal(ledger.fresh(1_000), false);
    assert.deepEqual(ledger.take().latency, []);
  });

  it("clears this instance's latency without erasing the fleet's other keys", () => {
    // `clearLatency` empties the local queue and this instance's copy of the
    // merge. The gateway keeps the record; the next sync re-reads it.
    const ledger = new OpsLedger();
    ledger.applyShared(view({ latency: [{ key: "p", samples: [{ ts: 1, ms: 2, ok: true }] }] }), 0, 1_000);
    ledger.queueSample("p", { ts: 2, ms: 3, ok: true });
    ledger.clearLatency();
    assert.deepEqual(ledger.sharedLatencyKeys(), []);
    assert.deepEqual(ledger.take().latency, []);
    assert.equal(ledger.status(1_000).backed, true, "the overlay itself survives");
  });
});
