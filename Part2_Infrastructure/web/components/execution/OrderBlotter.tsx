"use client";

/**
 * The blotter: what was sent, what it cost, and what stopped it.
 *
 * Rejections are shown in the same table as fills rather than hidden behind a
 * filter. A desk's rejected flow is the more interesting half — it is where the
 * limits are actually binding — and separating the two invites the habit of
 * reading only the fills.
 *
 * Each row expands to the full check vector the gateway recorded at decision
 * time. That is the difference between an audit trail and a log: the answer to
 * "why was this refused" is in the row, not in a file on a server.
 */

import { useMemo, useState } from "react";

import type { BlotterRow } from "@/lib/blotter";
import { fmt, usd } from "@/lib/format";

interface OrderBlotterProps {
  rows: BlotterRow[];
  focusSymbol: string;
  onOpenResearch?: () => void;
  /** Where the rows came from — the empty state must not blame a quiet desk for a missing source. */
  source?: "live" | "sandbox" | "unavailable";
}

type Filter = "all" | "accepted" | "rejected" | "symbol";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "accepted", label: "Fills" },
  { id: "rejected", label: "Rejected" },
  { id: "symbol", label: "This symbol" },
];

function time(ts: string): string {
  const parsed = Date.parse(ts.endsWith("Z") ? ts : `${ts}Z`);
  return Number.isNaN(parsed)
    ? ts.slice(11, 19)
    : new Date(parsed).toLocaleTimeString("en-GB", { hour12: false });
}

export default function OrderBlotter({ rows, focusSymbol, onOpenResearch, source = "live" }: OrderBlotterProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const visible = useMemo(() => {
    switch (filter) {
      case "accepted": return rows.filter((r) => r.accepted);
      case "rejected": return rows.filter((r) => !r.accepted);
      case "symbol": return rows.filter((r) => r.symbol === focusSymbol);
      default: return rows;
    }
  }, [rows, filter, focusSymbol]);

  return (
    <section className="card cockpit-blotter">
      <header className="section-heading compact">
        <div>
          <h3>Order blotter</h3>
          <p className="muted">
            {source === "sandbox"
              ? "A generated session, newest first — same shape as the audit log, none of it audited."
              : "Every decision the gateway made, newest first — accepted and rejected alike, straight from the append-only audit log."}
          </p>
        </div>
        <div className="seg" role="group" aria-label="Filter blotter">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={filter === option.id}
              onClick={() => setFilter(option.id)}
            >
              {option.label}
            </button>
          ))}
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
              ? "No audit log is reachable in this deployment, so there is nothing to list."
              : "No orders yet. Send one from the ticket above and it will appear here."}
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Filtered execution order blotter</caption>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Symbol</th>
                <th scope="col">Side</th>
                <th scope="col" className="num">Notional</th>
                <th scope="col">Venue</th>
                <th scope="col" className="num">Fill</th>
                <th scope="col" className="num">Slip</th>
                <th scope="col" className="num">Latency</th>
                <th scope="col">Verdict</th>
                <th scope="col">Tag</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const open = expanded === row.orderId;
                return [
                  <tr
                    key={row.orderId}
                    className={row.accepted ? "" : "is-rejected"}
                    onClick={() => setExpanded(open ? null : row.orderId)}
                    aria-expanded={open}
                  >
                    <td>{time(row.ts)}</td>
                    <td>{row.symbol}</td>
                    <td className={row.side === "BUY" ? "pos" : "neg"}>{row.side}</td>
                    <td className="num">{usd(row.notional)}</td>
                    <td>{row.venue ?? "—"}</td>
                    <td className="num">{row.fillPrice != null ? usd(row.fillPrice, 2) : "—"}</td>
                    <td className="num">{row.slippageBps != null ? `${fmt(row.slippageBps, 1)}bp` : "—"}</td>
                    <td className="num">{row.latencyMs != null ? `${fmt(row.latencyMs, 2)}ms` : "—"}</td>
                    <td>
                      {row.accepted
                        ? <span className="pill pill--live">filled</span>
                        : <span className="pill pill--stop">{row.rejectedBy[0] ?? "rejected"}</span>}
                    </td>
                    <td className="muted">{row.strategy ?? "—"}</td>
                  </tr>,
                  open ? (
                    <tr key={`${row.orderId}-detail`} className="detail-row">
                      <td colSpan={10}>
                        <div className="cockpit-detail">
                          <p>
                            <code>{row.orderId}</code>
                            {row.clientOrderId ? <> · client <code>{row.clientOrderId}</code></> : null}
                            {row.source ? <> · via {row.source}</> : null}
                            {row.feeUsd != null ? <> · fee {usd(row.feeUsd, 2)}</> : null}
                          </p>
                          {row.reason ? <p>{row.reason}</p> : null}

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
                            <button type="button" className="icon" onClick={onOpenResearch}>
                              Open the research run that produced this order
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
        </div>
      )}
    </section>
  );
}
