export interface GateCheck {
  name: string;
  passed: boolean;
  detail?: string | null;
}

/**
 * Where an order ended up.
 *
 * Mirrors `OrderStatus` in modules/schemas.py. `PARTIALLY_FILLED` is absent on
 * both sides: the L2 feeds carry ladder snapshots rather than trade prints, so
 * how much of a resting order a crossing trade consumed is not knowable here,
 * and a state that can never be reached would claim a model that does not exist.
 */
export type OrderStatus = "WORKING" | "FILLED" | "CANCELLED" | "EXPIRED" | "REJECTED";

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
  status: OrderStatus;
  timeInForce: string | null;
  /** The full pre-trade check vector, when the gateway recorded one. */
  checks: GateCheck[];
}

/**
 * An order resting on the book right now.
 *
 * Deliberately a different type from `BlotterRow`, which is a terminal decision.
 * A working order has no fill, no latency worth reading and no verdict — giving
 * it those fields as nulls would invite a table to render "—" where the honest
 * answer is "not yet".
 */
export interface WorkingOrderRow {
  orderId: string;
  clientOrderId: string | null;
  symbol: string;
  side: string;
  orderType: string;
  timeInForce: string;
  quantity: number;
  limitPrice: number;
  /** Committed capital: quantity x limit price. A resting order is not free. */
  notional: number;
  strategy: string | null;
  source: string | null;
  status: "WORKING";
  acceptedAt: string;
  ageSeconds: number;
  markPrice: number | null;
  /** Null, never zero, when there is no mark: "at the touch" and "nobody is
   *  quoting this" are opposite claims. */
  distanceBps: number | null;
  expiresAt: string | null;
}

export interface RiskEventRow {
  ts: string;
  event: string;
  severity: string;
  actor: string | null;
  symbol: string | null;
  detail: string | null;
}
