"use client";

/**
 * Execution quality over the current blotter window.
 *
 * Fill rate, realised slippage, cost and tail latency — the four numbers an
 * execution review argues about. They are computed from the same rows shown
 * below rather than fetched separately, so what the trader sees summarised is
 * provably the same set of orders they can scroll through.
 *
 * Tail latency, not average. The mean decision time hides the one order in a
 * hundred that took long enough to miss its price, and that order is the whole
 * reason anyone measures this.
 *
 * The most-common rejection gate is called out because it is the one piece of
 * this panel that tells a trader what to *change*: a desk rejected ten times by
 * the same limit is a sizing conversation, not an execution problem.
 */

import type { BlotterRow, ExecutionSummary } from "@/lib/blotter";
import { fmt, pct, usd } from "@/lib/format";

interface ExecutionQualityProps {
  summary: ExecutionSummary;
  symbol: string;
  symbolOrders: BlotterRow[];
  /** Where the rows behind these numbers came from. */
  source?: "live" | "sandbox" | "unavailable";
}

export default function ExecutionQuality({ summary, symbol, symbolOrders, source = "live" }: ExecutionQualityProps) {
  const symbolFills = symbolOrders.filter((o) => o.accepted);
  const symbolSlippage = symbolFills
    .map((o) => o.slippageBps)
    .filter((v): v is number => v != null);
  const symbolAvg = symbolSlippage.length
    ? symbolSlippage.reduce((a, b) => a + b, 0) / symbolSlippage.length
    : null;

  return (
    <section className="card cockpit-quality">
      <header className="section-heading compact">
        <div>
          <h3>Execution quality</h3>
          <p className="muted">
            {/* "Measured over the 0 most recent decisions" reads like a bug, and
                blaming desk inactivity for a missing source is a lie by
                implication — say which one it is. */}
            {source === "unavailable"
              ? "No decision history is reachable in this deployment."
              : source === "sandbox"
                ? `Measured over ${summary.orders} generated decisions — same maths, seeded rows.`
                : summary.orders
                  ? `Measured over the ${summary.orders} most recent decisions.`
                  : "Waiting for the first decision."}
          </p>
        </div>
      </header>

      {!summary.orders ? (
        <p className="muted">
          {source === "unavailable"
            ? "There is nothing to measure without a source."
            : "Nothing has been sent yet, so there is nothing to measure."}
        </p>
      ) : (
        <>
          <dl className="cockpit-quality__metrics">
            <div>
              <dt>Fill rate</dt>
              <dd>{pct(summary.fillRate, 0)}</dd>
              <span className="muted">{summary.accepted} filled · {summary.rejected} rejected</span>
            </div>
            <div>
              <dt>Avg slippage</dt>
              <dd>{summary.avgSlippageBps != null ? `${fmt(summary.avgSlippageBps, 1)} bps` : "—"}</dd>
              <span className="muted">
                worst {summary.worstSlippageBps != null ? `${fmt(summary.worstSlippageBps, 1)} bps` : "—"}
              </span>
            </div>
            <div>
              <dt>Fees paid</dt>
              <dd>{usd(summary.totalFees, 2)}</dd>
              <span className="muted">on filled notional</span>
            </div>
            <div>
              <dt>Gate latency</dt>
              <dd>{summary.p50LatencyMs != null ? `${fmt(summary.p50LatencyMs, 2)} ms` : "—"}</dd>
              <span className="muted">
                p99 {summary.p99LatencyMs != null ? `${fmt(summary.p99LatencyMs, 2)} ms` : "—"}
              </span>
            </div>
          </dl>

          {summary.topRejectReason ? (
            <p className="notice">
              Most frequent block: <strong>{summary.topRejectReason.gate}</strong> ({summary.topRejectReason.count}
              {summary.topRejectReason.count === 1 ? " order" : " orders"}). If that is not deliberate, the size is
              wrong for the limit — not the other way round.
            </p>
          ) : null}

          <p className="muted cockpit-quality__symbol">
            {symbolFills.length
              ? <>{symbol}: {symbolFills.length} fills, average slippage {symbolAvg != null ? `${fmt(symbolAvg, 1)} bps` : "—"}.</>
              : <>No fills for {symbol} in this window.</>}
          </p>
        </>
      )}
    </section>
  );
}
