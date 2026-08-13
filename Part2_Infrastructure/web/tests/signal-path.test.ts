/**
 * The panel that claimed a FIX engine.
 *
 * `SignalDAGViewer` rendered a hardcoded array asserting a "FIX Protocol
 * Execution Engine … dispatching 35=D orders", a "Pre-Trade Risk Gateway (15
 * Gates)" and four string-literal latencies, above a pill that read
 * `{STEPS.length}/{STEPS.length} stages active` in green — 5/5 healthy by
 * construction, incapable of reporting a fault. There is no FIX anywhere in
 * this system.
 *
 * These are the properties that keep it honest, and every one of them was false
 * in the version this replaces:
 *
 *  1. Nothing is hardcoded — the stages come from the snapshot.
 *  2. A missing snapshot means "not observed", never "down" and never green.
 *  3. A dead gateway does not turn the things behind it red: you cannot read a
 *     component's health through a transport that is not answering.
 *  4. `not configured` stays distinct from `down`.
 *  5. A stage nothing measures says so instead of borrowing a number.
 *  6. The pill counts states, so it can go amber and red.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import type { SystemHealth } from "../components/systems/types";
import { deriveSignalPath, summariseSignalPath } from "../lib/signal-path";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const latency = (over: Partial<SystemHealth["summary"]["latency"]> = {}) => ({
  n: 40, p50: 30, p95: 90, p99: 120, max: 200, errorRate: 0, lastAt: Date.now(), ...over,
});

/** Only the fields the derivation reads; the rest of the contract is not its business. */
const health = (over: Record<string, unknown> = {}): SystemHealth =>
  ({
    fetchedAt: new Date().toISOString(),
    summary: {
      total: 8, configured: 8, ready: 8,
      degraded: [], exhausted: [], simulated: [],
      latency: latency(), cache: { hits: 0, misses: 0, hitRate: null },
    },
    providers: [],
    venues: [
      { id: "binance", label: "Binance", latency: latency() },
      { id: "bybit", label: "Bybit", latency: latency() },
    ],
    routes: [], routePriority: "", capabilities: {}, outages: [],
    cache: { total: { hits: 0, misses: 0, hitRate: null }, byCapability: {}, entries: 0, stateEntries: 0 },
    events: { latest: 0, oldest: 0, retained: 0, capacity: 600 },
    instance: { id: "i", startedAt: "", uptimeMs: 1, scope: "s" },
    guard: { mode: "open-demo", tokenEnv: "X" },
    ...over,
  } as unknown as SystemHealth);

const platform = (over: Record<string, unknown> = {}) => ({
  schema_version: 1, observed_at: "", stale_after_seconds: 30, status: "ok",
  environment: "test", version: "1",
  market_data: {}, queue: {}, telegram: {},
  risk: {
    status: "nominal", kill_switch_active: false, halted_symbols: [], reduce_only: false,
    orders_accepted_total: 12, orders_rejected_total: 3, working_orders: 1, orders_last_second: 0,
  },
  audit: { backend: "sqlite", available: true },
  route_latency: { window_seconds: 900, routes: [] },
  ...over,
});

const byId = (stages: ReturnType<typeof deriveSignalPath>, id: string) => {
  const found = stages.find((s) => s.id === id);
  assert.ok(found, `no stage ${id}`);
  return found;
};

describe("the signal path reports rather than asserts", () => {
  it("says nothing is observed when no snapshot has arrived", () => {
    const stages = deriveSignalPath(null, null);
    // The browser-side engine is the one thing a failed probe says nothing
    // about, so it stays healthy; everything the probe would have covered is
    // unknown, and none of it is claimed to be down.
    for (const id of ["venues", "registry", "gateway", "audit"]) {
      assert.equal(byId(stages, id).state, "unknown", `${id} should be unobserved`);
    }
    assert.equal(byId(stages, "engine").state, "ok");
    assert.equal(
      stages.filter((s) => s.state === "down").length,
      0,
      "a failed probe is not evidence that anything is broken",
    );
  });

  it("never reports green while it cannot see", () => {
    const summary = summariseSignalPath(deriveSignalPath(null, "fetch failed"));
    assert.notEqual(summary.tone, "good");
    assert.match(summary.label, /not observed/);
  });

  it("does not paint the stages behind a dead gateway as broken", () => {
    /**
     * The failure this prevents: one unreachable transport rendering three red
     * stages, which asserts three faults from a single missing measurement.
     */
    const stages = deriveSignalPath(
      health({ sources: { gateway: { state: "unreachable", observedAt: null, receivedAt: "", ageMs: null, staleAfterMs: null } } }),
      null,
    );
    assert.equal(byId(stages, "gateway").state, "down", "the transport itself is down");
    assert.equal(byId(stages, "audit").state, "unknown", "what it carries is unreadable, not broken");
    assert.equal(byId(stages, "venues").state, "ok", "venues are reached directly, not through the gateway");
  });

  it("keeps `not configured` distinct from `down`", () => {
    const stages = deriveSignalPath(
      health({ sources: { gateway: { state: "not_configured", observedAt: null, receivedAt: "", ageMs: null, staleAfterMs: null } } }),
      null,
    );
    assert.equal(byId(stages, "gateway").state, "absent");
    assert.notEqual(byId(stages, "gateway").state, "down");
  });

  it("withholds a figure for the stage nothing measures", () => {
    // The sweep runs in the visitor's browser, so no wire field carries a
    // timing for it. The previous version printed "0.5ms" here.
    const engine = byId(deriveSignalPath(health({ platform: platform() }), null), "engine");
    assert.equal(engine.measured, null);
    assert.match(engine.source, /client-side/);
  });

  it("refuses a percentile below the sample floor", () => {
    const thin = deriveSignalPath(
      health({ summary: { ...health().summary, latency: latency({ n: 4 }) } }),
      null,
    );
    assert.match(byId(thin, "registry").measured ?? "", /collecting · n=4 of 20/);
  });

  it("degrades the registry when only some providers route", () => {
    const stages = deriveSignalPath(
      health({ summary: { ...health().summary, ready: 2, degraded: ["fmp"] } }),
      null,
    );
    assert.equal(byId(stages, "registry").state, "degraded");
    assert.match(byId(stages, "registry").detail, /2 of 8/);
  });

  it("reads halted and reduce-only off the real risk state", () => {
    const halted = deriveSignalPath(health({ platform: platform({ risk: { ...platform().risk, status: "halted" } }) }), null);
    assert.equal(byId(halted, "gateway").state, "down");
    const reduced = deriveSignalPath(health({ platform: platform({ risk: { ...platform().risk, status: "reduce_only" } }) }), null);
    assert.equal(byId(reduced, "gateway").state, "degraded");
  });

  it("counts states in the pill instead of its own array length", () => {
    // `{STEPS.length}/{STEPS.length}` was green whatever happened.
    const ok = summariseSignalPath(deriveSignalPath(health({ platform: platform() }), null));
    assert.equal(ok.tone, "good");
    const bad = summariseSignalPath(deriveSignalPath(health({ platform: platform({ risk: { ...platform().risk, status: "halted" } }) }), null));
    assert.equal(bad.tone, "critical");
    assert.match(bad.label, /down/);
  });
});

describe("the fabricated claims stay gone", () => {
  const source = read("../components/research/SignalDAGViewer.tsx");
  const derivation = read("../lib/signal-path.ts");

  it("claims no FIX engine, because this system has none", () => {
    /**
     * Verified against the gateway when this was written: no `simplefix`, no
     * `quickfix`, no `35=` anywhere in Part2_Infrastructure. The gateway is
     * FastAPI speaking REST to Binance and Bybit. Naming a protocol the product
     * does not implement is the most expensive kind of wrong a panel can be,
     * because it is the kind a reader believes.
     */
    const rendered = source.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const claim of [/FIX/, /35=D/, /35=8/, /15 Gates/]) {
      assert.doesNotMatch(rendered, claim, `SignalDAGViewer still claims ${claim}`);
    }
  });

  it("hardcodes no latency, and takes its stages from the snapshot", () => {
    const rendered = source.replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(rendered, /latency:\s*"[\d.]+m?s"/, "a string-literal latency is not a measurement");
    assert.doesNotMatch(rendered, /const STEPS/, "the stage list must be derived, not declared");
    assert.match(rendered, /deriveSignalPath\(/);
  });

  it("prints a glyph and a word beside the colour", () => {
    assert.match(source, /STAGE_GLYPH\[/);
    assert.match(source, /STAGE_WORD\[/);
    assert.match(derivation, /export const STAGE_WORD/);
  });

  it("names the wire field behind every stage", () => {
    // Provenance is what makes the state checkable instead of merely plausible.
    for (const match of derivation.matchAll(/source:\s*"([^"]+)"/g)) {
      assert.ok(match[1].length > 3, "a stage cites an empty source");
    }
    assert.match(source, /Read from/);
  });
});
