/**
 * The stores that used to be loose module variables now have owners.
 *
 * `lib/` held eight classes across 32,000 lines, three of which were typed
 * errors, while the genuinely stateful parts of it were bare `let`s and `Map`s
 * at file scope. That is not an argument for classes everywhere — the React
 * components below `components/` are function components and should stay that
 * way — but it is an argument for the handful of places where mutable state
 * existed with no owner and was written from a module that did not declare it.
 *
 * Two hazards motivate every assertion here, and both have already cost this
 * repository a build:
 *
 *   1. **An exported `let` assigned from another module is a compile error the
 *      moment the file is split.** `Cannot assign to 'x' because it is an
 *      import`. `lib/observability/ledger.ts` carries the scar in a comment: a
 *      reset that lived in `capture.ts` and wrote `shared = null` was legal
 *      inside one 1,133-line file and illegal the day the file became two.
 *
 *   2. **A singleton other modules hold cannot simply be replaced.** The old
 *      `export let shared` was swapped wholesale by `applySharedOpsState`, and
 *      three modules read it. They were safe only because each re-read the live
 *      binding on every call; one `const s = shared` at module scope in any of
 *      them would have pinned a stale overlay with no error anywhere.
 *
 * So the tests below are mostly behavioural — a store that bounds itself, hands
 * out copies, and resets in place cannot express either bug — plus one
 * structural guard on the first hazard, which is the only one a reader can
 * reintroduce in a single line.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { HostPreference } from "../lib/host-preference";
import { CacheLedger } from "../lib/observability/cache";
import { LatencyRing } from "../lib/observability/latency";
import { OpsLedger } from "../lib/observability/ops-ledger";
import { OutageRegistry } from "../lib/observability/outages";
import { SocketRegistry, type SocketHandle } from "../lib/socket-registry";

const root = fileURLToPath(new URL("..", import.meta.url));

// --------------------------------------------------------------------------
// The structural guard
// --------------------------------------------------------------------------

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.tsx?$/.test(entry) && !entry.includes("generated")) out.push(full);
  }
  return out;
}

describe("no module exports a mutable binding", () => {
  it("lib/ declares no `export let`", () => {
    const offenders: string[] = [];
    for (const file of sources(join(root, "lib"))) {
      readFileSync(file, "utf8").split("\n").forEach((line, index) => {
        if (/^export let /.test(line)) {
          offenders.push(`${file.slice(root.length)}:${index + 1} — ${line.trim().slice(0, 70)}`);
        }
      });
    }
    assert.deepEqual(
      offenders,
      [],
      "an exported `let` is assignable only from the module that declares it; "
        + "the moment a second module needs to write it, the split fails to compile. "
        + "Give the value an owner and export a method",
    );
  });
});

// --------------------------------------------------------------------------
// HostPreference — the memo three modules had each grown their own copy of
// --------------------------------------------------------------------------

describe("HostPreference remembers a host without pinning to it", () => {
  const HOSTS = ["https://primary", "https://mirror", "https://third"];

  it("starts on the declared order", () => {
    assert.deepEqual([...new HostPreference(HOSTS).ordered()], HOSTS);
  });

  it("moves the remembered host to the front and keeps the rest", () => {
    const pref = new HostPreference(HOSTS);
    pref.remember("https://mirror");
    assert.deepEqual(
      [...pref.ordered()],
      ["https://mirror", "https://primary", "https://third"],
      "the non-preferred hosts must still be walked; a preference that returns one host is a pin, "
        + "and one bad answer would strand the venue",
    );
  });

  it("ignores a host that is not in the list", () => {
    // The old write sites read `preferredHost = Math.max(0, HOSTS.indexOf(host))`,
    // which turned a miss into "prefer the primary" rather than "no change".
    const pref = new HostPreference(HOSTS);
    pref.remember("https://mirror");
    pref.remember("https://not-a-host");
    assert.equal(pref.preferred(), "https://mirror");
  });

  it("forgets on reset", () => {
    const pref = new HostPreference(HOSTS);
    pref.remember("https://third");
    pref.reset();
    assert.deepEqual([...pref.ordered()], HOSTS);
  });

  it("keeps two lists apart", () => {
    // The Map this replaces was keyed by a string with the host array passed in
    // separately, so an index learned for one venue could be applied to another.
    const a = new HostPreference(["https://a1", "https://a2"]);
    const b = new HostPreference(["https://b1", "https://b2"]);
    a.remember("https://a2");
    assert.equal(a.preferred(), "https://a2");
    assert.equal(b.preferred(), "https://b1");
  });
});

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

// --------------------------------------------------------------------------
// SocketRegistry
// --------------------------------------------------------------------------

function handle(registry: SocketRegistry, symbol: string): SocketHandle & { restarts: number } {
  const h = {
    id: registry.nextId(),
    venue: "BINANCE" as const,
    symbol,
    openedAt: 0,
    restarts: 0,
    restart() { h.restarts += 1; },
    stop() { registry.remove(h.id); },
  };
  return h;
}

describe("SocketRegistry publishes whenever it changes", () => {
  it("hands out a distinct id per socket", () => {
    // StrictMode mounts, unmounts and remounts every effect, so two sockets for
    // the same venue and symbol exist briefly. Keying on venue+symbol would have
    // the second overwrite the first, and the first's cleanup delete the second.
    const registry = new SocketRegistry();
    const a = handle(registry, "BTCUSDT");
    const b = handle(registry, "BTCUSDT");
    registry.add(a);
    registry.add(b);
    assert.notEqual(a.id, b.id);
    assert.equal(registry.size(), 2);
  });

  it("notifies subscribers on add and on remove", () => {
    const registry = new SocketRegistry();
    let notifications = 0;
    const unsubscribe = registry.subscribe(() => { notifications += 1; });
    const a = handle(registry, "BTCUSDT");
    registry.add(a);
    registry.remove(a.id);
    assert.equal(notifications, 2);
    unsubscribe();
    registry.add(handle(registry, "ETHUSDT"));
    assert.equal(notifications, 2, "an unsubscribed listener must stop being called");
  });

  it("keeps the snapshot referentially stable between changes", () => {
    // `useSyncExternalStore` re-renders forever if `getSnapshot` returns a fresh
    // array on every read, so this is a correctness property, not an
    // optimisation.
    const registry = new SocketRegistry();
    registry.add(handle(registry, "BTCUSDT"));
    assert.equal(registry.read(), registry.read());
    const before = registry.read();
    registry.add(handle(registry, "ETHUSDT"));
    assert.notEqual(registry.read(), before);
  });

  it("summarises without exposing the handles", () => {
    const registry = new SocketRegistry();
    registry.add(handle(registry, "BTCUSDT"));
    const [summary] = registry.read();
    assert.deepEqual(Object.keys(summary).sort(), ["id", "openedAt", "symbol", "venue"]);
  });

  it("restarts every live socket and reports how many cycled", () => {
    const registry = new SocketRegistry();
    const a = handle(registry, "BTCUSDT");
    const b = handle(registry, "ETHUSDT");
    registry.add(a);
    registry.add(b);
    assert.equal(registry.restartAll(), 2);
    assert.equal(a.restarts, 1);
    assert.equal(b.restarts, 1);
    assert.equal(registry.size(), 2, "a restart is a re-handshake, not a close");
  });

  it("reports an empty registry as empty rather than as loading", () => {
    assert.deepEqual(new SocketRegistry().read(), []);
  });
});
