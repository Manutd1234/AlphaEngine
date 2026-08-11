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
 *
 * The four sections answer four different questions and were one scroll until
 * they were split: what is the book worth (overview), what exactly is in it
 * (positions), what should be in it (allocation), and which sleeve earned it
 * (performance). Real-time monitoring and static target allocation are not the
 * same activity, and a page that interleaves them asks the reader to hold both
 * at once.
 */

import { useState } from "react";

import NumberTicker from "@/components/common/NumberTicker";
import RowMenu from "@/components/common/RowMenu";
import AllocationDonut from "@/components/portfolio/AllocationDonut";
import AllocationPanel from "@/components/portfolio/AllocationPanel";
import { BookChrome, BookFallback, BookSourceControl, CrossLinkTile } from "@/components/portfolio/BookChrome";
import EquityCurve from "@/components/portfolio/EquityCurve";
import ExecutionHandoff, { type HandoffIntent } from "@/components/portfolio/ExecutionHandoff";
import PnlWaterfall from "@/components/portfolio/PnlWaterfall";
import WorkingOrders from "@/components/portfolio/WorkingOrders";
import WorkspaceSubtabs, { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
import { compact, fmt, pct, signedPct, usd } from "@/lib/format";
import { buildPnlWaterfall } from "@/lib/pnl-attribution";
import { proposeAllocation } from "@/lib/portfolio-risk";
import { bookStatus } from "@/lib/portfolio";
import { PORTFOLIO_SECTIONS, type PortfolioSection } from "@/lib/sections";
import type { BookView } from "@/lib/use-book";

export type PortfolioFocusDestination = "research" | "live" | "data";

export interface PortfolioWorkspaceProps {
  view: BookView;
  workspaceSymbol: string;
  onFocusSymbol: (symbol: string, destination: PortfolioFocusDestination) => void;
  onOpenRisk: () => void;
  /** Operator credential shared with the Reliability tab and the header. */
  operatorToken?: string;
  section: PortfolioSection;
  onSectionChange: (section: PortfolioSection) => void;
}

export { PORTFOLIO_SECTION_IDS, type PortfolioSection } from "@/lib/sections";

/** Positions shown in the overview summary before it defers to the full table. */
const SUMMARY_ROWS = 5;

/**
 * `attribution.by_symbol` and `execution_quality` are typed as loose records
 * because the gateway's own shape has widened twice. A field that is absent, or
 * present as something other than a finite number, reads as "not measured"
 * rather than as zero.
 */
function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export default function PortfolioWorkspace({
  view,
  workspaceSymbol,
  onFocusSymbol,
  onOpenRisk,
  operatorToken,
  section,
  onSectionChange,
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
    referenceSymbol,
    referenceSessionReturn,
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

  // Moving focus with the section is what makes the jump usable from a keyboard:
  // the rail is a tablist, so landing on the tab itself puts the arrow keys back
  // in reach instead of stranding the caret wherever the link was.
  const openSection = (next: PortfolioSection) => {
    onSectionChange(next);
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => document.getElementById(`portfolio-subtab-${next}`)?.focus());
    }
  };

  const waterfall = buildPnlWaterfall({
    book,
    positions: riskPositions,
    betaBySymbol,
    referenceSymbol,
    referenceReturn: referenceSessionReturn,
  });

  // `by_symbol` and `execution_quality` have been in the payload since the
  // gateway learned to build it and were rendered nowhere. Both are typed as
  // loose records, so every field is read defensively and a missing one stays
  // "—" rather than becoming a zero nobody measured.
  const symbolFlow = (book.attribution.by_symbol ?? [])
    .map((row) => ({
      symbol: typeof row.symbol === "string" ? row.symbol : null,
      orders: numberOrNull(row.orders),
      filled: numberOrNull(row.filled),
      rejected: numberOrNull(row.rejected),
      fees: numberOrNull(row.fees),
      avgLatencyMs: numberOrNull(row.avg_latency_ms),
    }))
    .filter((row): row is typeof row & { symbol: string } => row.symbol !== null);

  const quality = book.execution_quality ?? {};
  const executionTiles = [
    {
      label: "Fill rate",
      value: numberOrNull(quality.total) && numberOrNull(quality.accepted) != null
        ? pct((numberOrNull(quality.accepted) ?? 0) / (numberOrNull(quality.total) || 1), 1)
        : null,
      note: `${numberOrNull(quality.accepted) ?? "—"} of ${numberOrNull(quality.total) ?? "—"} orders`,
    },
    {
      label: "Avg slippage",
      value: numberOrNull(quality.avg_slippage_bps) == null
        ? null
        : `${fmt(numberOrNull(quality.avg_slippage_bps)!, 2)} bps`,
      note: "unweighted mean across fills",
    },
    {
      label: "p99 latency",
      value: numberOrNull(quality.p99_latency_ms) == null
        ? null
        : `${fmt(numberOrNull(quality.p99_latency_ms)!, 2)} ms`,
      note: `p50 ${numberOrNull(quality.p50_latency_ms) == null ? "—" : fmt(numberOrNull(quality.p50_latency_ms)!, 2)} ms`,
    },
    {
      label: "Fees paid",
      value: numberOrNull(quality.total_fees) == null ? null : usd(numberOrNull(quality.total_fees)!, 2),
      note: "lifetime, across every session",
    },
  ].filter((tile): tile is typeof tile & { value: string } => tile.value !== null);

  // Book-level drift against the panel's default target. Half the sum of the
  // absolute drifts, because every dollar that has to move is counted once on
  // the way out and once on the way in.
  const defaultProposal = covarianceModel
    ? proposeAllocation(riskPositions, covarianceModel, "inverse_vol", allocationLimits)
    : null;
  const bookDrift = defaultProposal
    ? defaultProposal.targets.reduce((acc, t) => acc + Math.abs(t.drift), 0) / 2
    : null;

  // Derived strictly from limits the gateway already publishes. No threshold is
  // invented here: a warning this page made up would be a warning the risk desk
  // never agreed to.
  const alerts: Array<{ tone: "warn" | "critical"; glyph: string; word: string; detail: string }> = [];
  for (const position of positions) {
    const used = position.symbol_limit.utilisation;
    if (used >= 0.9) {
      alerts.push({
        tone: "critical", glyph: "▲", word: "At cap",
        detail: `${position.symbol} is at ${fmt(used * 100, 1)}% of its symbol limit — ${usd(position.symbol_limit.remaining, 0)} of room left.`,
      });
    } else if (used >= 0.75) {
      alerts.push({
        tone: "warn", glyph: "◆", word: "Near cap",
        detail: `${position.symbol} has spent ${fmt(used * 100, 1)}% of its symbol limit.`,
      });
    }
  }
  if (book.risk_budget.gross_exposure.utilisation >= 0.9) {
    alerts.push({
      tone: "critical", glyph: "▲", word: "Gross",
      detail: `Gross exposure is at ${fmt(book.risk_budget.gross_exposure.utilisation * 100, 1)}% of the cap — adding to any sleeve needs room made elsewhere.`,
    });
  }
  if (book.risk_budget.daily_drawdown.utilisation >= 0.8) {
    alerts.push({
      tone: "critical", glyph: "▲", word: "Drawdown",
      detail: `${fmt(book.risk_budget.daily_drawdown.utilisation * 100, 0)}% of the daily drawdown budget is spent; reduce-only engages at 80%.`,
    });
  }

  const largest = [...positions].sort((a, b) => b.notional - a.notional).slice(0, SUMMARY_ROWS);
  const bookLabel = book.sandbox ? "Sandbox book (generated)" : isStale ? "Last known book" : "Live book";

  return (
    <>
      <BookChrome view={view} />

      <WorkspaceSubtabs
        workspaceId="portfolio"
        label="Portfolio manager sections"
        tabs={PORTFOLIO_SECTIONS}
        activeId={section}
        onChange={onSectionChange}
        actions={<BookSourceControl view={view} />}
      />

      <WorkspaceSubtabPanel workspaceId="portfolio" tabId="overview" activeId={section}>
        {alerts.length > 0 && (
          <div className="card portfolio-alerts">
            <div className="portfolio-card-heading">
              <div>
                <span className="page-kicker">Soft limits</span>
                <h2>Wants attention</h2>
              </div>
              <span className="section-note">enforced at the gate</span>
            </div>
            <ul>
              {alerts.map((alert) => (
                <li key={alert.detail} className={`is-${alert.tone}`}>
                  {/* Icon, word and colour together. Colour alone would leave the
                      severity unreadable to anyone who cannot separate the two
                      hues, and these are the rows that matter most. */}
                  <span aria-hidden>{alert.glyph}</span>
                  <strong>{alert.word}</strong>
                  <span>{alert.detail}</span>
                </li>
              ))}
            </ul>
            <p className="research-note">
              Every line here is read off a limit the gateway publishes — nothing on this page
              invents a threshold the risk desk did not set.
            </p>
          </div>
        )}

        {bookDrift != null && bookDrift >= 0.05 && (
          <div className="banner context-change" role="status">
            <div>
              <strong>Book drift is {pct(bookDrift, 1)}</strong> against an inverse-volatility
              target — enough that rebalancing is likely to cost less than the drift does.
            </div>
            <button type="button" onClick={() => openSection("allocation")}>
              Open allocation
            </button>
          </div>
        )}

        <section className="portfolio-metrics" aria-label="Portfolio summary">
          <div>
            <span>Equity</span>
            <strong className="num"><NumberTicker value={book.equity.current} format={(v) => usd(v, 0)} /></strong>
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
            <small>
              effective positions · largest {fmt(book.concentration.largest_share * 100, 1)}% · top two{" "}
              {fmt(book.concentration.top_two_share * 100, 1)}%
            </small>
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

        <button type="button" className="text-action" onClick={() => openSection("equity")}>
          Session equity curve &amp; P&amp;L attribution →
        </button>

        {/* A summary, not a second copy: four columns against the full table's
            nine, and it defers rather than repeating the row actions. Both read
            the same snapshot, so they cannot disagree — but only one of them is
            the place to act on a position. */}
        <div className="card">
          <div className="portfolio-card-heading">
            <div>
              <span className="page-kicker">{bookLabel}</span>
              <h2>Largest exposures</h2>
            </div>
            <button type="button" className="text-action" onClick={() => openSection("positions")}>
              All {positions.length} position{positions.length === 1 ? "" : "s"} →
            </button>
          </div>

          {largest.length ? (
            <div className="table-wrap table-wrap--clamped">
              <table>
                <caption className="sr-only">
                  The {largest.length} largest positions by notional. The full book is in the Positions section.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Instrument</th>
                    <th scope="col">Side</th>
                    <th scope="col">Notional</th>
                    <th scope="col">Share</th>
                    <th scope="col">Total P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {largest.map((position) => (
                    <tr key={position.symbol}>
                      <th scope="row">{position.symbol}</th>
                      <td className={position.side === "SHORT" ? "neg" : "pos"}>{position.side}</td>
                      <td>{usd(position.notional, 0)}</td>
                      <td>{fmt(position.share_of_gross * 100, 1)}%</td>
                      <td className={position.total_pnl >= 0 ? "pos" : "neg"}>{usd(position.total_pnl, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="research-note">The book is flat — there is no exposure to rank.</p>
          )}
        </div>

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
      </WorkspaceSubtabPanel>

      {/* One session read two ways — the path and its decomposition. They left
          the overview because that section had grown to seven panels covering
          alerts, headroom, charts, a positions preview and a risk cross-link;
          the charts are the half a reader comes back to. */}
      <WorkspaceSubtabPanel workspaceId="portfolio" tabId="equity" activeId={section}>
        <div className="compact-grid-2col portfolio-chart-pair">
          <EquityCurve
            periods={periods}
            backfilled={historyBackfilled}
            points={equityTrack}
            startOfDay={book.equity.start_of_day}
            haltLevel={book.risk_budget.daily_drawdown.equity_at_halt}
            generated={Boolean(book.sandbox)}
          />

          <PnlWaterfall waterfall={waterfall} generated={Boolean(book.sandbox)} />
        </div>
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="portfolio" tabId="positions" activeId={section}>
        <div className="card portfolio-positions-card">
          <div className="portfolio-card-heading">
            <div>
              {/* Sandbox first: `isStale` is forced false in sandbox, so keying on
                  it alone would caption generated positions as a "Live book". */}
              <span className="page-kicker">{bookLabel}</span>
              <h2>Positions</h2>
            </div>
            <span>{usd(book.exposure.gross, 0)} gross</span>
          </div>

          {positions.length ? (
            <div className="table-wrap table-wrap--clamped">
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
                        {/* One disclosure rather than three buttons per row.
                            `RowMenu` renders in the top layer so the last rows
                            of this scroller are not clipped — see its header. */}
                        <RowMenu label={`Actions for ${position.symbol}`}>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => onFocusSymbol(position.symbol, "live")}
                            disabled={isStale}
                            title={isStale ? "Reconnect the portfolio gateway before opening execution." : undefined}
                          >
                            Trade
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => onFocusSymbol(position.symbol, "research")}
                          >
                            Research
                          </button>
                          <button
                            type="button"
                            role="menuitem"
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
                        </RowMenu>
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

        {/* Committed capital sits directly under the positions it will become.
            `active` gates the poll: panels stay mounted so a draft survives a
            section switch, which would otherwise leave this fetching behind a
            tab nobody is looking at. */}
        <WorkingOrders
          source={book.sandbox ? "sandbox" : isStale ? "unavailable" : "live"}
          focusSymbol={selectedSymbol}
          isStale={isStale}
          active={section === "positions"}
          operatorToken={operatorToken}
          onChanged={() => void refresh(true)}
          onFocusSymbol={(symbol) => onFocusSymbol(symbol, "research")}
        />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="portfolio" tabId="allocation" activeId={section}>
        <AllocationDonut
          positions={positions}
          gross={book.exposure.gross}
          effectivePositions={book.concentration.effective_positions}
          largestShare={book.concentration.largest_share}
          hhi={book.concentration.hhi}
        />

        <AllocationPanel
          positions={riskPositions}
          model={covarianceModel}
          limits={allocationLimits}
        />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="portfolio" tabId="performance" activeId={section}>
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
            <div className="table-wrap table-wrap--clamped">
              <table>
                <caption className="sr-only">Order activity and performance attributed by strategy</caption>
                <thead>
                  <tr>
                    <th>Strategy</th>
                    <th>Orders</th>
                    <th>Accepted</th>
                    <th>Notional</th>
                    <th>Realised P&amp;L</th>
                    <th>Win rate</th>
                    <th>Closed</th>
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
                        {/* Realised P&L excludes open inventory, so a sleeve still
                            holding risk is only partly scored. Without this the
                            number reads as a final verdict on the sleeve. */}
                        {strategy.has_open_inventory && (
                          <small className="muted" title="This sleeve still holds inventory, so its realised P&L is only part of the story">
                            {" "}· open
                          </small>
                        )}
                      </td>
                      <td className="num">
                        {strategy.win_rate == null ? <span className="muted">—</span> : pct(strategy.win_rate, 0)}
                      </td>
                      <td className="num">
                        {strategy.closed_trades == null ? <span className="muted">—</span> : strategy.closed_trades}
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
          <p className="research-note">
            These totals are lifetime, not session — they cover every order since the audit log was
            opened. The session-scoped costs are the ones the P&amp;L waterfall on Overview uses, and
            mixing the two would subtract a lifetime fee bill from one day&apos;s P&amp;L.
          </p>
        </div>

        {symbolFlow.length > 0 && (
          <div className="card">
            <div className="portfolio-card-heading">
              <div>
                <span className="page-kicker">Execution attribution</span>
                <h2>Flow by instrument</h2>
              </div>
              <span>{symbolFlow.length} instrument{symbolFlow.length === 1 ? "" : "s"} touched</span>
            </div>
            <div className="table-wrap">
              <table>
                <caption className="sr-only">Order flow attributed by instrument</caption>
                <thead>
                  <tr>
                    <th scope="col">Instrument</th>
                    <th scope="col">Orders</th>
                    <th scope="col">Filled</th>
                    <th scope="col">Rejected</th>
                    <th scope="col">Fees</th>
                    <th scope="col">Avg latency</th>
                  </tr>
                </thead>
                <tbody>
                  {symbolFlow.map((row) => (
                    <tr key={row.symbol}>
                      <th scope="row">{row.symbol}</th>
                      <td className="num">{row.orders ?? "—"}</td>
                      <td className="num">{row.filled ?? "—"}</td>
                      <td className={`num ${(row.rejected ?? 0) > 0 ? "neg" : "muted"}`}>{row.rejected ?? "—"}</td>
                      <td className="num">{row.fees == null ? "—" : usd(row.fees, 2)}</td>
                      <td className="num">
                        {row.avgLatencyMs == null
                          ? <span className="muted">—</span>
                          : `${fmt(row.avgLatencyMs, 2)} ms`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="research-note">
              The rejected column is the interesting one: it is where the pre-trade limits actually
              bound, and an instrument that never rejects is either well-sized or never tested.
            </p>
          </div>
        )}

        {executionTiles.length > 0 && (
          <div className="card">
            <div className="portfolio-card-heading">
              <div>
                <span className="page-kicker">Desk-wide, computed by the gateway</span>
                <h2>Execution quality</h2>
              </div>
            </div>
            <div className="tiles stability-tiles">
              {executionTiles.map((tile) => (
                <div key={tile.label} className="stability-tile">
                  <span>{tile.label}</span>
                  <strong className="num">{tile.value}</strong>
                  <small>{tile.note}</small>
                </div>
              ))}
            </div>
            <p className="research-note">
              Latency percentiles rather than an average alone: a mean decision time hides the one
              order in a hundred that took long enough to miss its price, which is the number an
              execution review argues about.
            </p>
          </div>
        )}
      </WorkspaceSubtabPanel>

      {/* Outside every panel on purpose: an in-flight handoff must not vanish
          because the reader changed section while the request was open. */}
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
