/**
 * The fixtures the reliability suites share.
 *
 * `deriveReliabilityPosture` reads a whole `SystemHealth`, so every assertion
 * about it needs a complete one — and the interesting part of any given test is
 * the two or three fields it overrides, not the eighty it does not. These
 * builders exist so that difference stays visible: a test says
 * `health({ platform: undefined })` and the reader sees the entire experiment.
 *
 * They live here rather than in one of the suites because four files now assert
 * against them, and a copied fixture is a fixture that drifts — the moment two
 * copies disagree about what "nominal" looks like, one of the suites is
 * guarding a deployment that does not exist.
 */

import type {
  GatewayOpsSnapshot,
  HealthSourceFreshness,
  SystemHealth,
} from "../../components/systems/types";

/** One fixed instant, so freshness is arithmetic rather than a race. */
export const NOW = Date.UTC(2026, 7, 6, 12, 0, 0);

/** A nominal gateway operations snapshot, one second old. */
export function platform(overrides: Partial<GatewayOpsSnapshot> = {}): GatewayOpsSnapshot {
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

/**
 * A freshness record in one of its four states. Only `fresh` and `stale` carry
 * an age — the other two never observed anything, and inventing a timestamp for
 * them is how a source that was never read reads as recently read.
 */
export function source(
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

/** A whole-deployment health payload with both planes nominal. */
export function health(overrides: Partial<SystemHealth> = {}): SystemHealth {
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

/**
 * Runs `run` with `values` in the environment and restores it afterwards,
 * deletions included — a leaked `ALPHAENGINE_GATEWAY_URL` would silently
 * configure a gateway for whichever file the runner reached next.
 */
export async function withEnvironment<T>(
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
