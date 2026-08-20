import { BlotterRow, WorkingOrderRow } from "./types";

// --------------------------------------------------------------------------
// Blotter views
//
// The filter logic lives here rather than in the table component so it can be
// tested without a DOM, and so the export writes exactly the rows the filter
// selected.
// --------------------------------------------------------------------------

/**
 * `unfilled` is appended, and it is not the same thing as `rejected`.
 *
 * `rejected` keys off `!accepted` and therefore EXCLUDES a CANCELLED or EXPIRED
 * order — one that was accepted by the gate and then never filled. So "why is
 * there no fill" had no expressible answer: the refusals were one filter and
 * the cancellations were in none. `unfilled` is `status !== "FILLED"`, which
 * makes it the exact complement of `accepted` and puts both kinds of no-fill in
 * one bucket, because both answer the same question.
 */
export type BlotterStatusFilter = "all" | "accepted" | "rejected" | "symbol" | "unfilled";

/** Sentinel for rows the gateway recorded without a strategy tag. */
export const UNTAGGED = "∅";

/**
 * The fields free-text search looks at.
 *
 * String fields only, and deliberately: searching "500000" against a notional
 * would substring-match a fee, an order id and a timestamp, so a filter that
 * silently means something other than what it says is worse than no filter.
 */
function searchable(row: BlotterRow): string {
  return [
    row.orderId, row.clientOrderId, row.symbol, row.side, row.strategy,
    row.venue, row.orderType, row.reason, row.source, ...row.rejectedBy,
  ].filter(Boolean).join(" ").toLowerCase();
}

export function filterBlotterRows(
  rows: BlotterRow[],
  opts: {
    status: BlotterStatusFilter;
    focusSymbol: string;
    strategy: string | null;
    /** Optional so every existing three-key call site is unchanged. */
    query?: string;
    /** A rejection gate code, from the Cancelled & Rejected view's select. */
    gate?: string | null;
  },
): BlotterRow[] {
  const byStatus = rows.filter((row) => {
    switch (opts.status) {
      // Keyed off status, not `accepted`: a resting order that was cancelled
      // was accepted and never filled, and counting it as a fill would overstate
      // what the desk actually did.
      case "accepted": return row.status === "FILLED";
      case "rejected": return !row.accepted;
      case "unfilled": return row.status !== "FILLED";
      case "symbol": return row.symbol === opts.focusSymbol;
      default: return true;
    }
  });

  const byStrategy = opts.strategy === null
    ? byStatus
    : opts.strategy === UNTAGGED
      ? byStatus.filter((row) => row.strategy == null)
      : byStatus.filter((row) => row.strategy === opts.strategy);

  const byGate = opts.gate
    ? byStrategy.filter((row) => row.rejectedBy.includes(opts.gate as string))
    : byStrategy;

  const needle = opts.query?.trim().toLowerCase();
  if (!needle) return byGate;
  return byGate.filter((row) => searchable(row).includes(needle));
}

/**
 * Distinct rejection gate codes with counts.
 *
 * Derived from the rows in hand exactly as `strategyTags` is, never a hardcoded
 * list, so a live gateway's own gate names appear unchanged rather than being
 * filtered against a set this file guessed at.
 */
export function rejectGateTags(rows: BlotterRow[]): Array<{ gate: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const gate of row.rejectedBy) counts.set(gate, (counts.get(gate) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([gate, count]) => ({ gate, count }));
}

/**
 * The same search over the resting book.
 *
 * A separate function because `WorkingOrderRow` is a separate type for the
 * reason stated where it is declared: a resting order has no verdict, no fill
 * and no latency, and giving it those as nulls would invite a table to render
 * "—" where the honest answer is "not yet".
 */
export function filterWorkingOrders(rows: WorkingOrderRow[], query: string): WorkingOrderRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) =>
    [row.orderId, row.clientOrderId, row.symbol, row.side, row.orderType, row.strategy, row.source]
      .filter(Boolean).join(" ").toLowerCase().includes(needle));
}

/** Distinct strategy tags with counts — derived from the rows in hand, never
 *  a hardcoded list, so a live gateway's own tags appear unchanged. */
export function strategyTags(rows: BlotterRow[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  let untagged = 0;
  for (const row of rows) {
    if (row.strategy == null) untagged += 1;
    else counts.set(row.strategy, (counts.get(row.strategy) ?? 0) + 1);
  }
  const out = [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([tag, count]) => ({ tag, count }));
  if (untagged) out.push({ tag: UNTAGGED, count: untagged });
  return out;
}
