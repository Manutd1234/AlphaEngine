/**
 * The runtime gate at the independently deployed gateway boundary.
 *
 * Every field of the operations snapshot is checked by shape before the desk
 * reasons about it — a payload from a gateway a version ahead or behind is
 * refused as a whole rather than read in part. Split out of `reliability.ts`
 * when that file passed the length ceiling: this is the wire, that is the
 * posture, and neither needs the other's helpers.
 */

import type { GatewayOpsSnapshot } from "@/components/systems/types";

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
    && isBoolean(value.last_error_present)
    && (value.last_error_kind == null || isEnum(value.last_error_kind, ["transport", "conflict", "api"] as const));
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
