/**
 * The `SystemHealth` shapes the Trust Summary derivations are fed.
 *
 * Every builder here takes an override object and fills the rest, so a test
 * states only the field it is about — a provider that is circuit-open AND out
 * of quota, a feed with no uptime, a symbol with a null age. The point of the
 * defaults is that they are boring: whatever a test does not name is healthy,
 * so a failure can only have come from the field it named.
 *
 * `health()` casts, deliberately. The wire shape is pinned by
 * `tests/gateway-contract.test.ts` against the gateway's own OpenAPI document;
 * duplicating it here would be a second source of truth that could drift, and
 * the derivations under test read a handful of fields out of it.
 *
 * Shared by `data-trust-analytics-supply.test.ts` and
 * `data-trust-analytics-throughput.test.ts`. Kept in one file rather than
 * copied into both: two copies of `provider()` that disagree by one default is
 * a pair of suites asserting different things under the same names.
 */

import type {
  FailoverNode,
  FailoverRoute,
  GatewayMarketDataFeed,
  LatencyStats,
  ProviderRow,
  SystemHealth,
} from "../../components/systems/types";

export const NOW = "2026-08-13T08:00:00.000Z";

export const latency = (over: Partial<LatencyStats> = {}): LatencyStats => ({
  n: 0, p50: null, p95: null, p99: null, max: null, errorRate: 0, lastAt: null, ...over,
});

export function provider(over: Partial<ProviderRow> = {}): ProviderRow {
  return {
    id: "alphavantage",
    label: "Alpha Vantage",
    docs: "",
    signup: "",
    capabilities: ["quote"],
    assets: ["equity"],
    keyEnv: "ALPHAVANTAGE_API_KEY",
    configured: true,
    circuitOpen: false,
    quota: null,
    rank: {},
    breaker: { state: "closed", failures: 0, threshold: 5, openedAt: null, cooldownRemainingMs: 0 },
    latency: latency(),
    simulatedOutage: null,
    ready: true,
    statusDetail: "Configured and available for routing.",
    ...over,
  };
}

export function node(over: Partial<FailoverNode> = {}): FailoverNode {
  return {
    provider: "alphavantage",
    label: "Alpha Vantage",
    rank: 1,
    state: "ready",
    detail: "",
    latency: latency(),
    active: false,
    ...over,
  };
}

export function route(over: Partial<FailoverRoute> = {}): FailoverRoute {
  return { capability: "quote", asset: "equity", nodes: [node()], activeProvider: "alphavantage", cacheTtlMs: 15_000, ...over };
}

export function feed(over: Partial<GatewayMarketDataFeed> = {}): GatewayMarketDataFeed {
  return {
    venue: "binance",
    status: "up",
    connected: true,
    reconnects: 0,
    uptime_seconds: 71_264,
    error_present: false,
    synthetic: false,
    symbols: [
      { symbol: "BTCUSDT", age_seconds: 0.06, updates_total: 712_195, update_rate_hz: 10, stale: false },
    ],
    ...over,
  };
}

/** Only the fields a derivation reads; the wire shape is pinned elsewhere. */
export const health = (over: Record<string, unknown>): SystemHealth =>
  ({
    instance: { id: "lambda-a", startedAt: NOW, uptimeMs: 3_600_000, scope: "per-instance (in-memory fallback)" },
    providers: [],
    venues: [],
    routes: [],
    ...over,
  }) as unknown as SystemHealth;
