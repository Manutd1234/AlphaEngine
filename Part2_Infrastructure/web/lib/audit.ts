/** One row returned by the gateway's paper-order audit ledger. */
export interface AuditRow {
  ts: string;
  order_id: string;
  strategy: string | null;
  symbol: string;
  side: string;
  order_type: string | null;
  quantity: number | null;
  notional: number | null;
  accepted: boolean;
  rejected_by: string | null;
  reason: string | null;
  latency_ms: number | null;
  fill_price: number | null;
  fee_usd: number | null;
}
