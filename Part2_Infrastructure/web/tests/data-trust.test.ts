import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { InspectResponse, SystemHealth, ValidationTelemetry } from "../components/systems/types";
import {
  TRUST_MIN_SAMPLES,
  deriveDataTrust,
  deriveTrustSlis,
} from "../lib/data-trust";

const NOW = "2026-08-07T08:00:00.000Z";

function validation(overrides: Partial<ValidationTelemetry> = {}): ValidationTelemetry {
  return {
    scope: "per-instance",
    evaluated: 3,
    passed: 3,
    fatal: 0,
    warn: 0,
    drift: 0,
    notEvaluated: 0,
    windowStart: NOW,
    lastValidationAt: NOW,
    retained: 3,
    capacity: 500,
    byCapability: { quote: { evaluated: 3, passed: 3, fatal: 0, warn: 0, drift: 0, notEvaluated: 0 } },
    byProvider: { binance: { evaluated: 3, passed: 3, fatal: 0, warn: 0, drift: 0, notEvaluated: 0 } },
    ...overrides,
  };
}

function health(overrides: Partial<SystemHealth> = {}): SystemHealth {
  return {
    schemaVersion: 2,
    fetchedAt: NOW,
    instance: { id: "test-instance", startedAt: NOW, uptimeMs: 1_000, scope: "test" },
    guard: { mode: "locked", tokenEnv: "TEST_TOKEN" },
    summary: {
      total: 1,
      configured: 1,
      ready: 1,
      degraded: [],
      exhausted: [],
      simulated: [],
      latency: { n: 1, p50: 5, p95: 5, p99: 5, max: 5, errorRate: 0, lastAt: Date.parse(NOW) },
      cache: { hits: 0, misses: 1, hitRate: 0 },
    },
    providers: [],
    venues: [],
    routes: [],
    routePriority: "interactive",
    capabilities: {},
    outages: [],
    cache: {
      total: { hits: 0, misses: 1, hitRate: 0 },
      byCapability: {},
      entries: 1,
      stateEntries: 1,
      ttlMs: {},
    },
    events: { latest: 1, oldest: 1, retained: 1, capacity: 500 },
    sources: {
      providers: { state: "fresh", observedAt: NOW, receivedAt: NOW, ageMs: 0, staleAfterMs: 30_000 },
      gateway: { state: "not_configured", observedAt: null, receivedAt: NOW, ageMs: null, staleAfterMs: null },
    },
    validation: validation(),
    quarantine: { size: 0, byProvider: [], recent: [] },
    ...overrides,
  };
}

function probe(overrides: Partial<InspectResponse> = {}): InspectResponse {
  return {
    fetchedAt: NOW,
    ok: true,
    symbol: "BTCUSDT",
    asset: "crypto",
    capability: "quote",
    totalMs: 5,
    cache: {
      key: "quote:BTCUSDT:any",
      state: "miss",
      configuredTtlMs: 15_000,
      ttlRemainingMs: 14_999,
      ageMs: 0,
      refreshed: false,
    },
    lineage: [],
    provenance: {
      provider: "binance",
      label: "Binance",
      fetchedAt: NOW,
      latencyMs: 5,
      cached: false,
      delayed: false,
      quotaRemaining: null,
      quotaWindow: null,
      contract: { passed: true, violations: [], notEvaluated: [] },
    },
    attempts: [],
    upstream: { captured: false, calls: [], note: "" },
    data: { symbol: "BTCUSDT", price: 100 },
    error: null,
    ...overrides,
  };
}

describe("data trust posture is evidence-led", () => {
  it("keeps missing and zero validation evidence unknown", () => {
    assert.equal(deriveDataTrust(null).verdict.tone, "unknown");
    const model = deriveDataTrust(health({ validation: validation({ evaluated: 0, passed: 0, retained: 0 }) }));
    assert.equal(model.verdict.tone, "unknown");
    assert.match(model.verdict.detail, /Zero evidence is not a clean bill of health/i);
  });

  it("blocks retained fatal contract evidence", () => {
    const model = deriveDataTrust(health({
      validation: validation({ evaluated: 2, passed: 1, fatal: 1, retained: 2 }),
      quarantine: {
        size: 1,
        byProvider: [{ provider: "binance", records: 1, rejected: 1 }],
        recent: [],
      },
    }));
    assert.equal(model.verdict.tone, "bad");
    assert.match(model.verdict.label, /Block/);
    assert.equal(model.actions[0].destination, "quality");
    assert.equal(model.actions[0].priority, "now");
  });

  it("separates stale transport evidence from a clean contract sample", () => {
    const current = health();
    const model = deriveDataTrust(health({
      sources: {
        providers: current.sources!.providers,
        gateway: { state: "stale", observedAt: NOW, receivedAt: NOW, ageMs: 60_000, staleAfterMs: 15_000 },
      },
    }));
    assert.equal(model.verdict.tone, "warn");
    assert.equal(model.actions.find((action) => action.destination === "providers")?.priority, "review");
  });

  it("calls only the observed contract scope ready", () => {
    const model = deriveDataTrust(health(), { symbol: "BTCUSDT", probe: probe(), probeLoading: false });
    assert.equal(model.verdict.tone, "good");
    assert.equal(model.verdict.label, "Active quote checked");
    assert.match(model.verdict.detail, /exact miss payload from binance/i);
    assert.deepEqual(model.actions.map((action) => action.destination), ["quality", "lineage", "providers"]);
  });

  it("does not borrow aggregate evidence when the active payload has no contract result", () => {
    const withoutContract = probe({
      provenance: { ...probe().provenance!, contract: undefined },
    });
    const model = deriveDataTrust(health(), {
      symbol: "BTCUSDT",
      probe: withoutContract,
      probeLoading: false,
    });
    assert.equal(model.verdict.tone, "unknown");
    assert.match(model.verdict.detail, /no contract result for that exact payload/i);
  });

  it("fails closed when an exact contract says it did not pass", () => {
    const failedContract = probe({
      provenance: {
        ...probe().provenance!,
        contract: { passed: false, violations: [], notEvaluated: [] },
      },
    });
    const model = deriveDataTrust(health(), {
      symbol: "BTCUSDT",
      probe: failedContract,
      probeLoading: false,
    });
    assert.equal(model.verdict.tone, "bad");
    assert.match(model.verdict.label, /Block/);
  });

  it("treats a failed health refresh as unreachable even with a retained snapshot", () => {
    const model = deriveDataTrust(health(), { healthError: "HTTP 503" });
    assert.equal(model.verdict.tone, "bad");
    assert.match(model.verdict.label, /unreachable/i);
  });
});

/**
 * The four tiles on Trust Summary, three of which report something other than
 * what was asked for — because what was asked for is not measured here.
 *
 * The failure this guards against is the tempting one: shipping "Market feed
 * SLA 100%" computed from a target nobody defined, or "0 missing packets" from
 * a counter that does not exist. Both would read as strong evidence and be
 * fabrications. Renaming is the honest move, and these pin the rename.
 */
describe("trust SLIs report what is measured, not what was requested", () => {
  const health = (over: Record<string, unknown> = {}) =>
    ({
      fetchedAt: new Date().toISOString(),
      summary: { total: 8, configured: 8, ready: 8, degraded: [], exhausted: [], simulated: [],
        latency: { n: 100, p50: 20, p95: 80, p99: 120, max: 200, errorRate: 0, lastAt: Date.now() },
        cache: { hits: 0, misses: 0, hitRate: null } },
      providers: [], venues: [], routes: [], routePriority: "", capabilities: {}, outages: [],
      cache: { total: { hits: 0, misses: 0, hitRate: null }, byCapability: {}, entries: 0, stateEntries: 0 },
      events: { latest: 0, oldest: 0, retained: 0, capacity: 600 },
      instance: { id: "i", startedAt: "", uptimeMs: 1, scope: "s" },
      guard: { mode: "open-demo", tokenEnv: "X" },
      ...over,
    }) as unknown as Parameters<typeof deriveTrustSlis>[0];

  it("reports an absence rather than a clean bill when no gateway is observed", () => {
    // "0/0 fresh" and "0 reconnects" would both read as healthy. They are not
    // readings at all.
    const [books, reconnects] = deriveTrustSlis(health());
    for (const tile of [books, reconnects]) {
      assert.equal(tile.value, "—", `${tile.label} invented a value with no snapshot`);
      assert.equal(tile.tone, "unknown");
      assert.match(tile.note, /no gateway feed snapshot/);
    }
  });

  it("names what it counts instead of borrowing the requested name", () => {
    const labels = deriveTrustSlis(health()).map((s) => s.label);
    for (const forbidden of [/SLA/i, /packet/i, /uptime/i]) {
      assert.ok(
        !labels.some((label) => forbidden.test(label)),
        `a tile still claims ${forbidden} — none of those is measured here`,
      );
    }
    assert.deepEqual(labels, [
      "Books within freshness budget",
      "Feed reconnects",
      "Upstream attempt success",
      "Last observation",
    ]);
  });

  it("withholds a success rate below the sample floor", () => {
    const thin = deriveTrustSlis(health({
      summary: { ...(health() as unknown as { summary: Record<string, unknown> }).summary,
        latency: { n: 4, p50: 10, p95: 10, p99: 10, max: 10, errorRate: 0, lastAt: Date.now() } },
    }));
    const tile = thin.find((s) => s.label === "Upstream attempt success")!;
    assert.equal(tile.value, "Collecting");
    assert.match(tile.note, new RegExp(`4/${TRUST_MIN_SAMPLES}`));
    assert.equal(tile.tone, "unknown");
  });

  it("reads the gateway's observation time, never the fetch time", () => {
    /**
     * The trap `HealthSourceFreshness` exists to prevent: fetching the health
     * response does not make an old feed fresh. A tile keyed off `fetchedAt`
     * would report "0s ago" for a gateway that last spoke an hour earlier.
     */
    const observedAt = "2026-01-01T00:00:00.000Z";
    const tile = deriveTrustSlis(health({
      fetchedAt: "2026-06-01T00:00:00.000Z",
      sources: { gateway: { state: "fresh", observedAt, receivedAt: "", ageMs: 4_000, staleAfterMs: null } },
    })).find((s) => s.label === "Last observation")!;
    assert.equal(tile.value, "4s ago");
    assert.match(tile.note, /gateway observed 2026-01-01/);
  });

  it("falls back to the provider registry when no gateway is configured", () => {
    const tile = deriveTrustSlis(health({
      sources: { providers: { state: "fresh", observedAt: "2026-01-01T00:00:00.000Z", receivedAt: "", ageMs: 9_000, staleAfterMs: null } },
    })).find((s) => s.label === "Last observation")!;
    assert.match(tile.note, /provider registry observed/);
  });
});
