"use client";

/**
 * Portfolio manager's tab: what the book owns, and whether the shape of it is
 * the shape that was intended.
 *
 * The limits themselves live on the Risk tab. What stays here is the subset a PM
 * acts on — how much of each cap is spent, and which one binds first — because
 * "should I add to this sleeve" is an allocation question answered by a limit,
 * and sending someone to another tab to learn they have no room would make this
 * page lie by omission.
 */

import { useState } from "react";

import AllocationDonut from "@/components/portfolio/AllocationDonut";
import AllocationPanel from "@/components/portfolio/AllocationPanel";
import { BookChrome, BookFallback, CrossLinkTile } from "@/components/portfolio/BookChrome";
import EquityCurve from "@/components/portfolio/EquityCurve";
import ExecutionHandoff, { type HandoffIntent } from "@/components/portfolio/ExecutionHandoff";
import { compact, fmt, pct, signedPct, usd } from "@/lib/format";
import { bookStatus } from "@/lib/portfolio";
import type { BookView } from "@/lib/use-book";

export type PortfolioFocusDestination = "research" | "live" | "data";

export interface PortfolioWorkspaceProps {
  view: BookView;
  workspaceSymbol: string;
  onFocusSymbol: (symbol: string, destination: PortfolioFocusDestination) => void;
  onOpenRisk: () => void;
  /** Operator credential shared with the Reliability tab and the header. */
  operatorToken?: string;
}

export default function PortfolioWorkspace({
  view,
  workspaceSymbol,
  onFocusSymbol,
  onOpenRisk,
  operatorToken,
}: PortfolioWorkspaceProps) {
  const [handoff, setHandoff] = useState<HandoffIntent | null>(null);
  const selectedSymbol = workspaceSymbol.trim().toUpperCase();

  const {
    book,
    isStale,
    risk,
    riskPositions,
    covarianceModel,
    allocationLimits,
    riskShare,
    betaBySymbol,
    equityTrack,
    periods,
    historyBackfilled,
    refresh,
  } = view;

  const fallback = <BookFallback view={view} onOpenResearch={() => onFocusSymbol(selectedSymbol, "research")} />;
  if (!book) return fallback;

  const binding = book.risk_budget.binding_constraint;
  const positions = book.exposure.positions;
  const strategies = book.attribution.by_strategy ?? [];
  const status = bookStatus(book);
  const statusColor =
    status.level === "halted" || status.level === "critical"
      ? "var(--critical-text)"
      : status.level === "elevated"
        ? "var(--warning-text)"
        : "var(--success-text)";

  return (
    <>
      <BookChrome view={view} />

      <section className="portfolio-metrics" aria-label="Portfolio summary">
        <div>
          <span>Equity</span>
          <strong className="num">{usd(book.equity.current, 0)}</strong>
          <small>start {usd(book.equity.start_of_day, 0)}</small>
        </div>
        <div>
          <span>Day P&amp;L</span>
          <strong className={`num ${book.equity.daily_pnl >= 0 ? "pos" : "neg"}`}>{usd(book.equity.daily_pnl, 0)}</strong>
          <small>{signedPct(book.equity.daily_return)}</small>
        </div>
        <div>
          <span>Exposure</span>
          <strong className="num">{usd(book.exposure.gross, 0)}</strong>
          <small>
            net {usd(book.exposure.net, 0)} · {fmt(book.exposure.leverage, 2)}× · {positions.length} position{positions.length === 1 ? "" : "s"}
          </small>
        </div>
        <div>
          <span>Binding constraint</span>
          <strong>{binding[0].replace("_", " ")}</strong>
          <small className="num">{fmt(binding[1] * 100, 1)}% utilized</small>
        </div>
        <div>
          <span>Concentration</span>
          <strong className="num">{fmt(book.concentration.effective_positions, 1)}</strong>
          <small>effective positions · largest {fmt(book.concentration.largest_share * 100, 1)}%</small>
        </div>
        <div>
          <span>Status</span>
          {/* Derived from the tightest constraint, never asserted. A green light
              that is not computed from the limits is worse than no light. */}
          <strong style={{ color: statusColor }}>
            <span aria-hidden>{status.glyph}</span> {status.label}
          </strong>
          <small>{status.detail}</small>
        </div>
      </section>

      <div className="card portfolio-positions-card">
        <div className="portfolio-card-heading">
          <div>
            {/* Sandbox first: `isStale` is forced false in sandbox, so keying on
                it alone would caption generated positions as a "Live book". */}
            <span className="page-kicker">
              {book.sandbox ? "Sandbox book (generated)" : isStale ? "Last known book" : "Live book"}
            </span>
            <h2>Positions</h2>
          </div>
          <span>{usd(book.exposure.gross, 0)} gross</span>
        </div>

        {positions.length ? (
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Current portfolio positions and their measured risk contributions</caption>
              <thead>
                <tr>
                  <th>Instrument</th>
                  <th>Side</th>
                  <th>Notional</th>
                  <th>Share</th>
                  <th>Mark</th>
                  <th>Total P&amp;L</th>
                  <th>β</th>
                  <th>Vol contrib</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {positions.map((position) => (
                  <tr key={position.symbol}>
                    <th scope="row">{position.symbol}</th>
                    <td className={position.side === "SHORT" ? "neg" : "pos"}>{position.side}</td>
                    <td>{usd(position.notional, 0)}</td>
                    <td>{fmt(position.share_of_gross * 100, 1)}%</td>
                    <td>{fmt(position.mark_price, position.mark_price < 10 ? 4 : 2)}</td>
                    <td className={position.total_pnl >= 0 ? "pos" : "neg"}>{usd(position.total_pnl, 0)}</td>
                    <td>
                      {betaBySymbol.get(position.symbol) == null ? (
                        <span className="muted" title="Not enough aligned price history to measure">—</span>
                      ) : (
                        fmt(betaBySymbol.get(position.symbol)!, 2)
                      )}
                    </td>
                    <td className={(riskShare.get(position.symbol) ?? 0) < 0 ? "pos" : undefined}>
                      {riskShare.has(position.symbol) ? (
                        <>
                          {pct(riskShare.get(position.symbol)!, 1)}
                          {/* A hedge takes risk out; naming it stops a negative
                              percentage reading as an error. */}
                          {(riskShare.get(position.symbol) ?? 0) < 0 && <span className="muted"> hedge</span>}
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <div className="portfolio-row-actions">
                        <button
                          onClick={() => onFocusSymbol(position.symbol, "live")}
                          disabled={isStale}
                          title={isStale ? "Reconnect the portfolio gateway before opening execution." : undefined}
                        >
                          Trade
                        </button>
                        <button onClick={() => onFocusSymbol(position.symbol, "research")}>Research</button>
                        <button
                          onClick={() => setHandoff({
                            kind: "flatten_symbol",
                            symbol: position.symbol,
                            side: position.side === "SHORT" ? "SHORT" : "LONG",
                            notional: position.notional,
                          })}
                          title="Show the authenticated request that closes this position"
                        >
                          Close
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="portfolio-empty-book">
            <strong>No open positions</strong>
            <p>
              {isStale
                ? "The last successful snapshot was flat. Reconnect before relying on current exposure."
                : "The risk gateway is connected and the book is flat. Research candidates remain available for review."}
            </p>
            <button onClick={() => onFocusSymbol(selectedSymbol, "research")}>Open research workspace</button>
          </div>
        )}
      </div>

      <div className="portfolio-main-grid">
        <EquityCurve
          periods={periods}
          backfilled={historyBackfilled}
          points={equityTrack}
          startOfDay={book.equity.start_of_day}
          haltLevel={book.risk_budget.daily_drawdown.equity_at_halt}
          generated={Boolean(book.sandbox)}
        />
        <AllocationDonut
          positions={positions}
          gross={book.exposure.gross}
          effectivePositions={book.concentration.effective_positions}
          largestShare={book.concentration.largest_share}
          hhi={book.concentration.hhi}
        />
      </div>

      <AllocationPanel
        positions={riskPositions}
        model={covarianceModel}
        limits={allocationLimits}
      />

      {/* Risk lives on its own tab now. What a PM needs before adding to a
          sleeve is how much room is left, so the headline numbers come along and
          the full engine is one click away. */}
      <CrossLinkTile
        kicker="Owned by the risk desk"
        title="Limits and tail risk"
        actionLabel="Open Risk"
        onNavigate={onOpenRisk}
        metrics={[
          {
            label: "VaR 95 · 1 day",
            value: risk ? usd(risk.var95, 0) : "—",
            note: risk
              ? `${pct(risk.var95 / Math.max(1, book.equity.current), 2)} of equity`
              : "needs price history",
          },
          {
            label: "Gross headroom",
            value: usd(book.risk_budget.gross_exposure.remaining, 0),
            note: `${fmt(book.risk_budget.gross_exposure.utilisation * 100, 1)}% of the cap in use`,
            tone: book.risk_budget.gross_exposure.utilisation >= 0.9 ? "warn" : undefined,
          },
          {
            label: "Drawdown cushion",
            value: usd(book.risk_budget.daily_drawdown.cushion_usd, 0),
            note: `${fmt(book.risk_budget.daily_drawdown.used_pct * 100, 2)}% of ${fmt(book.risk_budget.daily_drawdown.limit_pct * 100, 2)}% used`,
            tone: book.risk_budget.daily_drawdown.utilisation >= 0.8 ? "warn" : undefined,
          },
          {
            label: "Binding constraint",
            value: binding[0].replace("_", " "),
            note: `${fmt(binding[1] * 100, 1)}% utilized`,
          },
        ]}
      />

      <div className="card portfolio-attribution-card">
        <div className="portfolio-card-heading">
          <div>
            <span className="page-kicker">Execution attribution</span>
            <h2>Strategy flow</h2>
          </div>
          <span>
            {book.sandbox
              ? "Generated activity — no audit log behind these rows"
              : isStale ? "Last known audit-backed activity" : "Audit-backed order activity"}
          </span>
        </div>
        {strategies.length ? (
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Order activity and performance attributed by strategy</caption>
              <thead>
                <tr>
                  <th>Strategy</th>
                  <th>Orders</th>
                  <th>Accepted</th>
                  <th>Notional</th>
                  <th>Realised P&amp;L</th>
                  <th>Fees</th>
                  <th>Avg slippage</th>
                </tr>
              </thead>
              <tbody>
                {strategies.map((strategy, index) => (
                  <tr key={`${strategy.strategy ?? "unattributed"}-${index}`}>
                    <th scope="row">{strategy.strategy || "Unattributed"}</th>
                    <td>{strategy.orders}</td>
                    <td>{strategy.filled}</td>
                    <td>${compact(strategy.notional ?? 0)}</td>
                    <td className={
                      strategy.realized_pnl == null ? undefined : strategy.realized_pnl >= 0 ? "pos" : "neg"
                    }>
                      {strategy.realized_pnl == null ? "—" : usd(strategy.realized_pnl, 0)}
                    </td>
                    <td>{usd(strategy.fees ?? 0, 2)}</td>
                    <td>{strategy.avg_slippage_bps == null ? "—" : `${fmt(strategy.avg_slippage_bps, 2)} bps`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="portfolio-attribution-empty">No audited order flow has been recorded for this session.</p>
        )}
      </div>

      <ExecutionHandoff
        intent={handoff}
        onClose={() => setHandoff(null)}
        sandbox={Boolean(book.sandbox)}
        onExecuted={() => void refresh(true)}
        operatorToken={operatorToken}
      />
    </>
  );
}
