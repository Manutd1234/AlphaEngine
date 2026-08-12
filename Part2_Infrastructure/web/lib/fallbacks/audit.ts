/**
 * The order audit trail, when the gateway's ledger cannot be read.
 * ===============================================================
 *
 * The panel's own copy used to end: "The trail lives in the gateway's own
 * ledger, so this panel refuses to invent one." That was the right instinct
 * about the danger and, like the book's version of the same refusal, the wrong
 * conclusion — the Overview tab's third section was a warning banner and nothing
 * else on every deployment without a gateway, which is the public one.
 *
 * These rows are not invented. They are the SAME generated orders the Execution
 * blotter shows, converted to the gateway's wire shape — so a reader who moves
 * from Overview to Execution sees one desk described twice, not two desks. That
 * is the property that makes a fallback safe to build: `sandboxBlotter` already
 * reconciles to the cent with `sandboxBook`'s attribution table, so anything
 * derived from it inherits the agreement rather than needing its own.
 *
 * The conversion is a pass-through, deliberately. Every field maps to the wire
 * name the audit route uses (`lib/blotter.ts` maps the same names in the other
 * direction for the live feed), and no value is recomputed on the way — a
 * latency or a fee that differed between the two views would be a disagreement
 * invented by the adapter itself.
 */

import { sandboxBlotter } from "@/lib/blotter";

/**
 * The gateway audit feed's row, snake_case as it arrives on the wire.
 *
 * Declared here rather than in the component because both the live path and the
 * generated path have to satisfy it, and a shape that lives in one consumer is a
 * shape the other can drift from.
 */
export interface AuditRow {
  ts: string;
  order_id: string;
  strategy: string | null;
  symbol: string;
  side: string;
  /**
   * Nullable, which the previous declaration of this shape got wrong.
   *
   * `BlotterRow.orderType` is `string | null` — the gateway's audit feed does
   * not guarantee it — and the compiler refused the conversion until this
   * matched. The alternative was defaulting to "MARKET" here, which would have
   * invented a fact about an order rather than passing one along. Nothing
   * renders this column today, so nullability costs nothing.
   */
  order_type: string | null;
  /**
   * Nullable, and this one was a real defect rather than a type nicety.
   *
   * A rejected order never reached a size, so `BlotterRow.quantity` is null for
   * every refused row. Defaulting it to 0 here rendered `0.0000` in the Qty
   * column beside a $14,514 notional and a `max_order_notional` rejection — a
   * zero-size order that was refused for being too large. The dash the table
   * already shows for an absent fill price is the truthful rendering, and
   * `fmt()` produces it from null without any change at the call site.
   */
  quantity: number | null;
  notional: number | null;
  accepted: boolean;
  rejected_by: string | null;
  reason: string | null;
  latency_ms: number | null;
  fill_price: number | null;
  fee_usd: number | null;
}

/**
 * Generated audit rows for this visitor's desk.
 *
 * `limit` matches what the component asks the live route for, so the generated
 * table is the same length as the real one would be.
 */
export function sandboxAuditRows(
  now?: number,
  seed?: number,
  limit = 40,
): AuditRow[] {
  return sandboxBlotter(now, seed)
    .slice(0, limit)
    .map((row) => ({
      ts: row.ts,
      order_id: row.orderId,
      strategy: row.strategy,
      symbol: row.symbol,
      side: row.side,
      order_type: row.orderType,
      // Passed through, not defaulted. See the note on the field.
      quantity: row.quantity,
      notional: row.notional,
      accepted: row.accepted,
      // The wire carries one gate, the blotter carries the vector. The first is
      // the one that refused the order — the gates evaluate in order and stop.
      rejected_by: row.rejectedBy[0] ?? null,
      reason: row.reason,
      latency_ms: row.latencyMs,
      fill_price: row.fillPrice,
      fee_usd: row.feeUsd,
    }));
}
