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
  /**
   * Capabilities this key was refused (401/402/403), learned by dispatch on
   * the answering instance. Optional: an older health route omits it.
   */
  licence?: Array<{ capability: string; status: number | null; expiresAt: number }>;
  ready: boolean;
  statusDetail: string;
}

export type RouteState =
  | "ready"
  | "simulated_outage"
  | "not_configured"
  | "circuit_open"
  | "unlicensed"
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

/**
 * Authoritative operations snapshot emitted by the FastAPI gateway.
 *
 * Field names deliberately stay snake_case: this is a versioned wire contract,
 * not a view model. Keeping the gateway's names intact makes contract drift
 * visible and avoids a second, subtly different translation of operational
 * state in the Next.js tier.
 */
export type GatewayPlatformStatus = "nominal" | "degraded" | "critical" | "halted";

export interface GatewayMarketDataSymbol {
  symbol: string;
  age_seconds: number | null;
  updates_total: number;
  update_rate_hz: number;
  stale: boolean;
}

export interface GatewayMarketDataFeed {
  venue: string;
  status: "up" | "degraded" | "stale" | "down";
  connected: boolean;
  reconnects: number;
  uptime_seconds: number;
  error_present: boolean;
  synthetic: boolean;
  symbols: GatewayMarketDataSymbol[];
}

export interface GatewayOpsSnapshot {
  schema_version: 1;
  observed_at: string;
  stale_after_seconds: number;
  status: GatewayPlatformStatus;
  environment: string;
  version: string;
  market_data: {
    enabled: boolean;
    status: "nominal" | "degraded" | "critical" | "disabled";
    uptime_seconds: number;
    stale_after_seconds: number;
    synthetic_active: boolean;
    feeds: GatewayMarketDataFeed[];
  };
  risk: {
    status: "nominal" | "reduce_only" | "halted";
    kill_switch_active: boolean;
    halted_symbols: string[];
    reduce_only: boolean;
    orders_accepted_total: number;
    orders_rejected_total: number;
    working_orders: number;
    orders_last_second: number;
    daily_drawdown_pct: number;
    drawdown_budget_used_pct: number;
    equity: number;
    gross_exposure: number;
  };
  queue: {
    backend: string;
    /** Configured slots; a live distributed-worker heartbeat is not available yet. */
    workers: number;
    broker_configured: boolean;
    broker_transport: string | null;
    total: number;
    by_status: Record<string, number>;
  };
  audit: {
    backend: string;
    available: boolean;
  };
  telegram: {
    enabled: boolean;
    mode: string;
    status: "running" | "degraded" | "disabled";
    uptime_seconds: number;
    updates_handled: number;
    alerts_sent: number;
    last_error_present: boolean;
  };
  route_latency: {
    window_seconds: number;
    routes: Array<{
      route: string;
      p50_ms: number;
      p95_ms: number;
      p99_ms: number;
      samples: number;
      errors_total: number;
    }>;
  };
  /**
   * Supabase mirror counters, from `modules/operations.py`'s
   * `SupabaseMirrorSnapshot`.
   *
   * The gateway has been emitting this on every ops snapshot and nothing here
   * modelled it, so mirror lag, dropped rows and the classified last error
   * arrived at Vercel and were discarded — the durability of the Postgres
   * mirror was unobservable from the console whose job is observing things.
   *
   * Optional because the gateway omits it entirely when Supabase is not
   * configured, which is a different fact from `configured: false` (mirror off
   * on a gateway that supports it) and both differ from a mirror that is
   * configured and failing. `dropped` is the one that matters most: the queue
   * is bounded and drops rather than blocking the order path, so a non-zero
   * value means the Postgres blotter is silently incomplete.
   */
  supabase?: {
    configured: boolean;
    running: boolean;
    queued: number;
    written: number;
    failed: number;
    dropped: number;
    /** A closed vocabulary — never a URL, a key or raw error text. */
    last_error_kind: string | null;
  } | null;
  /**
   * The pre-trade decision's own clock, from `modules/operations.py`'s
   * `DecisionLatencySnapshot`: in-process, every sample since the gateway
   * process started (a histogram, not a window). Optional because a gateway
   * build that predates the field omits it; `null` is a state the gateway
   * itself never sends — the block is present with `samples: 0` before the
   * first order and its quantiles are null then, because quantiles of
   * nothing are not zeros (LATENCY_BUDGET §3). `core_*` is the compiled
   * engine's timing of the gate arithmetic alone — book consolidation,
   * sizing, exposure, drawdown and the routed slippage walk, but none of the
   * state reads or response construction around them — in nanoseconds; null
   * while the Python reference runs. It is never the same span as `*_us`.
   * The core histogram may include a startup self-measure of the same
   * compiled battery on a synthetic two-venue book — `core_self_test_samples`
   * says how many of its samples that contributed (null when there is no core
   * histogram at all); the `*_us` histogram never does, so `samples` counts
   * submitted orders only.
   */
  decision_latency?: DecisionLatency | null;
}

export interface DecisionLatency {
  engine: "native" | "python";
  samples: number;
  p50_us: number | null;
  p99_us: number | null;
  p999_us: number | null;
  max_us: number | null;
  core_p50_ns?: number | null;
  core_p99_ns?: number | null;
  core_max_ns?: number | null;
  core_self_test_samples?: number | null;
}

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
  /**
   * Set when the registry refused before dispatch: the capability does not
   * apply to the symbol's asset class. No provider was contacted, so
   * `attempts` and `upstream.calls` are empty and `provenance` is null.
   */
  reason?: "not_applicable";
  /** The asset classes the capability does answer for, when refused. */
  applicable?: string[];
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
    /** Optional: an older instance's cached provenance predates it. */
    quotaLimit?: number | null;
    quotaWindow: string | null;
    /** Contract result attached to this exact cached or upstream payload. */
    contract?: {
      passed: boolean;
      violations: Array<{ check: string; severity: string; message: string }>;
      notEvaluated: string[];
    };
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
  /**
   * Post-action snapshot from the instance that applied the action. The client
   * applies this instead of re-polling: a poll may route to a different lambda
   * whose in-memory ledgers never saw the mutation.
   */
  health?: SystemHealth;
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
  no_data: "no data for this symbol",
  unlicensed: "not licensed on this key",
  rate_limited: "rate-limited by the vendor",
  failed: "failed",
};

/**
 * Route-state presentation. Icon and word carry the meaning; colour reinforces.
 *
 * Typographic marks, not emoji. These were coloured circles, which meant the
 * house rule against emoji in the UI was broken in the one map every routing
 * surface reads from — so the violation appeared wherever a route state did.
 * A mark inherits the surrounding text colour and renders in the app's own
 * font; an emoji brings a vendor's palette with it and fights the theme.
 */
export const ROUTE_STATE_STYLE: Record<RouteState, { icon: string; label: string; tone: string }> = {
  ready: { icon: "●", label: "ONLINE (Ready)", tone: "var(--success-text)" },
  circuit_open: { icon: "✕", label: "OFFLINE (Circuit Open)", tone: "var(--critical-text)" },
  simulated_outage: { icon: "▲", label: "DEGRADED (Simulated Outage)", tone: "var(--notice-text)" },
  quota_exhausted: { icon: "▲", label: "DEGRADED (Quota Spent)", tone: "var(--warning-text)" },
  quota_reserved: { icon: "▲", label: "DEGRADED (Quota Reserved)", tone: "var(--warning-text)" },
  // An absence rather than a fault: the key is not entitled to this
  // capability. Same mark and tone as "not configured", and the words say
  // which capability and that the block is per instance.
  unlicensed: { icon: "○", label: "NOT LICENSED (This Key)", tone: "var(--text-secondary)" },
  not_configured: { icon: "○", label: "NOT CONFIGURED", tone: "var(--text-secondary)" },
};
