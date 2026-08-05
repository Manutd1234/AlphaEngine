/**
 * CSV serialisation for the order blotter.
 * ========================================
 *
 * RFC 4180: a cell is quoted when it contains a quote, a comma or a line
 * break, and inner quotes double. Rows join with CRLF, which is what the
 * standard says and what spreadsheet imports on every platform accept.
 *
 * Two deliberate decisions worth stating, because both look like oversights:
 *
 *  1. An absent measurement exports as an EMPTY cell, never "—" or 0. The
 *     blotter's whole null-preservation discipline exists so an unmeasured
 *     latency is not read as a fast one; writing a placeholder into a
 *     spreadsheet would undo that at the last step.
 *  2. Cells are NOT prefixed to defuse spreadsheet formula injection
 *     (`=`, `+`, `@`). This is a quant's own trade data going into their own
 *     sheet, and mangling values to guard against a threat model that does not
 *     apply here would corrupt the data it is meant to protect. Stated so the
 *     choice is visibly a choice.
 */

import type { BlotterRow } from "./blotter";

type Cell = string | number | boolean | null | undefined;

function escapeCell(value: Cell): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: Cell[][]): string {
  return [header, ...rows].map((row) => row.map(escapeCell).join(",")).join("\r\n");
}

/** Column order mirrors the on-screen table, then the fields it hides. */
export const BLOTTER_CSV_COLUMNS = [
  "ts",
  "symbol",
  "side",
  "notional",
  "venue",
  "fill_price",
  "slippage_bps",
  "latency_ms",
  "verdict",
  "strategy",
  "order_id",
  "client_order_id",
  "rejected_by",
  "reason",
  "fee_usd",
  "quantity",
  "order_type",
  "source",
] as const;

export function blotterToCsv(rows: BlotterRow[]): string {
  return toCsv(
    [...BLOTTER_CSV_COLUMNS],
    rows.map((r) => [
      new Date(r.ts).toISOString(),
      r.symbol,
      r.side,
      r.notional,
      r.venue,
      r.fillPrice,
      r.slippageBps,
      r.latencyMs,
      r.accepted ? "filled" : "rejected",
      r.strategy,
      r.orderId,
      r.clientOrderId,
      // The gateway's own storage convention; the quoting rule handles it.
      r.rejectedBy.join(","),
      r.reason,
      r.feeUsd,
      r.quantity,
      r.orderType,
      r.source,
    ]),
  );
}
