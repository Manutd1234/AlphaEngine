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

import LatencyHistogram from "@/components/execution/LatencyHistogram";
import { effectiveSpreadBps, priceImprovement, type BlotterRow, type ExecutionSummary } from "@/lib/blotter";
import { fmt, formatDuration, pct, usd } from "@/lib/format";

interface ExecutionQualityProps {
  summary: ExecutionSummary;
  symbol: string;
  symbolOrders: BlotterRow[];
  /** The rows the summary was computed from — the distribution needs them all. */
  rows?: BlotterRow[];
  /** Where the rows behind these numbers came from. */
  source?: "live" | "sandbox" | "unavailable";
}

export default function ExecutionQuality({ summary, symbol, symbolOrders, rows = [], source = "live" }: ExecutionQualityProps) {
  const improvement = priceImprovement(rows ?? []);
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
                ? `Measured over ${summary.orders} generated decisions; same maths, seeded rows.`
                : summary.orders
                  ? `Measured over the ${summary.orders} most recent decisions.`
                  : "Waiting for the first decision."}
          </p>
        </div>
      </header>

      {!summary.orders ? (
        <p className="muted">
          {source === "unavailable"
            ? "Nothing to measure without a source."
            : "Nothing sent yet, so there is nothing to measure."}
        </p>
      ) : (
        <>
          <dl className="cockpit-quality__metrics">
            <div>
              <dt>Fill rate</dt>
              <dd>{pct(summary.fillRate, 0)}</dd>
              <span className="muted">{summary.accepted} filled, {summary.rejected} rejected</span>
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
              {/* "Median gate latency", not "median latency". This is time inside
                  the pre-trade battery; no order-to-fill duration exists in the
                  audit row, and dropping the qualifier to match a shorter label
                  would be the one dishonest edit available on this panel. */}
              <dt>Median gate latency</dt>
              {/* The wire carries ms; the desk shows the unit the value earns
                  (a 0.21 ms decision reads 210 µs). Null stays a dash inside
                  the formatter — never "0 ns". */}
              <dd>{formatDuration(summary.p50LatencyMs, "ms")}</dd>
              <span className="muted">
                p90 {formatDuration(summary.p90LatencyMs, "ms")},
                p99 {formatDuration(summary.p99LatencyMs, "ms")}
              </span>
            </div>
            <div>
              <dt>Price improvement</dt>
              <dd>{improvement.rate != null ? pct(improvement.rate, 0) : "—"}</dd>
              <span className="muted">
                {improvement.n
                  ? <>{improvement.improved} of {improvement.n} beat the mid{improvement.meanBps != null ? `; mean ${fmt(improvement.meanBps, 1)} bps` : ""}</>
                  : "no priced fills"}
              </span>
            </div>
          </dl>

          {/* Zero here is a correct reading of a generated desk, not a broken
              panel, and saying so is cheaper than leaving a reader to wonder.
              sandboxBlotter draws slippage strictly positive, so its fills are
              taker-side by construction; a live gateway's maker fills carry
              negative slippage by design (risk_proxy.py `_maker_fill`). */}
          {source === "sandbox" && improvement.n > 0 && improvement.improved === 0 && (
            <p className="muted cockpit-quality__caveat">
              Sandbox fills are taker-side by construction, so none can beat the mid.
            </p>
          )}

          {/* One wrapper, two peer histograms. At desk width the density
              partial (14d) lays them side by side — they are the same shape
              answering neighbouring questions, and stacked they spent two
              rows on one reading. Each block keeps its own caption and its
              own fold; below the breakpoint this div is plain block flow and
              the stack is exactly what it was. */}
          <div className="cockpit-quality__distributions">
          <div className="cockpit-quality__distribution">
            <span className="field">Gate latency distribution</span>
            <LatencyHistogram
              values={rows.map((r) => r.latencyMs).filter((v): v is number => v != null)}
              ariaLabel="Distribution of gate decision latency"
              format={(v) => formatDuration(v, "ms")}
            />
            {/* A chart-reading rule, not a measurement. What the axis is
                bounded to stays at rest twice over — the tile above reads
                "Median gate latency" and this chart's own field label reads
                "Gate latency distribution" — so what folds is the spelt-out
                negation and, on a generated desk, why the shape is flat. Every
                figure the reader acts on (p50, p90, p99, the bars) is still on
                screen. */}
            <details className="disclosure">
              <summary>What this latency measures</summary>
              <small className="muted">
                Time inside the pre-trade battery, not order-to-fill.
                {source === "sandbox"
                  ? " Sandbox latencies are generated uniform 140–250 µs; the flat shape is the generator."
                  : ""}
              </small>
            </details>
          </div>

          {/* The distribution that is actually about fill quality. The one above
              times the gate; this one times nothing — it measures what each fill
              cost, which is the question this subtab is named for. */}
          <div className="cockpit-quality__distribution">
            <span className="field">Effective spread distribution</span>
            <LatencyHistogram
              values={rows.map(effectiveSpreadBps).filter((v): v is number => v != null)}
              unit="bps"
              unitLong="basis points"
              noun="fills"
              ariaLabel="Distribution of effective spread across fills"
            />
          </div>
          </div>

          {summary.topRejectReason ? (
            <p className="notice">
              Most frequent block: <strong>{summary.topRejectReason.gate}</strong> ({summary.topRejectReason.count}
              {summary.topRejectReason.count === 1 ? " order" : " orders"}). If that is not deliberate, the size
              is wrong for the limit.
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
