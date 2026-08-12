"use client";

/**
 * The audit trail the hero copy has always promised ("…reconcile to the same
 * audit trail") — read from the gateway's order audit feed, which every paper
 * order lands in whether it was accepted or refused. Until this panel existed
 * the feed had no surface anywhere in the UI.
 *
 * Honest states over spinners, and a filled table over an honest empty one. The
 * unreachable state used to be terminal: a warning banner reading "this panel
 * refuses to invent one", which made the Overview tab's third section a
 * paragraph of apology on every deployment without a gateway — which is the
 * public one. It now shows the same generated orders the Execution blotter
 * shows, labelled as generated. Nothing is invented here that is not already on
 * screen one tab away.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { fmt, usd } from "@/lib/format";
import { type AuditRow, sandboxAuditRows } from "@/lib/fallbacks/audit";
import { probeGateway } from "@/lib/use-gateway-connection";

/**
 * No `"unreachable"` member.
 *
 * It was one, and it was the only state that rendered no table. `"generated"`
 * replaces it: same rows, stated provenance. The live path is unchanged.
 */
type AuditState =
  | { kind: "loading" }
  | { kind: "ready"; rows: AuditRow[]; fetchedAt: Date }
  | { kind: "generated"; rows: AuditRow[]; detail: string };

const POLL_MS = 30_000;

export default function AuditTrail({ active, seed }: { active: boolean; seed?: number }) {
  const [state, setState] = useState<AuditState>({ kind: "loading" });
  const sequence = useRef(0);

  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    // Through the connection manager for its 2.5s deadline: this was a bare
    // fetch, so a gateway that accepted and never answered left the skeleton
    // below on screen indefinitely.
    const outcome = await probeGateway<{ rows?: AuditRow[]; error?: string }>(
      "/api/gateway/audit?limit=40",
    );
    if (current !== sequence.current) return;
    if (!outcome.ok || !Array.isArray(outcome.payload.rows)) {
      setState({
        kind: "generated",
        rows: sandboxAuditRows(undefined, seed),
        detail: outcome.ok
          ? "The gateway answered without an audit feed."
          : outcome.failure.message,
      });
      return;
    }
    setState({ kind: "ready", rows: outcome.payload.rows, fetchedAt: new Date() });
  }, [seed]);

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

      {state.kind === "loading" && (
        // aria-busy, like the cockpit's placeholders: this panel is working, and
        // without the attribute nothing outside it — a screen reader, the desk
        // sweep — can tell the difference between "loading" and "empty".
        <div className="skeleton" style={{ height: 220 }} aria-busy="true" aria-label="Loading the audit trail" />
      )}

      {state.kind === "generated" && (
        <div className="banner warn" role="status">
          <span aria-hidden>◇</span>
          <div>
            <strong>Generated ledger — these orders were not sent.</strong> {state.detail}{" "}
            The rows below are the same simulated orders the Execution blotter shows, so the two
            tabs still reconcile. Nothing here was recorded by a gateway.
          </div>
        </div>
      )}

      {state.kind === "ready" && state.rows.length === 0 && (
        <p className="sub">No orders in the audit window yet — send a paper order from Execution.</p>
      )}

      {state.kind !== "loading" && state.rows.length > 0 && (
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
            {state.rows.length} most recent rows ·{" "}
            {state.kind === "ready"
              ? `read ${state.fetchedAt.toLocaleTimeString()} · paper-only, recorded by the gateway itself.`
              : "generated for this session · paper-only, recorded by nothing."}
          </p>
        </>
      )}
    </div>
  );
}
