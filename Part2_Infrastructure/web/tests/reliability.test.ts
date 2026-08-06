import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NextRequest } from "next/server";

import { GET } from "../app/api/system/health/route";
import type {
  GatewayOpsSnapshot,
  HealthSourceFreshness,
  SystemHealth,
} from "../components/systems/types";
import {
  deriveReliabilityPosture,
  gatewaySourceFreshness,
  isGatewayOpsSnapshot,
  OPS_SNAPSHOT_TIMEOUT_MS,
} from "../lib/reliability";

const NOW = Date.UTC(2026, 7, 6, 12, 0, 0);

function platform(overrides: Partial<GatewayOpsSnapshot> = {}): GatewayOpsSnapshot {
  return {
    schema_version: 1,
    observed_at: new Date(NOW - 1_000).toISOString(),
    stale_after_seconds: 15,
    status: "nominal",
    environment: "paper",
    version: "1.0.0",
    market_data: {
      enabled: true,
      status: "nominal",
      uptime_seconds: 600,
      stale_after_seconds: 5,
      synthetic_active: false,
      feeds: [{
        venue: "binance",
        status: "up",
        connected: true,
        reconnects: 0,
        uptime_seconds: 600,
        error_present: false,
        synthetic: false,
        symbols: [{
          symbol: "BTCUSDT",
          age_seconds: 0.2,
          updates_total: 300,
          update_rate_hz: 4,
          stale: false,
        }],
      }],
    },
    risk: {
      status: "nominal",
      kill_switch_active: false,
      halted_symbols: [],
      reduce_only: false,
      orders_accepted_total: 10,
      orders_rejected_total: 2,
      working_orders: 1,
      orders_last_second: 0,
      daily_drawdown_pct: -0.2,
      drawdown_budget_used_pct: 0.1,
      equity: 1_000_000,
      gross_exposure: 100_000,
    },
    queue: {
      backend: "threadpool",
      workers: 2,
      broker_configured: false,
      broker_transport: null,
      total: 0,
      by_status: { queued: 0, running: 0, succeeded: 0, failed: 0, cancelled: 0 },
    },
    audit: { backend: "sqlite", available: true },
    telegram: {
      enabled: false,
      mode: "disabled",
      status: "disabled",
      uptime_seconds: 0,
      updates_handled: 0,
      alerts_sent: 0,
      last_error_present: false,
    },
    route_latency: {
      window_seconds: 900,
      routes: [{
        route: "/api/orders",
        p50_ms: 0.5,
        p95_ms: 1.2,
        p99_ms: 1.2,
        samples: 4,
        errors_total: 0,
      }],
    },
    ...overrides,
  };
}

function source(
  state: HealthSourceFreshness["state"],
  observedAt = new Date(NOW - 1_000).toISOString(),
): HealthSourceFreshness {
  return {
    state,
    observedAt: state === "fresh" || state === "stale" ? observedAt : null,
    receivedAt: new Date(NOW).toISOString(),
    ageMs: state === "fresh" || state === "stale" ? 1_000 : null,
    staleAfterMs: state === "fresh" || state === "stale" ? 15_000 : null,
  };
}

function health(overrides: Partial<SystemHealth> = {}): SystemHealth {
  return {
    schemaVersion: 2,
    fetchedAt: new Date(NOW).toISOString(),
    instance: { id: "test", startedAt: new Date(NOW - 60_000).toISOString(), uptimeMs: 60_000, scope: "test" },
    guard: { mode: "locked", tokenEnv: "ALPHAENGINE_OPERATOR_TOKEN" },
    summary: {
      total: 2,
      configured: 1,
      ready: 1,
      degraded: [],
      exhausted: [],
      simulated: [],
      latency: { n: 0, p50: null, p95: null, p99: null, max: null, errorRate: 0, lastAt: null },
      cache: { hits: 0, misses: 0, hitRate: null },
    },
    providers: [],
    venues: [],
    routes: [],
    routePriority: "background",
    capabilities: {},
    outages: [],
    cache: {
      total: { hits: 0, misses: 0, hitRate: null },
      byCapability: {},
      entries: 0,
      stateEntries: 0,
      ttlMs: {},
    },
    events: { latest: 0, oldest: 0, retained: 0, capacity: 0 },
    platform: platform(),
    sources: { providers: source("fresh"), gateway: source("fresh") },
    ...overrides,
  };
}

async function withEnvironment<T>(
  values: Record<string, string | undefined>,
  run: () => Promise<T>,
): Promise<T> {
  const before = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("gateway operations snapshot contract", () => {
  it("accepts schema v1 and rejects silent contract drift", () => {
    assert.equal(isGatewayOpsSnapshot(platform()), true);
    assert.equal(isGatewayOpsSnapshot({ ...platform(), schema_version: 2 }), false);
    assert.equal(isGatewayOpsSnapshot({ ...platform(), queue: { ...platform().queue, workers: "two" } }), false);
    assert.equal(isGatewayOpsSnapshot({ ...platform(), observed_at: "yesterday-ish" }), false);
  });

  it("classifies age independently from transport reachability", () => {
    assert.equal(gatewaySourceFreshness(platform(), undefined, NOW).state, "fresh");
    assert.equal(gatewaySourceFreshness(
      platform({ observed_at: new Date(NOW - 16_000).toISOString() }),
      undefined,
      NOW,
    ).state, "stale");
    assert.equal(gatewaySourceFreshness(undefined, {
      code: "gateway_not_configured",
      error: "not configured",
    }, NOW).state, "not_configured");
    assert.equal(gatewaySourceFreshness(undefined, {
      code: "gateway_timeout",
      error: "timed out",
    }, NOW).state, "unreachable");
  });
});

describe("reliability posture keeps the trading and research planes separate", () => {
  it("reports nominal only when both current paths are nominal", () => {
    const posture = deriveReliabilityPosture(health(), NOW);
    assert.equal(posture.overall, "nominal");
    assert.equal(posture.paths.trading.status, "nominal");
    assert.equal(posture.paths.research.status, "nominal");
  });

  it("treats a configured unreachable gateway as critical", () => {
    const input = health({
      platform: undefined,
      sources: { providers: source("fresh"), gateway: source("unreachable") },
    });
    const posture = deriveReliabilityPosture(input, NOW);
    assert.equal(posture.overall, "critical");
    assert.equal(posture.paths.trading.status, "critical");
    assert.equal(posture.paths.research.status, "nominal");
  });

  it("never paints stale monitoring green", () => {
    const old = new Date(NOW - 60_000).toISOString();
    const input = health({
      platform: platform({ observed_at: old }),
      sources: { providers: source("fresh"), gateway: source("stale", old) },
    });
    assert.equal(deriveReliabilityPosture(input, NOW).overall, "unknown");
  });

  it("reports an authoritative trading halt", () => {
    const halted = platform({
      status: "halted",
      risk: { ...platform().risk, status: "halted", kill_switch_active: true },
    });
    const posture = deriveReliabilityPosture(health({ platform: halted }), NOW);
    assert.equal(posture.overall, "halted");
    assert.equal(posture.paths.trading.status, "halted");
  });

  it("degrades a provider-only deployment instead of calling it nominal", () => {
    const input = health({
      platform: undefined,
      sources: { providers: source("fresh"), gateway: source("not_configured") },
    });
    const posture = deriveReliabilityPosture(input, NOW);
    assert.equal(posture.overall, "degraded");
    assert.equal(posture.paths.trading.status, "unknown");
    assert.equal(posture.paths.research.status, "nominal");
  });

  it("does not turn a research-only outage into a trading outage", () => {
    const base = health();
    const posture = deriveReliabilityPosture(health({
      summary: { ...base.summary, ready: 0 },
    }), NOW);
    assert.equal(posture.overall, "degraded");
    assert.equal(posture.paths.trading.status, "nominal");
    assert.equal(posture.paths.research.status, "critical");
  });
});

describe("the aggregate health route fails open for local observability", () => {
  it("returns provider health when no gateway is configured", async () => {
    await withEnvironment({
      NODE_ENV: "test",
      ALPHAENGINE_GATEWAY_URL: undefined,
      OPENBB_API_URL: undefined,
    }, async () => {
      const response = await GET(new NextRequest("http://local.test/api/system/health?priority=background"));
      const body = await response.json() as SystemHealth;
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(body.schemaVersion, 2);
      assert.ok(body.providers.length > 0, "provider matrix was lost with the gateway");
      assert.equal(body.platform, undefined);
      assert.equal(body.sources?.gateway.state, "not_configured");
    });
  });

  it("returns provider health and a critical source signal when the configured gateway is down", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new TypeError("offline"); };
    try {
      await withEnvironment({
        NODE_ENV: "test",
        ALPHAENGINE_GATEWAY_URL: "https://gateway.invalid",
        OPENBB_API_URL: undefined,
      }, async () => {
        const response = await GET(new NextRequest("http://local.test/api/system/health"));
        const body = await response.json() as SystemHealth;
        assert.equal(response.status, 200);
        assert.ok(body.providers.length > 0);
        assert.equal(body.platform, undefined);
        assert.equal(body.sources?.gateway.state, "unreachable");
        assert.equal(deriveReliabilityPosture(body, Date.parse(body.fetchedAt)).paths.trading.status, "critical");
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("attaches a validated gateway snapshot without extending the timeout budget", async () => {
    const current = platform({ observed_at: new Date().toISOString() });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify(current), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    try {
      await withEnvironment({
        NODE_ENV: "test",
        ALPHAENGINE_GATEWAY_URL: "https://gateway.example.test",
        OPENBB_API_URL: undefined,
      }, async () => {
        const response = await GET(new NextRequest("http://local.test/api/system/health"));
        const body = await response.json() as SystemHealth;
        assert.equal(body.platform?.schema_version, 1);
        assert.equal(body.sources?.gateway.state, "fresh");
        assert.ok(OPS_SNAPSHOT_TIMEOUT_MS <= 2_000, "health waits too long on the failed dependency it diagnoses");
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
