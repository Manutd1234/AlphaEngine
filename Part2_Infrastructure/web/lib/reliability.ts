import type {
  GatewayOpsSnapshot,
  HealthSourceFreshness,
  SystemHealth,
} from "@/components/systems/types";
import { degradedCause } from "@/lib/dependency-graph";

/** Two missed default polls make a provider observation stale. */
export const PROVIDER_HEALTH_STALE_AFTER_MS = 60_000;
/** Health must stay responsive even when the trading plane is the incident. */
export const OPS_SNAPSHOT_TIMEOUT_MS = 1_500;
const MAX_FUTURE_CLOCK_SKEW_MS = 5_000;

export type ReliabilityStatus = "nominal" | "degraded" | "critical" | "halted" | "unknown";

export interface PathPosture {
  status: ReliabilityStatus;
  reason: string;
}

export interface ReliabilityPosture {
  overall: ReliabilityStatus;
  reason: string;
  paths: {
    trading: PathPosture;
    research: PathPosture;
    /** The alerting companion, on its own axis: never the money path. */
    notifications: PathPosture;
  };
}

interface GatewayFailureLike {
  code: string;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && isNonNegativeNumber(value);
}

function isEnum<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isCountMap(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every(isNonNegativeInteger);
}

function isMarketDataSymbol(value: unknown): boolean {
  return isRecord(value)
    && isString(value.symbol)
    && (value.age_seconds === null || isNonNegativeNumber(value.age_seconds))
    && isNonNegativeInteger(value.updates_total)
    && isNonNegativeNumber(value.update_rate_hz)
    && isBoolean(value.stale);
}

function isMarketDataFeed(value: unknown): boolean {
  return isRecord(value)
    && isString(value.venue)
    && isEnum(value.status, ["up", "degraded", "stale", "down"] as const)
    && isBoolean(value.connected)
    && isNonNegativeInteger(value.reconnects)
    && isNonNegativeNumber(value.uptime_seconds)
    && isBoolean(value.error_present)
    && isBoolean(value.synthetic)
    && Array.isArray(value.symbols)
    && value.symbols.every(isMarketDataSymbol);
}

function hasValidMarketData(value: unknown): boolean {
  return isRecord(value)
    && isBoolean(value.enabled)
    && isEnum(value.status, ["nominal", "degraded", "critical", "disabled"] as const)
    && isNonNegativeNumber(value.uptime_seconds)
    && isNonNegativeNumber(value.stale_after_seconds)
    && isBoolean(value.synthetic_active)
    && Array.isArray(value.feeds)
    && value.feeds.every(isMarketDataFeed);
}

function hasValidRisk(value: unknown): boolean {
  return isRecord(value)
    && isEnum(value.status, ["nominal", "reduce_only", "halted"] as const)
    && isBoolean(value.kill_switch_active)
    && isStringArray(value.halted_symbols)
    && isBoolean(value.reduce_only)
    && isNonNegativeInteger(value.orders_accepted_total)
    && isNonNegativeInteger(value.orders_rejected_total)
    && isNonNegativeInteger(value.working_orders)
    && isNonNegativeNumber(value.orders_last_second)
    && isFiniteNumber(value.daily_drawdown_pct)
    && isNonNegativeNumber(value.drawdown_budget_used_pct)
    && isFiniteNumber(value.equity)
    && isNonNegativeNumber(value.gross_exposure);
}

function hasValidQueue(value: unknown): boolean {
  return isRecord(value)
    && isString(value.backend)
    && isNonNegativeInteger(value.workers)
    && isBoolean(value.broker_configured)
    && (value.broker_transport === null || isString(value.broker_transport))
    && isNonNegativeInteger(value.total)
    && isCountMap(value.by_status);
}

function hasValidAudit(value: unknown): boolean {
  return isRecord(value) && isString(value.backend) && isBoolean(value.available);
}

function hasValidTelegram(value: unknown): boolean {
  return isRecord(value)
    && isBoolean(value.enabled)
    && isString(value.mode)
    && isEnum(value.status, ["running", "starting", "degraded", "disabled"] as const)
    && isNonNegativeNumber(value.uptime_seconds)
    && isNonNegativeInteger(value.updates_handled)
    && isNonNegativeInteger(value.alerts_sent)
    && isBoolean(value.last_error_present);
}

function isRouteLatency(value: unknown): boolean {
  return isRecord(value)
    && isString(value.route)
    && isNonNegativeNumber(value.p50_ms)
    && isNonNegativeNumber(value.p95_ms)
    && isNonNegativeNumber(value.p99_ms)
    && isNonNegativeInteger(value.samples)
    && isNonNegativeInteger(value.errors_total);
}

function hasValidRouteLatency(value: unknown): boolean {
  return isRecord(value)
    && isNonNegativeNumber(value.window_seconds)
    && Array.isArray(value.routes)
    && value.routes.every(isRouteLatency);
}

/** Runtime gate at the independently deployed gateway boundary. */
export function isGatewayOpsSnapshot(value: unknown): value is GatewayOpsSnapshot {
  if (!isRecord(value)) return false;
  const observedAt = isString(value.observed_at) ? Date.parse(value.observed_at) : Number.NaN;
  return value.schema_version === 1
    && Number.isFinite(observedAt)
    && isFiniteNumber(value.stale_after_seconds)
    && value.stale_after_seconds > 0
    && isEnum(value.status, ["nominal", "degraded", "critical", "halted"] as const)
    && isString(value.environment)
    && isString(value.version)
    && hasValidMarketData(value.market_data)
    && hasValidRisk(value.risk)
    && hasValidQueue(value.queue)
    && hasValidAudit(value.audit)
    && hasValidTelegram(value.telegram)
    && hasValidRouteLatency(value.route_latency);
}

/**
 * Describe the gateway source without borrowing freshness from the local route.
 * The returned object is computed only from its arguments, which lets route and
 * browser tests exercise timeout, drift, and clock-skew cases without a server.
 */
export function gatewaySourceFreshness(
  snapshot: GatewayOpsSnapshot | undefined,
  failure: GatewayFailureLike | undefined,
  receivedAtMs: number = Date.now(),
): HealthSourceFreshness {
  const receivedAt = new Date(receivedAtMs).toISOString();
  if (!snapshot) {
    const code = failure?.code ?? "gateway_invalid_payload";
    const state = code === "gateway_not_configured"
      ? "not_configured"
      : code === "gateway_invalid_payload" || code === "gateway_misconfigured"
        ? "invalid"
        : "unreachable";
    return {
      state,
      observedAt: null,
      receivedAt,
      ageMs: null,
      staleAfterMs: null,
      detail: failure?.error ?? "The gateway supplied no operations snapshot.",
    };
  }

  const observedAtMs = Date.parse(snapshot.observed_at);
  const staleAfterMs = snapshot.stale_after_seconds * 1_000;
  if (!Number.isFinite(observedAtMs) || observedAtMs - receivedAtMs > MAX_FUTURE_CLOCK_SKEW_MS) {
    return {
      state: "invalid",
      observedAt: snapshot.observed_at,
      receivedAt,
      ageMs: null,
      staleAfterMs,
      detail: "Gateway observation time is invalid or ahead of this server's clock.",
    };
  }

  const ageMs = Math.max(0, receivedAtMs - observedAtMs);
  const stale = ageMs > staleAfterMs;
  return {
    state: stale ? "stale" : "fresh",
    observedAt: snapshot.observed_at,
    receivedAt,
    ageMs,
    staleAfterMs,
    detail: stale
      ? `Gateway observation is older than its ${snapshot.stale_after_seconds}s freshness budget.`
      : "Gateway operations snapshot is current.",
  };
}

function sourceExpired(source: HealthSourceFreshness | undefined, nowMs: number): boolean {
  if (!source) return false;
  if (source.state === "stale") return true;
  if (source.state !== "fresh" || source.observedAt === null || source.staleAfterMs === null) return false;
  const observedAt = Date.parse(source.observedAt);
  return !Number.isFinite(observedAt) || nowMs - observedAt > source.staleAfterMs;
}

function tradingPosture(health: SystemHealth, nowMs: number): PathPosture {
  const source = health.sources?.gateway;
  if (sourceExpired(source, nowMs) || (!source && health.platform
    && nowMs - Date.parse(health.platform.observed_at) > health.platform.stale_after_seconds * 1_000)) {
    return { status: "unknown", reason: "Gateway telemetry is stale; the trading path cannot be classified safely." };
  }
  if (source?.state === "stale" || source?.state === "invalid") {
    return { status: "unknown", reason: source.detail ?? "Gateway telemetry is not trustworthy." };
  }
  if (source?.state === "unreachable") {
    return { status: "critical", reason: source.detail ?? "The configured trading gateway is unreachable." };
  }
  if (source?.state === "not_configured") {
    return { status: "unknown", reason: "No authoritative trading gateway is configured in this deployment." };
  }
  if (!health.platform) {
    return { status: "unknown", reason: "No authoritative trading-path snapshot is available." };
  }

  if (health.platform.status === "halted" || health.platform.risk.status === "halted"
    || health.platform.risk.kill_switch_active) {
    return { status: "halted", reason: "The authoritative risk gateway has halted trading." };
  }
  if (health.platform.status === "critical" || health.platform.market_data.status === "critical"
    || !health.platform.audit.available) {
    return { status: "critical", reason: "A critical component on the trading path is unavailable." };
  }
  if (health.platform.risk.status === "reduce_only" || health.platform.risk.reduce_only) {
    return { status: "degraded", reason: "The risk gateway is reduce-only; risk-increasing orders are blocked." };
  }
  if (health.platform.market_data.synthetic_active) {
    return { status: "degraded", reason: "The gateway is using synthetic market data and is not live-trading ready." };
  }
  if (health.platform.market_data.status === "disabled") {
    return { status: "degraded", reason: "Live market data is disabled, so trading readiness is restricted." };
  }
  if (health.platform.market_data.status === "degraded") {
    return { status: "degraded", reason: "Market data is available through a degraded venue-feed set." };
  }
  if (health.platform.status === "degraded") {
    // Name the disjunct rather than gesturing at "a supporting component", the
    // way the gateway card already does. Market data and risk are both answered
    // above, so in practice this is the queue — but ask `degradedCause` instead
    // of assuming, so a disjunct added later names itself here too.
    const cause = degradedCause(health.platform);
    return {
      status: "degraded",
      reason: cause
        ? `The trading path is degraded because ${cause}.`
        : "A supporting gateway component is degraded; inspect the component evidence.",
    };
  }
  return { status: "nominal", reason: "The authoritative trading path is current and nominal." };
}

function researchPosture(health: SystemHealth, nowMs: number): PathPosture {
  const source = health.sources?.providers;
  const fallbackObservedAt = Date.parse(health.fetchedAt);
  const fallbackStale = !source && (!Number.isFinite(fallbackObservedAt)
    || nowMs - fallbackObservedAt > PROVIDER_HEALTH_STALE_AFTER_MS);
  if (sourceExpired(source, nowMs) || fallbackStale || source?.state === "stale"
    || source?.state === "invalid" || source?.state === "unreachable") {
    return { status: "unknown", reason: "Research-provider telemetry is stale or unavailable." };
  }
  if (health.summary.configured <= 0) {
    return { status: "unknown", reason: "No research provider is configured." };
  }
  if (health.summary.ready <= 0) {
    return { status: "critical", reason: "Every configured research provider is unavailable." };
  }
  if (health.summary.ready < health.summary.configured || health.summary.degraded.length
    || health.summary.exhausted.length || health.summary.simulated.length) {
    return { status: "degraded", reason: "Research remains available through a reduced provider set." };
  }
  return { status: "nominal", reason: "Configured research providers are ready." };
}

/**
 * The notification plane: the Telegram companion, reported on its own axis.
 *
 * This used to reach the reader through `platform.status`, which the trading
 * posture reads — so one chat-transport blip announced a degraded TRADING path
 * to a desk whose orders were routing normally. Telegram is a companion that
 * pushes alerts; the risk gateway still gates and market data still flows
 * without it. Simply taking it off the money path would have made an outage
 * invisible instead of wrong, so it reports here as what it actually is.
 */
function notificationsPosture(health: SystemHealth, nowMs: number): PathPosture {
  const source = health.sources?.gateway;
  if (sourceExpired(source, nowMs) || source?.state === "stale" || source?.state === "invalid") {
    return { status: "unknown", reason: "Gateway telemetry is stale, so the notification plane cannot be classified." };
  }
  if (!health.platform) {
    return { status: "unknown", reason: "No authoritative snapshot reports the notification companion." };
  }
  const { telegram } = health.platform;
  if (telegram.status === "disabled") {
    return { status: "unknown", reason: "No Telegram notification companion is enabled in this deployment." };
  }
  if (telegram.status === "starting") {
    return { status: "unknown", reason: "The Telegram companion is enabled but has not finished starting." };
  }
  if (telegram.status === "degraded") {
    return {
      status: "degraded",
      reason: "The Telegram companion reports a transport error, so desk alerts may not be delivered. "
        + "Order routing, pre-trade risk and market data are unaffected.",
    };
  }
  return { status: "nominal", reason: `The Telegram companion is running in ${telegram.mode} mode.` };
}

/**
 * The one posture policy shared by every Reliability view.
 *
 * Three planes, ranked. A research outage never paints the money path critical,
 * a notification outage never paints either, and a provider-only demo never
 * calls itself nominal: it is explicitly degraded because trading has no
 * authoritative source. Stale monitoring is UNKNOWN, while a configured gateway
 * that cannot be reached is CRITICAL.
 */
export function deriveReliabilityPosture(
  health: SystemHealth,
  nowMs: number = Date.now(),
): ReliabilityPosture {
  const trading = tradingPosture(health, nowMs);
  const research = researchPosture(health, nowMs);
  const notifications = notificationsPosture(health, nowMs);
  const paths = { trading, research, notifications };
  const gatewayState = health.sources?.gateway.state;
  const providerOnly = !health.platform && (gatewayState === "not_configured" || !health.sources?.gateway);

  if (trading.status === "halted") return { overall: "halted", reason: trading.reason, paths };
  if (trading.status === "critical") return { overall: "critical", reason: trading.reason, paths };
  if (trading.status === "unknown" && !providerOnly) return { overall: "unknown", reason: trading.reason, paths };
  if (research.status === "unknown" && !providerOnly) return { overall: "unknown", reason: research.reason, paths };
  if (providerOnly) {
    const overall = research.status === "critical" ? "critical" : research.status === "unknown" ? "unknown" : "degraded";
    const reason = overall === "degraded"
      ? "Research providers are available, but no authoritative trading gateway is connected."
      : research.reason;
    return { overall, reason, paths };
  }
  if (trading.status === "degraded" || research.status !== "nominal") {
    const reason = trading.status === "degraded" ? trading.reason : research.reason;
    return { overall: "degraded", reason, paths };
  }
  // Ranked last, and only ever "degraded": an alerting outage is real and must
  // be said out loud, but it may not outrank — or impersonate — either plane
  // that carries orders. A disabled companion is a configuration, not a fault.
  if (notifications.status === "degraded") return { overall: "degraded", reason: notifications.reason, paths };
  return { overall: "nominal", reason: "Trading and research paths are current and nominal.", paths };
}
