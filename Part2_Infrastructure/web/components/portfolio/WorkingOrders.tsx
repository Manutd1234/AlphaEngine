"use client";

/**
 * Orders resting on the book — capital committed but not yet spent.
 *
 * This panel exists because "accepted" and "filled" stopped being the same word.
 * Until the gateway learned to rest an order, every acceptance was a fill and
 * the blotter told the whole story; now an order can sit between the two states
 * for hours, and a PM reading gross exposure without it is reading a number that
 * is about to change.
 *
 * Two things are deliberate:
 *
 *  - **Committed capital is shown, not implied.** A resting BUY is exposure the
 *    risk gates already count (they project the worst-side fill), so the header
 *    totals it rather than leaving the reader to multiply columns.
 *  - **Cancel is one click and asks for no typed word.** The confirmation ritual
 *    on the kill switch suits a desk-wide action. Pulling one order is something
 *    a trader does repeatedly, and a cancel only ever reduces risk — the gateway
 *    does not even charge it a rate-limit token.
 */

import { useCallback, useEffect, useState } from "react";

import { filterWorkingOrders, sandboxWorkingOrders, toWorkingOrder, type WorkingOrderRow } from "@/lib/blotter";
import RowMenu from "@/components/common/RowMenu";
import { download } from "@/lib/download";
import { workingOrdersToCsv } from "@/lib/export-csv";
import { fmt, usd } from "@/lib/format";
import { probeGateway } from "@/lib/use-gateway-connection";
import { usePolling } from "@/lib/use-polling";

export interface WorkingOrdersProps {
  /** Where the rows come from. The empty state must not blame a quiet desk for a missing gateway. */
  source: "live" | "sandbox" | "unavailable";
  /** Symbol the workspace is focused on, used only to highlight — never to filter away rows. */
  focusSymbol?: string;
  /** Writes are refused while the last portfolio refresh failed. */
  isStale?: boolean;
  /**
   * False while this sub-tab is hidden. Panels stay mounted so a draft survives a
   * section switch, which means a poll left ungated would keep running behind a
   * tab nobody is looking at.
   */
  active?: boolean;
  operatorToken?: string;
  /** Re-read the book after a cancel actually changed something. */
  onChanged?: () => void;
  onFocusSymbol?: (symbol: string) => void;
  /**
   * Which surface the operator acted from.
   *
   * The cancel and amend reasons land in the gateway's append-only audit trail,
   * and they were hardcoded to "the portfolio panel" — so an amend made from
   * the execution blotter would be recorded as having happened somewhere else.
   * A wrong provenance in an audit log is worse than a vague one.
   */
  origin?: string;
  /** Free-text search, owned by the caller so one box can drive several tables. */
  query?: string;
}

const POLL_MS = 5_000;

function clock(iso: string): string {
  const parsed = Date.parse(iso.endsWith("Z") ? iso : `${iso}Z`);
  return Number.isNaN(parsed)
    ? iso.slice(11, 19)
    : new Date(parsed).toLocaleTimeString("en-GB", { hour12: false });
}

function age(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
  return `${fmt(seconds / 3600, 1)}h`;
}

export default function WorkingOrders({
  source,
  focusSymbol,
  isStale = false,
  active = true,
  operatorToken,
  onChanged,
  onFocusSymbol,
  origin = "portfolio panel",
  query = "",
}: WorkingOrdersProps) {
  const [rows, setRows] = useState<WorkingOrderRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [amending, setAmending] = useState<string | null>(null);
  const [draftPrice, setDraftPrice] = useState("");

  const sandbox = source === "sandbox";

  const load = useCallback(async () => {
    // Never `/api/gateway/portfolio` from a component — that snapshot has one
    // owner, `lib/use-book.ts`, so two tabs can never disagree about the book.
    // Through the connection manager for its 2.5s deadline. This was a bare
    // fetch: a gateway that accepted and never answered left `loaded` false and
    // the panel on its skeleton for as long as the tab stayed open.
    const outcome = await probeGateway<{ rows?: unknown[] }>("/api/gateway/orders/working");
    if (!outcome.ok) {
      setError(outcome.failure.timedOut
        ? "the working-order feed did not answer in time"
        : "the working-order feed is unreachable");
      setLoaded(true);
      return;
    }
    const parsed = (Array.isArray(outcome.payload?.rows) ? outcome.payload.rows : [])
      .map(toWorkingOrder)
      .filter((row: WorkingOrderRow | null): row is WorkingOrderRow => row !== null);
    setRows(parsed);
    setError(null);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (sandbox) {
      setRows(sandboxWorkingOrders());
      setLoaded(true);
      return;
    }
    if (!active || source === "unavailable") return;
    void load();
  }, [active, sandbox, source, load]);

  /* Was `window.setInterval(load, 5000)` with no `document.hidden` check and no
     backoff: a backgrounded tab kept asking for the working-order book every
     five seconds, and a refusing gateway was asked twelve times a minute
     forever. The controller carries both. */
  usePolling({
    tick: load,
    intervalMs: POLL_MS,
    maxBackoffMs: 60_000,
    enabled: !sandbox && active && source !== "unavailable",
  });

  const mutate = useCallback(async (path: string, body: unknown, orderId: string) => {
    setBusy(orderId);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(operatorToken ? { authorization: `Bearer ${operatorToken}` } : {}),
        },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.detail ?? payload?.error ?? `gateway returned ${response.status}`);
        return;
      }

      // A replacement is cancel-and-new, and the route deliberately relays a
      // gate rejection at HTTP 200 with the whole decision — a rejection is a
      // result, not a transport error. Reading only the status was the bug: the
      // original order is gone either way, so a rejected replacement made the
      // row vanish from this table with nothing said. The desk would have
      // discovered it by noticing an order it thought was resting was not.
      const decision = payload?.decision;
      if (decision && decision.accepted === false) {
        const gates: string[] = Array.isArray(decision.rejected_by) ? decision.rejected_by : [];
        setError(
          `The replacement was refused by ${gates.join(", ") || "a pre-trade gate"}`
          + ` — and the original order is already cancelled, so nothing is resting for ${orderId} now.`
          + (decision.reason ? ` ${decision.reason}` : ""),
        );
        await load();
        onChanged?.();
        return;
      }

      setError(null);
      await load();
      onChanged?.();
    } catch {
      setError("the request did not reach the gateway");
    } finally {
      setBusy(null);
      setAmending(null);
    }
  }, [operatorToken, load, onChanged]);

  // `visible` is what the table and the export show; `rows` stays the
  // unfiltered truth so the committed total below still reports the whole
  // resting book rather than whatever the search happens to match.
  const visible = filterWorkingOrders(rows, query);
  const committed = rows.reduce((acc, row) => acc + row.notional, 0);
  const writesDisabled = sandbox || isStale || source === "unavailable";

  return (
    <div className="card">
      <div className="portfolio-card-heading">
        <div>
          <span className="page-kicker">
            {sandbox ? "Sandbox book (generated)" : "Committed, not yet spent"}
          </span>
          <h2>Working orders</h2>
        </div>
        <div className="blotter-toolbar">
          <span>
            {rows.length
              ? `${usd(committed, 0)} across ${rows.length} order${rows.length === 1 ? "" : "s"}`
              : "nothing resting"}
            {visible.length !== rows.length ? `, showing ${visible.length}` : ""}
          </span>
          {/* Its own header, not the blotter's 18 columns: a resting order has
              no verdict, no fill and no latency, and exporting it through that
              contract would write four empty cells a reader would take for
              missing data rather than for "not yet".

              The same RowMenu as OrderBlotter's, so flipping the Blotter view
              seg does not swap the export affordance mid-toolbar: one 3-dot
              menu in one position, its name carrying the on-screen count, CSV
              and JSON in both places. */}
          <RowMenu label={`Export the rows on screen (${visible.length})`}>
            <button
              type="button"
              role="menuitem"
              disabled={!visible.length}
              title="Download exactly the resting orders on screen as CSV"
              onClick={() => download(
                `alphaengine-working-${source}-${visible.length}rows-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.csv`,
                workingOrdersToCsv(visible),
                "text/csv",
              )}
            >
              Export CSV
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!visible.length}
              title="Download exactly the resting orders on screen as JSON"
              onClick={() => download(
                `alphaengine-working-${source}-${visible.length}rows-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.json`,
                JSON.stringify(visible, null, 2),
                "application/json",
              )}
            >
              Export JSON
            </button>
          </RowMenu>
        </div>
      </div>

      {sandbox && (
        // Rendered on every pass, never as a one-time notice: a caption a reader
        // scrolled past is a caption that is not there.
        <div className="banner warn sandbox-banner" role="status">
          <span aria-hidden>◆</span>
          <div>
            <strong>Generated resting orders.</strong> These were never sent anywhere and cannot be
            cancelled; the actions below are disabled rather than hidden.
          </div>
        </div>
      )}

      {error && (
        <div className="banner error" role="alert">
          <span aria-hidden>▲</span>
          <div>{error}</div>
        </div>
      )}

      {!rows.length ? (
        <p className="muted">
          {!loaded
            ? "Reading the resting book…"
            : source === "unavailable"
              ? "No gateway is configured in this deployment, so there is no resting book to read."
              : "Nothing is resting. Every accepted order so far crossed the spread and filled immediately."}
        </p>
      ) : (
        <div className="table-wrap" tabIndex={0}>
          <table>
            <caption className="sr-only">
              Orders resting on the book, with the capital each commits and how far it sits from the mark.
            </caption>
            <thead>
              <tr>
                <th scope="col">Placed</th>
                <th scope="col">Instrument</th>
                <th scope="col">Side</th>
                <th scope="col">Type</th>
                <th scope="col">Quantity</th>
                <th scope="col">Limit</th>
                <th scope="col">Committed</th>
                <th scope="col">From mark</th>
                <th scope="col">Strategy</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.orderId} className={row.symbol === focusSymbol ? "is-best" : undefined}>
                  <th scope="row">
                    {clock(row.acceptedAt)}
                    <small className="muted">, {age(row.ageSeconds)}</small>
                  </th>
                  <td>
                    {onFocusSymbol ? (
                      <button type="button" className="text-action" onClick={() => onFocusSymbol(row.symbol)}>
                        {row.symbol}
                      </button>
                    ) : row.symbol}
                  </td>
                  <td className={row.side === "SELL" ? "neg" : "pos"}>{row.side}</td>
                  <td>
                    {row.orderType}
                    <small className="muted"> {row.timeInForce}</small>
                  </td>
                  <td className="num">{fmt(row.quantity, row.quantity < 10 ? 4 : 2)}</td>
                  <td className="num">{fmt(row.limitPrice, row.limitPrice < 10 ? 4 : 2)}</td>
                  <td className="num">{usd(row.notional, 0)}</td>
                  <td className={`num ${row.distanceBps == null ? "muted" : row.distanceBps < 0 ? "neg" : "pos"}`}>
                    {row.distanceBps == null
                      // Null, never zero. "At the touch" and "nobody is quoting
                      // this" are opposite claims about the same instrument.
                      ? <span title="No live mark to measure against">— no mark</span>
                      : `${row.distanceBps > 0 ? "+" : ""}${fmt(row.distanceBps, 1)} bps`}
                  </td>
                  <td className="muted">{row.strategy ?? "—"}</td>
                  <td>
                    {amending === row.orderId ? (
                      <div className="portfolio-row-actions">
                        <input
                          className="allocation-target-input"
                          type="text"
                          inputMode="decimal"
                          aria-label={`New limit price for ${row.symbol}`}
                          value={draftPrice}
                          autoFocus
                          onChange={(event) => setDraftPrice(event.target.value)}
                          onKeyDown={(event) => { if (event.key === "Escape") setAmending(null); }}
                        />
                        <button
                          type="button"
                          disabled={busy === row.orderId || !Number.isFinite(Number(draftPrice))}
                          onClick={() => void mutate(
                            `/api/gateway/orders/${encodeURIComponent(row.orderId)}/replace`,
                            { limit_price: Number(draftPrice), reason: `amended from the ${origin}` },
                            row.orderId,
                          )}
                        >
                          Send
                        </button>
                        <button type="button" onClick={() => setAmending(null)}>Cancel edit</button>
                      </div>
                    ) : (
                      <div className="portfolio-row-actions">
                        <button
                          type="button"
                          disabled={writesDisabled || busy === row.orderId}
                          title={
                            sandbox ? "Generated orders cannot be amended."
                              : isStale ? "Reconnect the portfolio gateway before amending."
                                : "Replace this order at a new limit — it faces every gate again"
                          }
                          onClick={() => { setAmending(row.orderId); setDraftPrice(String(row.limitPrice)); }}
                        >
                          Amend
                        </button>
                        <button
                          type="button"
                          disabled={writesDisabled || busy === row.orderId}
                          title={
                            sandbox ? "Generated orders cannot be cancelled."
                              : isStale ? "Reconnect the portfolio gateway before cancelling."
                                : "Pull this order off the book"
                          }
                          onClick={() => void mutate(
                            `/api/gateway/orders/${encodeURIComponent(row.orderId)}/cancel`,
                            { reason: `cancelled from the ${origin}` },
                            row.orderId,
                          )}
                        >
                          {busy === row.orderId ? "…" : "Cancel"}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <details className="disclosure">
        <summary>How a resting order is projected against the pre-trade caps</summary>
        {/* Opened by calling a resting order committed capital — the kicker and the Committed column. */}
        <p className="research-note">
          The pre-trade gates already treat a resting order as committed capital: a new order is
          projected against the worst side of this book filling, so two orders that each pass a
          symbol cap alone cannot pass it together. Filling one is not modelled as a queue — it fills
          in full the moment the consolidated touch crosses it, which is optimistic.
        </p>
      </details>
    </div>
  );
}
