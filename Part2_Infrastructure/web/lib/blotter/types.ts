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
  /**
   * Did the gateway say this fill was simulated?
   *
   * `boolean | null`, and the null carries the whole weight. It means the feed
   * did not say, which is NOT `false`: `row.simulated === true` would flatten
   * "no claim" into "this was a real venue fill", and that is the one direction
   * the error must never run on a cost surface.
   *
   * Measured, not assumed, before this field was added: `Fill.simulated` exists
   * on the gateway (modules/schemas_trading.py) and reaches the browser on the
   * order-ticket decision response, but the `orders` audit table has no such
   * column (modules/audit/schema.py) and `recent_orders` cannot select one — a
   * live probe of /api/gateway/audit?feed=orders returned 14 rows whose key
   * union has no `simulated` in it. So every row on the blotter feed arrives
   * with the flag absent TODAY, and the panels must render that as "not stated"
   * rather than as a clean bill of health. When the gateway grows the column
   * the same field starts carrying true/false and nothing downstream changes.
   */
  simulated: boolean | null;
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
