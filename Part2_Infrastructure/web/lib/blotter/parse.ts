import { BlotterRow, GateCheck, OrderStatus, RiskEventRow, WorkingOrderRow } from "./types";

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function num(value: unknown): number | null {
  // `Number(null)` and `Number("")` are both 0, which is the exact failure this
  // module exists to avoid: a rejected order has no fee, and reporting one of
  // $0.00 puts a free execution into the desk's cost average.
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseChecks(raw: unknown): GateCheck[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) return [];
      const record = entry as Record<string, unknown>;
      const name = str(record.name);
      if (!name) return [];
      return [{ name, passed: record.passed === true, detail: str(record.detail) }];
    });
  } catch {
    // A check vector that will not parse is worth nothing but must not take the
    // blotter row with it — the outcome columns are still true.
    return [];
  }
}

export function toBlotterRow(raw: unknown): BlotterRow | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const symbol = str(row.symbol);
  const ts = str(row.ts);
  if (!symbol || !ts) return null;

  const rejectedBy = str(row.rejected_by);
  return {
    ts,
    orderId: str(row.order_id) ?? "—",
    clientOrderId: str(row.client_order_id),
    strategy: str(row.strategy),
    symbol,
    side: str(row.side) ?? "—",
    orderType: str(row.order_type),
    quantity: num(row.quantity),
    notional: num(row.notional),
    accepted: row.accepted === true,
    // The gateway stores every gate that fired as one comma-joined string.
    rejectedBy: rejectedBy ? rejectedBy.split(",").map((s) => s.trim()).filter(Boolean) : [],
    reason: str(row.reason),
    latencyMs: num(row.latency_ms),
    fillPrice: num(row.fill_price),
    feeUsd: num(row.fee_usd),
    slippageBps: num(row.slippage_bps),
    venue: str(row.venue),
    source: str(row.source),
    // Derived, not required. Rows written before the order lifecycle existed
    // carry no status, and back then an accepted order *was* a filled order —
    // so the fallback is exact for legacy rows rather than a guess.
    status: (str(row.status) as OrderStatus | null) ?? (row.accepted === true ? "FILLED" : "REJECTED"),
    timeInForce: str(row.time_in_force),
    checks: parseChecks(row.checks_json),
  };
}

export function toWorkingOrder(raw: unknown): WorkingOrderRow | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const symbol = str(row.symbol);
  const orderId = str(row.order_id);
  const acceptedAt = str(row.accepted_at);
  const quantity = num(row.quantity);
  const limitPrice = num(row.limit_price);
  // A resting order without a price or a size is not a resting order. Rendering
  // one with "—" in those columns would put an order on screen that the gateway
  // could not have accepted.
  if (!symbol || !orderId || !acceptedAt || quantity == null || limitPrice == null) return null;

  return {
    orderId,
    clientOrderId: str(row.client_order_id),
    symbol,
    side: str(row.side) ?? "—",
    orderType: str(row.order_type) ?? "LIMIT",
    timeInForce: str(row.time_in_force) ?? "GTC",
    quantity,
    limitPrice,
    notional: num(row.notional) ?? quantity * limitPrice,
    strategy: str(row.strategy),
    source: str(row.source),
    status: "WORKING",
    acceptedAt,
    ageSeconds: num(row.age_seconds) ?? 0,
    markPrice: num(row.mark_price),
    distanceBps: num(row.distance_bps),
    expiresAt: str(row.expires_at),
  };
}

export function toRiskEvent(raw: unknown): RiskEventRow | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const event = str(row.event);
  const ts = str(row.ts);
  if (!event || !ts) return null;
  return {
    ts,
    event,
    severity: str(row.severity) ?? "info",
    actor: str(row.actor),
    symbol: str(row.symbol),
    detail: str(row.detail),
  };
}

/** Desk-level execution quality over whatever the blotter is currently showing. */
export interface ExecutionSummary {
  orders: number;
  accepted: number;
  rejected: number;
  fillRate: number | null;
  avgSlippageBps: number | null;
  worstSlippageBps: number | null;
  totalFees: number;
  p50LatencyMs: number | null;
  p90LatencyMs: number | null;
  p99LatencyMs: number | null;
  topRejectReason: { gate: string; count: number } | null;
}
