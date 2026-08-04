/**
 * Mirrors of the `/api/system/*` payloads.
 *
 * Hand-written rather than imported from the server modules on purpose: these
 * are the *wire* contract, and the browser should be typed against what the API
 * promises, not against the internals that currently happen to produce it. Every
 * field the console reads is optional-tolerant where a rolling deploy could
 * serve an older shape.
 */

export interface LatencyStats {
  n: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
  errorRate: number;
  lastAt: number | null;
}

export interface BreakerSnapshot {
  state: "closed" | "open" | "half_open";
  failures: number;
  threshold: number;
  openedAt: number | null;
  cooldownRemainingMs: number;
}

export interface QuotaState {
  used: number;
  limit: number;
  remaining: number;
  reserve: number;
  window: string;
}

export interface ProviderRow {
  id: string;
  label: string;
  docs: string;
  signup: string;
  capabilities: string[];
  assets: string[];
  keyEnv: string;
  configured: boolean;
  circuitOpen: boolean;
  quota: QuotaState | null;
  rank: Record<string, number>;
  breaker: BreakerSnapshot;
  latency: LatencyStats;
  simulatedOutage: { expiresAt: number; note: string } | null;
  ready: boolean;
  statusDetail: string;
}

export type RouteState =
  | "ready"
  | "simulated_outage"
  | "not_configured"
  | "circuit_open"
  | "quota_exhausted"
  | "quota_reserved";

export interface FailoverNode {
  provider: string;
  label: string;
  rank: number;
  state: RouteState;
  detail: string;
  latency: LatencyStats;
  active: boolean;
  /** Out-of-band health probe, where the provider has one. Absent on older payloads. */
  health?: { ok: boolean; detail: string } | null;
}

export interface FailoverRoute {
  capability: string;
  asset: string;
  nodes: FailoverNode[];
  activeProvider: string | null;
  cacheTtlMs: number;
}

export interface CacheCounters {
  hits: number;
  misses: number;
  hitRate: number | null;
}

export type GuardMode = "token" | "open-dev" | "locked";

export interface SystemHealth {
  fetchedAt: string;
  instance: { id: string; startedAt: string; uptimeMs: number; scope: string };
  guard: { mode: GuardMode; tokenEnv: string };
  summary: {
    total: number;
    configured: number;
    ready: number;
    degraded: string[];
    exhausted: string[];
    simulated: string[];
    latency: LatencyStats;
    cache: CacheCounters;
  };
  providers: ProviderRow[];
  venues: { id: string; label: string; latency: LatencyStats }[];
  routes: FailoverRoute[];
  routePriority: string;
  capabilities: Record<string, { available: string[]; unavailable: string[]; missing: string[] }>;
  outages: { provider: string; expiresAt: number; note: string }[];
  cache: {
    total: CacheCounters;
    byCapability: Record<string, CacheCounters>;
    entries: number;
    stateEntries: number;
    ttlMs: Record<string, number>;
  };
  events: { latest: number; oldest: number; retained: number; capacity: number };
  /**
   * Payloads that failed a data contract.
   *
   * Optional so a workspace deployed against an older gateway build degrades to
   * "no quarantine panel" rather than to a crash.
   */
  quarantine?: {
    size: number;
    byProvider: Array<{ provider: string; records: number; rejected: number }>;
    recent: Array<{
      seq: number;
      at: string;
      provider: string;
      capability: string;
      key: string;
      rejected: boolean;
      violations: Array<{ check: string; severity: string; message: string; observed?: string | number | null }>;
      sample: string;
    }>;
  };
}

export interface TraceEvent {
  seq: number;
  ts: number;
  level: "debug" | "info" | "warn" | "error";
  source: string;
  message: string;
  fields: Record<string, string | number | boolean | null>;
  origin: "server" | "browser";
}

export interface EventsResponse {
  fetchedAt: string;
  instance: string;
  cursor: { latest: number; oldest: number; retained: number; capacity: number };
  dropped: boolean;
  events: TraceEvent[];
}

export interface UpstreamCall {
  provider: string;
  method: string;
  url: string;
  status: number | null;
  ms: number;
  ok: boolean;
  error?: string;
  body?: { value: unknown; bytes: number; truncated: boolean };
}

export interface InspectResponse {
  fetchedAt: string;
  ok: boolean;
  symbol: string;
  asset: string;
  capability: string;
  totalMs: number;
  cache: {
    key: string;
    state: "hit" | "miss";
    configuredTtlMs: number;
    ttlRemainingMs: number | null;
    ageMs: number;
    refreshed: boolean;
  };
  lineage: { stage: string; detail: string; providers?: string[] }[];
  provenance: {
    provider: string;
    label: string;
    fetchedAt: string;
    latencyMs: number;
    cached: boolean;
    delayed: boolean;
    quotaRemaining: number | null;
    quotaWindow: string | null;
  } | null;
  attempts: { provider: string; reason: string; detail?: string }[];
  upstream: { captured: boolean; calls: UpstreamCall[]; note: string };
  data: unknown;
  error: string | null;
}

export interface ActionResponse {
  ok?: boolean;
  code?: string;
  error?: string;
  hint?: string;
  action?: string;
  summary?: string;
  caveat?: string;
  data?: Record<string, unknown>;
}

/** Human-readable labels for the reasons dispatch records against a skip. */
export const SKIP_LABEL: Record<string, string> = {
  not_configured: "no key",
  circuit_open: "circuit open",
  quota_exhausted: "quota spent",
  quota_reserved: "reserved for interactive",
  simulated_outage: "simulated outage",
  asset_unsupported: "asset unsupported",
  no_capability: "capability unsupported",
  failed: "failed",
};

/** Route-state presentation. Icon and word carry the meaning; colour reinforces. */
export const ROUTE_STATE_STYLE: Record<RouteState, { icon: string; label: string; tone: string }> = {
  ready: { icon: "●", label: "ready", tone: "var(--success-text)" },
  circuit_open: { icon: "✕", label: "circuit open", tone: "var(--critical-text)" },
  simulated_outage: { icon: "⏻", label: "simulated outage", tone: "var(--notice-text)" },
  quota_exhausted: { icon: "▲", label: "quota spent", tone: "var(--warning-text)" },
  quota_reserved: { icon: "▲", label: "quota reserved", tone: "var(--warning-text)" },
  not_configured: { icon: "◌", label: "not configured", tone: "var(--text-secondary)" },
};
