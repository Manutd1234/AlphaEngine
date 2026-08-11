"use client";

/**
 * The audit trail the hero copy has always promised ("…reconcile to the same
 * audit trail") — read straight from the gateway's order audit feed, which
 * every paper order lands in whether it was accepted or refused. Until this
 * panel existed the feed had no surface anywhere in the UI.
 *
 * Honest states over spinners: the gateway being unreachable is a terminal,
 * labelled condition here, never an endless "connecting".
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { fmt, usd } from "@/lib/format";

interface AuditRow {
  ts: string;
  order_id: string;
  strategy: string | null;
  symbol: string;
  side: string;
  order_type: string;
  quantity: number;
  notional: number | null;
  accepted: boolean;
  rejected_by: string | null;
  reason: string | null;
  latency_ms: number | null;
  fill_price: number | null;
  fee_usd: number | null;
}

type AuditState =
  | { kind: "loading" }
  | { kind: "ready"; rows: AuditRow[]; fetchedAt: Date }
  | { kind: "unreachable"; detail: string };

const POLL_MS = 30_000;

export default function AuditTrail({ active }: { active: boolean }) {
  const [state, setState] = useState<AuditState>({ kind: "loading" });
  const sequence = useRef(0);

  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    try {
      const response = await fetch("/api/gateway/audit?limit=40", { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as {
        rows?: AuditRow[];
        error?: string;
      };
      if (current !== sequence.current) return;
      if (!response.ok || !Array.isArray(body.rows)) {
        setState({
          kind: "unreachable",
          detail: body.error ?? `The gateway audit feed answered HTTP ${response.status}.`,
        });
        return;
      }
      setState({ kind: "ready", rows: body.rows, fetchedAt: new Date() });
    } catch (err) {
      if (current === sequence.current) {
        setState({
          kind: "unreachable",
          detail: err instanceof Error ? err.message : "The audit feed could not be reached.",
        });
      }
    }
  }, []);

  // Poll only while the panel is the visible one — hidden panels stay mounted
  // in this app, and an audit table nobody is looking at should cost nothing.
  useEffect(() => {
    if (!active) return;
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [active, refresh]);

  return (
    <div className="card">
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">Gateway ledger</span>
          <h2>Order audit trail</h2>
        </div>
        <span className="section-note">
          Every paper order the gateway saw — accepted or refused — with the gate that refused it.
        </span>
      </div>

      {state.kind === "loading" && <div className="skeleton" style={{ height: 220 }} />}

      {state.kind === "unreachable" && (
        <div className="banner warn" role="status">
          <span aria-hidden>!</span>
          <div>
            <strong>Gateway unreachable — no audit rows to show.</strong> {state.detail}{" "}
            The trail lives in the gateway&apos;s own ledger, so this panel refuses to invent one.
          </div>
        </div>
      )}

      {state.kind === "ready" && state.rows.length === 0 && (
        <p className="sub">No orders in the audit window yet — send a paper order from Execution.</p>
      )}

      {state.kind === "ready" && state.rows.length > 0 && (
        <>
          <div className="table-wrap table-wrap--clamped">
            <table>
              <caption className="sr-only">
                Gateway order audit rows, most recent first: time, symbol, side, quantity, fill
                price, notional, outcome and gateway latency.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Time (UTC)</th>
                  <th scope="col">Symbol</th>
                  <th scope="col">Side</th>
                  <th scope="col">Qty</th>
                  <th scope="col">Fill</th>
                  <th scope="col">Notional</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Latency</th>
                </tr>
              </thead>
              <tbody>
                {state.rows.map((row) => (
                  <tr key={row.order_id}>
                    <td className="num">{row.ts.slice(0, 19).replace("T", " ")}</td>
                    <td>{row.symbol}</td>
                    <td>{row.side}</td>
                    <td className="num">{fmt(row.quantity, 4)}</td>
                    <td className="num">{row.fill_price === null ? "—" : usd(row.fill_price, 2)}</td>
                    <td className="num">{row.notional === null ? "—" : usd(row.notional, 0)}</td>
                    <td>
                      {row.accepted ? (
                        <span style={{ color: "var(--success-text)" }}>
                          <span aria-hidden>✓</span> accepted
                        </span>
                      ) : (
                        <span style={{ color: "var(--critical-text)" }}>
                          <span aria-hidden>✕</span> {row.rejected_by ?? "refused"}
                        </span>
                      )}
                      {row.reason && <small className="muted"> · {row.reason}</small>}
                    </td>
                    <td className="num">
                      {row.latency_ms === null ? "—" : `${fmt(row.latency_ms, 1)}ms`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="research-note">
            {state.rows.length} most recent rows · read {state.fetchedAt.toLocaleTimeString()} ·
            paper-only, recorded by the gateway itself.
          </p>
        </>
      )}
    </div>
  );
}
