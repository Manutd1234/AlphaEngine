/**
 * Types and shaping for the execution cockpit's gateway-backed panels.
 *
 * The gateway's audit rows arrive as loosely-typed JSON from a separately
 * deployed service. Parsing them here — once, defensively — keeps that
 * uncertainty out of the components, which should be rendering decisions rather
 * than guessing whether a field survived the trip.
 *
 * Nothing here fabricates a value. A missing number stays `null` and renders as
 * "—", because a slippage of "0" and a slippage nobody measured mean opposite
 * things to a trader reading an execution report.
 */

export interface GateCheck {
  name: string;
  passed: boolean;
  detail?: string | null;
}

export interface BlotterRow {
  ts: string;
  orderId: string;
  clientOrderId: string | null;
  strategy: string | null;
  symbol: string;
  side: string;
  orderType: string | null;
  quantity: number | null;
  notional: number | null;
  accepted: boolean;
  rejectedBy: string[];
  reason: string | null;
  latencyMs: number | null;
  fillPrice: number | null;
  feeUsd: number | null;
  slippageBps: number | null;
  venue: string | null;
  source: string | null;
  /** The full pre-trade check vector, when the gateway recorded one. */
  checks: GateCheck[];
}

export interface RiskEventRow {
  ts: string;
  event: string;
  severity: string;
  actor: string | null;
  symbol: string | null;
  detail: string | null;
}

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
    checks: parseChecks(row.checks_json),
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
  p99LatencyMs: number | null;
  topRejectReason: { gate: string; count: number } | null;
}

export function summarise(rows: BlotterRow[]): ExecutionSummary {
  const accepted = rows.filter((r) => r.accepted);
  const slippage = accepted.map((r) => r.slippageBps).filter((v): v is number => v != null);
  const latency = rows.map((r) => r.latencyMs).filter((v): v is number => v != null).sort((a, b) => a - b);

  const gates = new Map<string, number>();
  for (const row of rows) {
    for (const gate of row.rejectedBy) gates.set(gate, (gates.get(gate) ?? 0) + 1);
  }
  const worstGate = [...gates.entries()].sort((a, b) => b[1] - a[1])[0];

  // Nearest-rank: with a window this small, interpolating between two samples
  // would invent precision the window does not have.
  const quantile = (q: number): number | null =>
    latency.length ? latency[Math.min(latency.length - 1, Math.ceil(q * latency.length) - 1)] : null;

  return {
    orders: rows.length,
    accepted: accepted.length,
    rejected: rows.length - accepted.length,
    fillRate: rows.length ? accepted.length / rows.length : null,
    avgSlippageBps: slippage.length ? slippage.reduce((a, b) => a + b, 0) / slippage.length : null,
    worstSlippageBps: slippage.length ? Math.max(...slippage) : null,
    totalFees: accepted.reduce((sum, r) => sum + (r.feeUsd ?? 0), 0),
    p50LatencyMs: quantile(0.5),
    p99LatencyMs: quantile(0.99),
    topRejectReason: worstGate ? { gate: worstGate[0], count: worstGate[1] } : null,
  };
}
