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
 *
 * Which of those states the panel is in is `DeskSourceMachine`'s decision, not
 * this file's. The inline version demoted `ready` straight to `generated` on
 * one failed poll — real recorded orders replaced by sandbox ones, swapped
 * back on the next success, alternating at the 30s cadence against a flapping
 * gateway. Routed through the machine, a failure with a ledger behind it keeps
 * the measured rows (rule 1), and `tests/overview-stability.test.ts` drives
 * the pass/fail/pass script against `audit-trail-state.ts` to hold it there.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";

import { auditProbeOutcome, auditView } from "@/components/overview/audit-trail-state";
import { fmt, usd } from "@/lib/format";
import { type AuditRow, sandboxAuditRows } from "@/lib/fallbacks/audit";
import { useDeskSource } from "@/lib/use-desk-source";
import { probeGateway } from "@/lib/use-gateway-connection";
import { usePolling } from "@/lib/use-polling";

const POLL_MS = 30_000;

export default function AuditTrail({ active, seed }: { active: boolean; seed?: number }) {
  const source = useDeskSource<AuditRow[]>();
  const { observe } = source;
  const sequence = useRef(0);

  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    // Through the connection manager for its 2.5s deadline: this was a bare
    // fetch, so a gateway that accepted and never answered left the skeleton
    // below on screen indefinitely.
    const outcome = await probeGateway<{ rows?: AuditRow[]; error?: string }>(
      "/api/gateway/audit?limit=40",
    );
    // A superseded probe is not an outcome; observing it would move the streak.
    if (current !== sequence.current) return;
    observe(auditProbeOutcome(outcome, "The gateway answered without an audit feed."));
  }, [observe]);

  // Poll only while the panel is the visible one — hidden panels stay mounted
  // in this app, and an audit table nobody is looking at should cost nothing.
  useEffect(() => {
    if (!active) return;
    void refresh();
  }, [active, refresh]);

  usePolling({ tick: refresh, intervalMs: POLL_MS, maxBackoffMs: 300_000, enabled: active });

  // The same seed the Execution blotter generates from, so a generated ledger
  // here lists the orders that tab lists.
  const generatedRows = useMemo(() => sandboxAuditRows(undefined, seed), [seed]);
  const state = auditView(source.state, generatedRows);

  return (
    <div className="card">
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">Gateway ledger</span>
          <h2>Order audit trail</h2>
        </div>
      </div>

      {/* The scope line, folded rather than cut — it is a scope caveat, which
          is the one shape a disclosure is for, and the columns below state the
          same scope in data (an Outcome column that reads "accepted" or a
          refusing gate). "the gateway saw" was the kicker's word and the
          provenance line's claim, said a third time; and in the generated
          state it was not even true. What is left is the scope: everything,
          both outcomes, and who refused — word for word, one summary line away.

          Two words on that line, and no more, because a summary is rendered
          prose and `tests/summarised-overview.test.ts` counts it as such: this
          tab stands two words under that ratchet, so the fold is allowed to
          cost exactly two and the ceiling is not touched. It still names what
          is inside rather than teasing it, which is the whole difference
          between a disclosure and a trap. */}
      <details className="disclosure">
        <summary>Ledger scope</summary>
        <p className="research-note">
          Every paper order, accepted or refused, with the refusing gate.
        </p>
      </details>

      {state.kind === "loading" && (
        // aria-busy, like the cockpit's placeholders: this panel is working, and
        // without the attribute nothing outside it — a screen reader, the desk
        // sweep — can tell the difference between "loading" and "empty".
        <div className="skeleton" style={{ height: 220 }} aria-busy="true" aria-label="Loading audit trail" />
      )}

      {state.kind === "generated" && (
        <div className="banner warn" role="status">
          <span aria-hidden>◇</span>
          <div>
            <strong>Generated ledger — these orders were not sent.</strong> {state.detail}{" "}
            The same orders the Execution blotter shows, so the two tabs reconcile.
          </div>
        </div>
      )}

      {state.kind === "ready" && state.rows.length === 0 && (
        <p className="sub">No orders in the audit window yet — send a paper order from Execution.</p>
      )}

      {state.kind !== "loading" && state.rows.length > 0 && (
        <>
          {/* tabIndex={0}, like every other scrolling table on the desk.
              This wrapper clamps to min(480px, 60vh) and scrolls both ways —
              forty rows and eight columns — and it was the one scroll
              container on this tab nobody could focus, so a keyboard or
              switch user reached the header row and stopped there. The
              `.table-wrap:focus-visible` outline already waiting in
              00-tokens-and-base.css was drawn for exactly this. */}
          <div className="table-wrap table-wrap--clamped" tabIndex={0}>
            <table>
              <caption className="sr-only">
                Order audit rows, newest first.
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
                      {row.reason && <small className="muted">, {row.reason}</small>}
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
            {state.rows.length} newest rows;{" "}
            {state.kind === "ready"
              ? `read ${state.fetchedAt.toLocaleTimeString()}; paper-only, recorded by the gateway itself.`
              : "generated for this session; paper-only, recorded by nothing."}
          </p>
        </>
      )}
    </div>
  );
}
