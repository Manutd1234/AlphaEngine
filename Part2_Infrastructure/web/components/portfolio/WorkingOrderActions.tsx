"use client";

/**
 * The amend/cancel cell of the working-orders table, one row's worth.
 *
 * Split from `WorkingOrders.tsx` on 2026-08-22, when routing the feed through
 * `DeskSourceMachine` pushed that file past its file-size ledger entry. The
 * editing state stays with the table — which row is being amended, the draft
 * price, the order in flight — because one edit at a time is a property of the
 * table, not of a row; this component renders the cell for the state it is
 * handed and reports intent back up.
 *
 * The disabled-with-a-reason pattern is deliberate: a control that vanishes
 * teaches a reader the action does not exist, and the title carries the same
 * reason for every state that colour or greying alone would have implied.
 */

import type { WorkingOrderRow } from "@/lib/blotter";

export interface WorkingOrderActionsProps {
  row: WorkingOrderRow;
  /** True while this row's own mutation is in flight. */
  busy: boolean;
  /** True while this row's limit price is being edited. */
  amending: boolean;
  /** The limit price as typed, unparsed — validation gates the Send button. */
  draftPrice: string;
  writesDisabled: boolean;
  /** Generated orders were never sent, so nothing real can be pulled. */
  sandbox: boolean;
  /** The book's own staleness; writes stay locked until it reconnects. */
  isStale: boolean;
  /** Which surface the operator acted from; lands in the audit trail. */
  origin: string;
  onDraftChange: (value: string) => void;
  onAmendStart: () => void;
  onAmendClose: () => void;
  /** The table's one mutation path, shared with cancel — never a second fetch. */
  onMutate: (path: string, body: unknown, orderId: string) => void;
}

export default function WorkingOrderActions({
  row,
  busy,
  amending,
  draftPrice,
  writesDisabled,
  sandbox,
  isStale,
  origin,
  onDraftChange,
  onAmendStart,
  onAmendClose,
  onMutate,
}: WorkingOrderActionsProps) {
  if (amending) {
    return (
      <div className="portfolio-row-actions">
        <input
          className="allocation-target-input"
          type="text"
          inputMode="decimal"
          aria-label={`New limit price for ${row.symbol}`}
          value={draftPrice}
          autoFocus
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Escape") onAmendClose(); }}
        />
        <button
          type="button"
          disabled={busy || !Number.isFinite(Number(draftPrice))}
          onClick={() => onMutate(
            `/api/gateway/orders/${encodeURIComponent(row.orderId)}/replace`,
            { limit_price: Number(draftPrice), reason: `amended from the ${origin}` },
            row.orderId,
          )}
        >
          Send
        </button>
        <button type="button" onClick={onAmendClose}>Cancel edit</button>
      </div>
    );
  }

  return (
    <div className="portfolio-row-actions">
      <button
        type="button"
        disabled={writesDisabled || busy}
        title={
          sandbox ? "Generated orders cannot be amended."
            : isStale ? "Reconnect the portfolio gateway before amending."
              : "Replace this order at a new limit — it faces every gate again"
        }
        onClick={onAmendStart}
      >
        Amend
      </button>
      <button
        type="button"
        disabled={writesDisabled || busy}
        title={
          sandbox ? "Generated orders cannot be cancelled."
            : isStale ? "Reconnect the portfolio gateway before cancelling."
              : "Pull this order off the book"
        }
        onClick={() => onMutate(
          `/api/gateway/orders/${encodeURIComponent(row.orderId)}/cancel`,
          { reason: `cancelled from the ${origin}` },
          row.orderId,
        )}
      >
        {busy ? "…" : "Cancel"}
      </button>
    </div>
  );
}
