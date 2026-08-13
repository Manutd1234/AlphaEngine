/**
 * The dependency tree, and the one mistake it exists to not make.
 *
 * A health tab's most expensive error is not missing a fault — it is inventing
 * four. When the gateway stops answering, every component behind it becomes
 * unreadable, and a tree that paints them red asserts five failures from one
 * missing measurement. An operator acting on that reading would go looking for
 * outages that never happened.
 *
 * So the properties here are almost all about restraint: cannot-see is not
 * broken, not-configured is not broken, and a state is only ever as strong as
 * the field it was read from.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  deriveDependencyTree,
  summariseTree,
  type DependencyNode,
} from "../lib/dependency-graph";
import type { SystemHealth } from "../components/systems/types";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const latency = (over = {}) =>
  ({ n: 50, p50: 20, p95: 60, p99: 90, max: 120, errorRate: 0, lastAt: Date.now(), ...over });

const health = (over: Record<string, unknown> = {}): SystemHealth =>
  ({
    fetchedAt: new Date().toISOString(),
    summary: {
      total: 2, configured: 2, ready: 2, degraded: [], exhausted: [], simulated: [],
      latency: latency(), cache: { hits: 0, misses: 0, hitRate: null },
    },
    providers: [
      { id: "binance", capabilities: ["quote"], configured: true, ready: true, circuitOpen: false,
        quota: null, statusDetail: "ready", latency: latency() },
      { id: "fmp", capabilities: ["fundamentals"], configured: false, ready: false, circuitOpen: false,
        quota: null, statusDetail: "no key", latency: latency({ n: 0 }) },
    ],
    venues: [{ id: "binance", label: "Binance", latency: latency() }],
    routes: [], routePriority: "", capabilities: {}, outages: [],
    cache: { total: { hits: 0, misses: 0, hitRate: null }, byCapability: {}, entries: 0, stateEntries: 0 },
    events: { latest: 0, oldest: 0, retained: 0, capacity: 600 },
    instance: { id: "i-1", startedAt: "", uptimeMs: 120_000, scope: "s" },
    guard: { mode: "open-demo", tokenEnv: "X" },
    ...over,
  } as unknown as SystemHealth);

const platform = (over: Record<string, unknown> = {}) => ({
  schema_version: 1, observed_at: "", stale_after_seconds: 30, status: "nominal",
  environment: "test", version: "1.2.3",
  market_data: { enabled: true, status: "nominal", uptime_seconds: 60, stale_after_seconds: 5,
    synthetic_active: false, feeds: [{ connected: true }, { connected: true }] },
  risk: { status: "nominal", kill_switch_active: false, halted_symbols: [], reduce_only: false,
    orders_accepted_total: 1, orders_rejected_total: 0, working_orders: 2, orders_last_second: 0 },
  queue: { backend: "celery", broker_configured: true, workers: 2, by_status: { queued: 0, running: 0 } },
  audit: { backend: "sqlite", available: true },
  telegram: {}, route_latency: { window_seconds: 900, routes: [] },
  supabase: { configured: true, running: true, queued: 0, written: 10, failed: 0, dropped: 0, last_error_kind: null },
  ...over,
});

/** Depth-first lookup, since the shape is a tree. */
function find(node: DependencyNode, id: string): DependencyNode | null {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const hit = find(child, id);
    if (hit) return hit;
  }
  return null;
}

describe("a dead transport is not five broken components", () => {
  it("marks the gateway down and everything behind it merely unobserved", () => {
    const tree = deriveDependencyTree(
      health({
        platform: platform(),
        sources: { gateway: { state: "unreachable", observedAt: null, receivedAt: "", ageMs: null, staleAfterMs: null } },
      }),
      null,
    );
    assert.equal(find(tree, "gateway")!.health, "down", "the transport itself IS down");
    for (const id of ["feeds", "risk", "audit", "queue", "mirror"]) {
      assert.equal(find(tree, id)!.health, "unknown", `${id} was painted as a fault`);
    }
  });

  it("leaves the venues alone, because they are not reached through the gateway", () => {
    const tree = deriveDependencyTree(
      health({
        platform: platform(),
        sources: { gateway: { state: "unreachable", observedAt: null, receivedAt: "", ageMs: null, staleAfterMs: null } },
      }),
      null,
    );
    assert.equal(find(tree, "venue:binance")!.health, "ok");
    assert.equal(find(tree, "registry")!.health, "ok");
  });

  it("reports nothing at all when the probe itself failed", () => {
    const tree = deriveDependencyTree(null, "fetch failed");
    assert.equal(tree.health, "unknown");
    assert.deepEqual(tree.children, []);
    assert.match(tree.detail, /fetch failed/);
  });
});

describe("not configured is not a fault", () => {
  it("keeps absent distinct from down for a provider with no key", () => {
    const tree = deriveDependencyTree(health({ platform: platform() }), null);
    assert.equal(find(tree, "provider:fmp")!.health, "absent");
    assert.equal(find(tree, "provider:binance")!.health, "ok");
  });

  it("distinguishes an older gateway build from a mirror that is switched off", () => {
    // Two different absences the Supabase comment insists on keeping apart.
    const older = deriveDependencyTree(health({ platform: platform({ supabase: undefined }) }), null);
    assert.match(find(older, "mirror")!.detail, /does not report the mirror/);
    const off = deriveDependencyTree(
      health({ platform: platform({ supabase: { configured: false, dropped: 0, last_error_kind: null } }) }),
      null,
    );
    assert.equal(find(off, "mirror")!.health, "absent");
    assert.match(find(off, "mirror")!.detail, /not configured/i);
  });

  it("treats a halted gateway as deliberate rather than as a crash", () => {
    /**
     * `halted` is an operator decision. Colouring it the same red as `critical`
     * would make a controlled stop indistinguishable from an outage, and send
     * someone hunting for a failure that is actually a choice.
     */
    const halted = deriveDependencyTree(health({ platform: platform({ status: "halted" }) }), null);
    assert.equal(find(halted, "gateway")!.health, "degraded");
    const crashed = deriveDependencyTree(health({ platform: platform({ status: "critical" }) }), null);
    assert.equal(find(crashed, "gateway")!.health, "down");
  });

  it("flags a mirror that is on and losing rows", () => {
    const lossy = deriveDependencyTree(
      health({ platform: platform({ supabase: { configured: true, dropped: 4, last_error_kind: null, written: 1, queued: 0 } }) }),
      null,
    );
    assert.equal(find(lossy, "mirror")!.health, "degraded");
    assert.match(find(lossy, "mirror")!.detail, /DROPPED/);
  });
});

describe("every node can be checked rather than trusted", () => {
  it("cites a wire field for each one", () => {
    const tree = deriveDependencyTree(health({ platform: platform() }), null);
    const walk = (node: DependencyNode) => {
      assert.ok(node.source.length > 3, `${node.id} cites no source`);
      for (const child of node.children ?? []) walk(child);
    };
    walk(tree);
  });

  it("claims no Oracle node, because SystemHealth carries no such field", () => {
    /**
     * A first pass wrote one on the strength of a claim that `health.oracle`
     * existed. It does not, and the typechecker caught it. This keeps the
     * absence deliberate: a node whose state is read from a field that is not
     * on the wire is the fabrication this whole tab exists to avoid.
     */
    const source = read("../lib/dependency-graph.ts");
    assert.doesNotMatch(source.replace(/\/\*[\s\S]*?\*\//g, ""), /health\.oracle/);
    assert.doesNotMatch(read("../components/systems/types.ts"), /^\s{2}oracle[?]?:/m);
  });
});

describe("the summary can go amber and red", () => {
  it("counts states rather than reporting a constant", () => {
    const healthy = summariseTree(deriveDependencyTree(health({ platform: platform() }), null));
    assert.ok(healthy.ok > 0);
    assert.equal(healthy.down, 0);

    const broken = summariseTree(deriveDependencyTree(
      health({ platform: platform({ status: "critical" }) }),
      null,
    ));
    assert.ok(broken.down > 0, "a critical gateway produced no down count");
  });
});
