"use client";

/**
 * The blotter: what was sent, what it cost, and what stopped it.
 *
 * This header used to say rejections were shown in the same table as fills
 * rather than hidden behind a filter, because separating the two invites the
 * habit of reading only the fills. `BlotterViews` overtook that: the two
 * questions want different columns — a refusal has no venue and no fill price —
 * so they are now two peer views, side by side in one seg rather than one
 * default and one filter. The concern the old note recorded is answered by
 * making the unfilled view as prominent as the filled one, not by merging them.
 *
 * Each row expands to the full check vector the gateway recorded at decision
 * time. That is the difference between an audit trail and a log: the answer to
 * "why was this refused" is in the row, not in a file on a server.
 */

import { useEffect, useMemo, useState } from "react";

import {
  UNTAGGED,
  type BlotterRow,
  type BlotterStatusFilter,
  filterBlotterRows,
  rejectGateTags,
  strategyTags,
} from "@/lib/blotter";
import RowMenu from "@/components/common/RowMenu";
import BoundedPager from "@/components/common/BoundedPager";
import { download } from "@/lib/download";
import { blotterToCsv } from "@/lib/export-csv";
import { fmt, usd } from "@/lib/format";
const BLOTTER_PAGE_SIZE = 75;

interface OrderBlotterProps {
  rows: BlotterRow[];
  focusSymbol: string;
  onOpenResearch?: () => void;
  /** Where the rows came from — the empty state must not blame a quiet desk for a missing source. */
  source?: "live" | "sandbox" | "unavailable";
  /**
   * Which question this instance answers, and REQUIRED, which is the part that
   * changed.
   *
   * It used to default to `all` and carry its own four-button status seg, on the
   * argument that the component still rendered standalone. There is no
   * standalone caller: `BlotterViews` is the sole importer and it routes
   * `active` to `WorkingOrders`, so only these two values ever arrive. Naming
   * the two in the type puts that proof in the compiler rather than in a
   * comment, and the seg — which nothing could ever have selected — is gone.
   */
  view: "fills" | "unfilled";
  /** Free-text search, owned by the parent so one box drives all three views. */
  query?: string;
}

function time(ts: string): string {
  const parsed = Date.parse(ts.endsWith("Z") ? ts : `${ts}Z`);
  return Number.isNaN(parsed)
    ? ts.slice(11, 19)
    : new Date(parsed).toLocaleTimeString("en-GB", { hour12: false });
}

export default function OrderBlotter({
  rows, focusSymbol, onOpenResearch, source = "live", view, query = "",
}: OrderBlotterProps) {
  const [strategy, setStrategy] = useState<string | null>(null);
  const [gate, setGate] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);

  // The view fixes the status outright — there is no third form left that could
  // hold a status of its own.
  const status: BlotterStatusFilter = view === "fills" ? "accepted" : "unfilled";

  const tags = useMemo(() => strategyTags(rows), [rows]);
  const gates = useMemo(() => rejectGateTags(rows), [rows]);
  const visible = useMemo(
    () => filterBlotterRows(rows, {
      status, focusSymbol, strategy, query, gate: view === "unfilled" ? gate : null,
    }),
    [rows, status, focusSymbol, strategy, query, gate, view],
  );
  const pageCount = Math.max(1, Math.ceil(visible.length / BLOTTER_PAGE_SIZE));
  const activePage = Math.min(pageIndex, pageCount - 1);
  const pageStart = activePage * BLOTTER_PAGE_SIZE;
  const pagedVisible = useMemo(
    () => visible.slice(pageStart, pageStart + BLOTTER_PAGE_SIZE),
    [visible, pageStart],
  );

  useEffect(() => {
    setPageIndex(0);
    setExpanded(null);
  }, [view, focusSymbol, strategy, query, gate]);

  const exportStamp = () => {
    const parts = ["alphaengine-blotter", source, view];
    if (strategy) parts.push(strategy === UNTAGGED ? "untagged" : strategy);
    if (view === "unfilled" && gate) parts.push(gate);
    if (query.trim()) parts.push("search");
    parts.push(`${visible.length}rows`);
    parts.push(new Date().toISOString().slice(0, 10).replace(/-/g, ""));
    return parts.join("-");
  };

  return (
    <section className="card cockpit-blotter">
      <header className="section-heading compact">
        <div>
          <h3>Order blotter</h3>
          <p className="muted">
            {source === "sandbox"
              ? "A generated session, newest first: the audit log's shape, none of it audited."
              // "accepted and rejected alike" went with the single table: the view
              // seg directly above states the two as controls, and on a filtered
              // view the claim was about rows this table is not showing.
              : "Every gateway decision, newest first, from the append-only audit log."}
            {visible.length ? ` Showing ${pagedVisible.length} of ${visible.length}.` : ""}
          </p>
        </div>
        <div className="blotter-toolbar">
          {/* The gate codes are the answer this view exists to give, so they are
              a filter rather than only a column. Derived from the rows in hand,
              so a live gateway's own names appear unchanged. */}
          {view === "unfilled" && gates.length > 1 && (
            <select
              aria-label="Filter by rejection gate"
              value={gate ?? ""}
              onChange={(event) => setGate(event.target.value === "" ? null : event.target.value)}
            >
              <option value="">All reasons</option>
              {gates.map(({ gate: name, count }) => (
                <option key={name} value={name}>{name} ({count})</option>
              ))}
            </select>
          )}
          {tags.length > 1 ? (
            <select
              aria-label="Filter by strategy tag"
              value={strategy ?? ""}
              onChange={(event) => setStrategy(event.target.value === "" ? null : event.target.value)}
            >
              <option value="">All strategies</option>
              {tags.map(({ tag, count }) => (
                <option key={tag} value={tag}>
                  {tag === UNTAGGED ? "untagged" : tag} ({count})
                </option>
              ))}
            </select>
          ) : null}
          {/* Two buttons for one action with a format parameter, so they
              collapse into one disclosure. Both are read-only and repeatable,
              which is what makes hiding them behind a click safe — a
              destructive action must stay in sight.

              Exports carry exactly the rows on screen — a file that silently
              contained more than the filter selected would be a trap — and that
              caveat travels with them: the menu's own name states the count it
              is about to write, so a reader who has narrowed the table sees the
              narrowed number before opening it. */}
          <RowMenu label={`Export rows on screen (${visible.length})`}>
            <button
              type="button"
              role="menuitem"
              disabled={!visible.length}
              /* The count in the menu's own name is already zero, but a dead
                 item whose tooltip still offers the download says nothing
                 about why. */
              title={visible.length
                ? "Download exactly the rows on screen as CSV"
                : "No rows on screen to export."}
              onClick={() => download(`${exportStamp()}.csv`, blotterToCsv(visible), "text/csv")}
            >
              Export CSV
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!visible.length}
              title={visible.length
                ? "Download exactly the rows on screen as JSON"
                : "No rows on screen to export."}
              onClick={() => download(`${exportStamp()}.json`, JSON.stringify(visible, null, 2), "application/json")}
            >
              Export JSON
            </button>
          </RowMenu>
        </div>
      </header>

      {!visible.length ? (
        <p className="muted">
          {rows.length
            ? "No orders match this filter."
            : source === "unavailable"
              // The old copy said "send one and it will appear here", which on a
              // deployment with no audit log was an instruction that could not
              // work. An empty table must say WHY it is empty.
              ? "No audit log is reachable here, so nothing can be listed."
              : "No orders yet. Send one from the ticket above."}
        </p>
      ) : (
        <div className="table-wrap" tabIndex={0}>
          <table>
            <caption className="sr-only">Filtered execution order blotter</caption>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Symbol</th>
                <th scope="col">Side</th>
                <th scope="col" className="num">Notional</th>
                {/* The columns follow the question. A fills view wants the
                    economics of the trade; an unfilled view wants the reason
                    there wasn't one, and every price column on it would be a
                    row of dashes.

                    The inner `view === "fills"` guards that used to sit in this
                    branch went with the third view. Reaching here already meant
                    `fills`, so they were constant, and the Latency column behind
                    `view !== "fills"` was constant the other way — it had never
                    once rendered. Tail latency is still measured, on the Fill
                    quality subtab, which is where the distribution lives. */}
                {view === "unfilled" ? (
                  <>
                    <th scope="col">Status</th>
                    <th scope="col">Gate</th>
                    <th scope="col">Reason</th>
                  </>
                ) : (
                  <>
                    <th scope="col" className="num">Qty</th>
                    <th scope="col">Venue</th>
                    <th scope="col" className="num">Fill</th>
                    <th scope="col" className="num">Fee</th>
                    <th scope="col" className="num">Slip</th>
                    <th scope="col">Verdict</th>
                  </>
                )}
                <th scope="col">Tag</th>
              </tr>
            </thead>
            <tbody>
              {pagedVisible.map((row) => {
                const open = expanded === row.orderId;
                const detailId = ["blotter-detail", row.orderId.replace(/[^A-Za-z0-9_-]/g, "-")].join("-");
                // The desk tape's arriving tint: a fill from the last few
                // seconds wears it, the next poll's re-render ages it out.
                const fresh = Date.now() - Date.parse(row.ts.endsWith("Z") ? row.ts : `${row.ts}Z`) < 6_000;
                return [
                  <tr
                    key={row.orderId}
                    id={`blotter-row-${row.orderId.replace(/[^A-Za-z0-9_-]/g, "-")}`}
                    tabIndex={-1}
                    className={`${row.accepted ? "" : "is-rejected"}${fresh ? " row-fresh" : ""}`}
                  >
                    <td>
                      <button
                        type="button"
                        className="cockpit-blotter__row-toggle"
                        aria-expanded={open}
                        aria-controls={detailId}
                        aria-keyshortcuts="Enter"
                        onClick={() => setExpanded(open ? null : row.orderId)}
                      >
                        {time(row.ts)}
                      </button>
                    </td>
                    <td>{row.symbol}</td>
                    <td className={row.side === "BUY" ? "pos" : "neg"}>{row.side}</td>
                    <td className="num">{usd(row.notional)}</td>
                    {view === "unfilled" ? (
                      <>
                        <td>
                          {row.status === "REJECTED"
                            ? <span className="pill pill--stop">rejected</span>
                            : <span className="pill pill--warn">{row.status.toLowerCase()}</span>}
                        </td>
                        {/* Every gate that refused it, not just the first: an
                            order can trip more than one, and showing one would
                            imply the others passed. */}
                        <td className="num">{row.rejectedBy.length ? row.rejectedBy.join(", ") : "—"}</td>
                        <td className="muted">{row.reason ?? "—"}</td>
                      </>
                    ) : (
                      <>
                        <td className="num">{row.quantity != null ? fmt(row.quantity, 4) : "—"}</td>
                        <td>{row.venue ?? "—"}</td>
                        <td className="num">{row.fillPrice != null ? usd(row.fillPrice, 2) : "—"}</td>
                        <td className="num">{row.feeUsd != null ? usd(row.feeUsd, 2) : "—"}</td>
                        {/* " bps", not "bp". Every other figure on this tab
                            spells the unit that way — the quality tiles, the
                            spread decomposition, the venue table, the heatmap's
                            fold, the ticket's price-band hint — and this cell
                            was the tab's only "bp", closed up against its
                            number. A reader comparing a blotter row against the
                            Avg slippage tile above it should not have to decide
                            whether two spellings are two measurements. The
                            header stays "Slip": the cell carries the unit, so
                            the column heading does not have to. */}
                        <td className="num">{row.slippageBps != null ? `${fmt(row.slippageBps, 1)} bps` : "—"}</td>
                        <td>
                          {/* Status, not `accepted`. A cancelled or expired order was
                              accepted and never filled — labelling it "filled" would
                              claim a trade that did not happen. */}
                          {row.status === "FILLED"
                            ? <span className="pill pill--live">filled</span>
                            : row.status === "REJECTED"
                              ? <span className="pill pill--stop">{row.rejectedBy[0] ?? "rejected"}</span>
                              : <span className="pill pill--warn">{row.status.toLowerCase()}</span>}
                        </td>
                      </>
                    )}
                    <td className="muted">{row.strategy ?? "—"}</td>
                  </tr>,
                  open ? (
                    <tr key={`${row.orderId}-detail`} id={detailId} className="detail-row">
                      {/* Counted off the header above, not guessed. The fills
                          arm read 9 against 11 rendered columns, so the check
                          vector stopped two columns short of the row it
                          explains; the 10 beside it was the third view's width
                          and could never be reached. Unfilled: Time, Symbol,
                          Side, Notional, Status, Gate, Reason, Tag. Fills: the
                          same first four, then Qty, Venue, Fill, Fee, Slip,
                          Verdict, Tag. */}
                      <td colSpan={view === "unfilled" ? 8 : 11}>
                        <div className="cockpit-detail">
                          <p>
                            <code>{row.orderId}</code>
                            {row.clientOrderId ? <>; client <code>{row.clientOrderId}</code></> : null}
                            {row.source ? <>; via {row.source}</> : null}
                            {/* Unfilled only. The fills view prints the fee in its own
                                column in the row directly above; the unfilled view has no
                                fee column, and a cancelled order that partly filled still
                                paid one. */}
                            {view === "unfilled" && row.feeUsd != null ? <>; fee {usd(row.feeUsd, 2)}</> : null}
                          </p>
                          {/* Fills only, on the fee rule directly above. The
                              unfilled view carries a Reason column, so this
                              reprinted the same string in the row immediately
                              beneath the cell holding it; the fills view has no
                              such column and this is the only place a reason
                              reaches a reader there. */}
                          {view === "fills" && row.reason ? <p>{row.reason}</p> : null}

                          {row.checks.length ? (
                            <ol className="cockpit-checks">
                              {row.checks.map((check) => (
                                <li key={check.name} className={check.passed ? "is-pass" : "is-fail"}>
                                  <span className="cockpit-checks__mark" aria-hidden>{check.passed ? "✓" : "✗"}</span>
                                  <span className="cockpit-checks__name">{check.name}</span>
                                  {check.detail ? <span className="cockpit-checks__detail">{check.detail}</span> : null}
                                </li>
                              ))}
                            </ol>
                          ) : (
                            <p className="muted">
                              This row predates check-vector capture, so only the outcome is on record.
                            </p>
                          )}

                          {row.clientOrderId?.startsWith("EXP-") && onOpenResearch ? (
                            /* "…that produced this order" said again what the
                               row it is nested inside already says: this
                               button only exists in one order's expanded
                               detail, directly under that order's own id. At
                               the large preset the full sentence wrapped the
                               button onto a second row inside a table cell.
                               Rejected: "Research run", which drops the verb
                               and reads as a column header rather than a
                               control. */
                            <button type="button" className="icon" onClick={onOpenResearch}>
                              Open the research run
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
          <BoundedPager
            activePage={activePage}
            pageCount={pageCount}
            label={view}
            onPageChange={(page) => {
              setExpanded(null);
              setPageIndex(page);
            }}
          />
        </div>
      )}
    </section>
  );
}
