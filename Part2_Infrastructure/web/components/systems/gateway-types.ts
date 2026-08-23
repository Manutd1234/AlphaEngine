/**
 * The FastAPI gateway's own wire contract, mirrored for the browser.
 *
 * Split out of `types.ts` when that file passed the length ceiling.
 * `types.ts` re-exports every name below, so no import path changed.
 *
 * `lib/reliability.ts` holds `isGatewayOpsSnapshot`, the runtime gate that
 * narrows an unknown payload to `GatewayOpsSnapshot` at the gateway boundary.
 * A required member added here without a matching check there is a snapshot
 * the runtime waves through untyped; a check there with no member here is a
 * snapshot the runtime rejects whole — which is how a starting Telegram bot
 * once became an UNKNOWN trading path. Nothing measures that correspondence as
 * of 2026-08-21 — the suite this named was gone, and the claim with it.
 */

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
    status: "running" | "starting" | "degraded" | "disabled";
    uptime_seconds: number;
    updates_handled: number;
    alerts_sent: number;
    last_error_present: boolean;
    /**
     * Why a degraded companion is degraded. "transport": its last call got no
     * answer. "conflict": Telegram refused getUpdates because another process
     * holds this token's long poll. "api": Telegram answered, and said no.
     * Absent or null beside an error on a gateway older than the field.
     */
    last_error_kind?: "transport" | "conflict" | "api" | null;
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
