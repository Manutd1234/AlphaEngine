/**
 * Mirrors of the `/api/system/*` payloads.
 *
 * Hand-written rather than imported from the server modules on purpose: these
 * are the *wire* contract, and the browser should be typed against what the API
 * promises, not against the internals that currently happen to produce it. Every
 * field the console reads is optional-tolerant where a rolling deploy could
 * serve an older shape.
 *
 * This file passed the length ceiling and was cut into four along the seams the
 * payloads already had: provider identity and routing, the gateway's own
 * snapshot, and the inspection/trace payloads. It keeps the health envelope
 * itself — `SystemHealth` and the shapes only it holds — and re-exports every
 * name from the other three, EXHAUSTIVELY, so that `@/components/systems/types`
 * remains the single import path it has always been. A name added to a sibling
 * and not listed below is a name this module silently stops offering.
 */

import type { GatewayOpsSnapshot } from "./gateway-types";
import type { FailoverRoute, LatencyStats, ProviderRow } from "./provider-types";

export type {
  BreakerSnapshot,
  FailoverNode,
  FailoverRoute,
  LatencyStats,
  ProviderRow,
  QuotaState,
  RouteState,
} from "./provider-types";
export { ROUTE_STATE_STYLE } from "./provider-types";
export type {
  DecisionLatency,
  GatewayMarketDataFeed,
  GatewayMarketDataSymbol,
  GatewayOpsSnapshot,
  GatewayPlatformStatus,
} from "./gateway-types";
export type {
  EventsResponse,
  InspectResponse,
  TraceEvent,
  UpstreamCall,
} from "./inspect-types";
export { SKIP_LABEL } from "./inspect-types";

export interface CacheCounters {
  hits: number;
  misses: number;
  hitRate: number | null;
}

export interface ValidationCounts {
  /** Payloads evaluated in the bounded observation window. */
  evaluated: number;
  /** Evaluated payloads with no fatal violation; warnings and drift may remain. */
  passed: number;
  /** Individual findings/checks, not payload counts. */
  fatal: number;
  warn: number;
  drift: number;
  notEvaluated: number;
}

export interface ValidationTelemetry extends ValidationCounts {
  /**
   * `per-instance`: this function instance's ring buffer, reset on restart.
   * `gateway-ledger`: the durable, cross-instance ledger the gateway keeps
   * (SQLite on its data volume), merged from every instance's findings.
   */
  scope: "per-instance" | "gateway-ledger";
  windowStart: string | null;
  lastValidationAt: string | null;
  retained: number;
  /** The ring buffer's bound; null for the ledger, whose bound is a retention window, not a count. */
  capacity: number | null;
  byCapability: Partial<Record<string, ValidationCounts>>;
  byProvider: Record<string, ValidationCounts>;
  /** Present when the scope is the gateway ledger. */
  ledger?: {
    backend: "sqlite";
    retentionDays: number;
    windowMinutes: number;
    observedAt: string;
    instances: number;
    escalations: DataQualityEscalation[];
    recent: DataQualityFinding[];
    byProviderFailRate: Record<string, number | null>;
  };
}

export interface DataQualityFinding {
  id: number;
  observed_at: string;
  instance: string;
  source: "web" | "replay" | "backfill";
  capability: string;
  provider: string;
  symbol: string | null;
  key: string;
  passed: boolean;
  severity: "fatal" | "warn" | "drift" | "clean";
  checks: string[];
}

export interface DataQualityEscalation {
  id: number;
  rule: "fatal_burst" | "fail_rate";
  provider: string;
  opened_at: string;
  window_minutes: number;
  count: number;
  evaluated: number | null;
  detail: string;
  notified_at: string | null;
  channel: "telegram" | "log" | null;
  resolved_at: string | null;
  /** When someone took it. Null means nobody has. */
  acknowledged_at: string | null;
  /**
   * Who took it. `telegram:<user id>` names a person; `web:token` names a
   * credential and nothing more, and is rendered as such rather than as a name.
   */
  acknowledged_by: string | null;
}

export type GuardMode = "token" | "open-dev" | "open-demo" | "locked";

export type HealthSourceState = "fresh" | "stale" | "not_configured" | "unreachable" | "invalid";

/** Freshness belongs to each source; one current provider read cannot freshen an old gateway sample. */
export interface LatencyWindowSeries {
  key: string;
  /** Oldest first. `null` = too few calls in that bucket to state a figure. */
  p50: Array<number | null>;
  n: number[];
}

export interface LatencyWindow {
  startedAt: number;
  bucketMs: number;
  buckets: number;
  minSamplesPerBucket: number;
  series: LatencyWindowSeries[];
}

export interface HealthSourceFreshness {
  state: HealthSourceState;
  observedAt: string | null;
  receivedAt: string;
  ageMs: number | null;
  staleAfterMs: number | null;
  detail?: string;
}

export interface SystemHealth {
  /** Optional in the browser contract so an old route remains safe during a rolling deploy. */
  schemaVersion?: 2;
  fetchedAt: string;
  instance: {
    id: string;
    startedAt: string;
    uptimeMs: number;
    scope: string;
    /** Gateway-merged ledger state; absent on deployments predating the sync. */
    shared?: {
      backed: boolean;
      instances: string[];
      observedAt: string | null;
      ageMs: number | null;
      windowSeconds: number | null;
    };
  };
  guard: {
    mode: GuardMode;
    tokenEnv: string;
    /** Optional during rolling deploys; never contains the credential itself. */
    paperOrderDefaultAvailable?: boolean;
    /** Open mode with a server token set — typing a credential can elevate the tab. */
    tokenOverrideAvailable?: boolean;
  };
  summary: {
    total: number;
    configured: number;
    ready: number;
    degraded: string[];
    exhausted: string[];
    simulated: string[];
    /** The blended pool, kept for anything reading it before the split existed. */
    latency: LatencyStats;
    /** Upstream vendor + venue REST only — the tail the desk actually routes on. */
    upstreamLatency?: LatencyStats;
    /** The web→gateway hop the health poll itself pays. Optional so an older snapshot degrades. */
    gatewayHopLatency?: LatencyStats;
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
   * Authoritative trading-path state. Absent when the gateway is unavailable,
   * not configured, or an older gateway has not shipped schema v1 yet.
   */
  /**
   * Bucketed per-key latency history behind `summary.latency` and each
   * provider's scalars. OPTIONAL, per this file's rolling-deploy rule: an older
   * route simply degrades to "no sparkline" rather than to a crash.
   */
  latencyWindow?: LatencyWindow;
  platform?: GatewayOpsSnapshot;
  /** Per-source observation age; consumers must not infer freshness from fetchedAt alone. */
  sources?: {
    providers: HealthSourceFreshness;
    gateway: HealthSourceFreshness;
  };
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
  /** Bounded contract evidence from this function instance; absent on older deployments. */
  validation?: ValidationTelemetry;
  /** Delivery evidence derived server-side; schema bodies and credentials never reach the browser. */
  delivery?: {
    schema: {
      kind: "gateway_openapi";
      state: "match" | "mismatch" | "unavailable";
      passed: boolean;
      algorithm: "sha256";
      expectedDigest: string;
      observedDigest: string | null;
      detail: string;
    };
    /** Cross-engine Monte Carlo parity; absent on deployments predating it. */
    numerics?: {
      kind: "mc_parity";
      state: "match" | "mismatch";
      passed: boolean;
      algorithm: "sha256";
      expectedDigest: string;
      observedDigest: string;
      paths: number;
      horizonBars: number;
      detail: string;
    };
    build: {
      kind: "build_traceability";
      state: "traceable" | "unverified";
      passed: boolean;
      deploymentEnvironment: string | null;
      commitIdentity: string | null;
      // Never sent for build evidence — the digest belongs to artifact custody.
      // Typing it required here is what let the server and client drift apart.
      provenanceDigest?: string | null;
      detail: string;
    };
    artifact?: {
      kind: "artifact_custody";
      state: "attested" | "unsigned" | "untrusted" | "invalid" | "unverified";
      passed: boolean;
      algorithm: "ed25519";
      deploymentEnvironment: string | null;
      commitIdentity: string | null;
      detail: string;
    };
  };
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
  /**
   * Post-action snapshot from the instance that applied the action. The client
   * applies this instead of re-polling: a poll may route to a different lambda
   * whose in-memory ledgers never saw the mutation.
   */
  health?: SystemHealth;
}
