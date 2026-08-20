"use client";

/**
 * The Positions section: what is in the book, and the two things a table of it
 * cannot answer by summing.
 *
 * Eight cards in one scroll before the split. Holdings is the book itself, row
 * by row, with the actions on each position. Shape asks where the weight sits
 * against each symbol's own cap and whether a small total P&L is a quiet book
 * or two large offsetting bets. Exit asks what getting out would cost and what
 * capital is already committed to making one — a weight is only as real as the
 * way out of it.
 *
 * Conditional renders rather than `hidden`: a switched-away pane's charts keep
 * their ResizeObservers running behind the pane on screen, and the working
 * orders panel keeps polling the gateway. That last one is why `sectionActive`
 * is a prop rather than a bare `active` — see the note above `<WorkingOrders>`.
 *
 * The pane state is the first thing this component does and nothing returns
 * before it: a selector declared after an early return is the "rendered more
 * hooks than during the previous render" crash on the first snapshot that
 * arrives.
 */

import { useState, type CSSProperties } from "react";

import RowMenu from "@/components/common/RowMenu";
// Type-only, so the workspace that renders this section can keep owning the
// vocabulary of where a symbol click lands. Erased at compile: no import
// cycle survives into the bundle.
import type { PortfolioFocusDestination } from "@/components/PortfolioWorkspace";
import ExposureHeatmap from "@/components/portfolio/ExposureHeatmap";
import LiquidityPanel from "@/components/portfolio/LiquidityPanel";
import UnrealisedSpread from "@/components/portfolio/UnrealisedSpread";
import WorkingOrders from "@/components/portfolio/WorkingOrders";
import type { HandoffIntent } from "@/components/portfolio/ExecutionHandoff";
import { fmt, pct, usd } from "@/lib/format";
import type { PortfolioPayload } from "@/lib/portfolio";
import type { AdvBySymbol } from "@/lib/use-book";

type PositionsPane = "holdings" | "shape" | "exit";

/**
 * Three panes, never four: `.seg button` is `flex: 1`, so a fourth forces
 * abbreviated labels, and it is also the point at which a picker stops being a
 * split and becomes a second navigation the reader has to learn.
 */
const POSITIONS_PANES: Array<{ id: PositionsPane; label: string; hint: string }> = [
  { id: "holdings", label: "Holdings", hint: "Every open position, what it is worth, and the actions on it" },
  { id: "shape", label: "Shape", hint: "Weight against each symbol's own cap, and how unrealised P&L is spread" },
  { id: "exit", label: "Exit", hint: "What getting out costs at a chosen participation rate, and the orders already working" },
];

export interface PositionsSectionProps {
  book: PortfolioPayload;
  /** "Live book", "Last known book" or the sandbox caption — one wording, decided once. */
  bookLabel: string;
  /** A book is on screen but the most recent refresh failed. Writes are disabled. */
  isStale: boolean;
  /** Null per symbol where there is too little aligned history to measure one. */
  betaBySymbol: Map<string, number | null>;
  riskShare: Map<string, number>;
  advBySymbol: AdvBySymbol;
  /** The workspace symbol, already trimmed and upper-cased. */
  selectedSymbol: string;
  /** Operator credential shared with the Reliability tab and the header. */
  operatorToken?: string;
  /**
   * Whether the Positions section is the visible one on a visible tab.
   *
   * The section panel stays mounted once opened, so the section alone left the
   * order poll running behind another pane, and the workspace itself persists
   * behind other tabs — so a hidden tab's poll must stop with its pane's.
   */
  sectionActive: boolean;
  onFocusSymbol: (symbol: string, destination: PortfolioFocusDestination) => void;
  /** Opens the workspace-level handoff dialogue, which outlives this section. */
  onRequestHandoff: (intent: HandoffIntent) => void;
  onRefresh: () => void;
}

export default function PositionsSection({
  book,
  bookLabel,
  isStale,
  betaBySymbol,
  riskShare,
  advBySymbol,
  selectedSymbol,
  operatorToken,
  sectionActive,
  onFocusSymbol,
  onRequestHandoff,
  onRefresh,
}: PositionsSectionProps) {
  const [positionsPane, setPositionsPane] = useState<PositionsPane>("holdings");
  const positions = book.exposure.positions;

  return (
    <>
      <div className="seg" role="group" aria-label="Positions view">
        {POSITIONS_PANES.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={positionsPane === option.id}
            title={option.hint}
            onClick={() => setPositionsPane(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {positionsPane === "holdings" && (
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
                      <td>
                        {fmt(position.share_of_gross * 100, 1)}%
                        {/* Ranks four positions at a glance; the number stays first
                            and stays exact. Share of gross, so the fill is the
                            share itself with no rescaling. */}
                        <span
                          className="cell-meter"
                          aria-hidden
                          style={{ "--fill": `${position.share_of_gross * 100}%` } as CSSProperties}
                        />
                      </td>
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
                            onClick={() => onRequestHandoff({
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
                  : "The gateway is connected and the book is flat."}
              </p>
              <button onClick={() => onFocusSymbol(selectedSymbol, "research")}>Open research workspace</button>
            </div>
          )}
        </div>
      )}

      {/* Two questions the nine-column table cannot answer by summing: where
          the weight sits against each position's own limit, and whether a
          small total P&L is a quiet book or two large offsetting bets. */}
      {positionsPane === "shape" && (
        <>
          <ExposureHeatmap positions={positions} generated={Boolean(book.sandbox)} />
          <UnrealisedSpread positions={positions} generated={Boolean(book.sandbox)} />
        </>
      )}

      {/* The exit, and the capital already committed to making one. A weight
          is only as real as the way out of it, and `useBook` has been
          computing `advBySymbol` from the same bars as the risk figures on
          every poll since those shipped — with nothing reading it until now. */}
      {positionsPane === "exit" && (
        <>
          <LiquidityPanel positions={positions} advMap={advBySymbol} />

          {/* `active` now requires the Exit pane as well as the section. The
              panel is mounted only here, but the section panel above it stays
              mounted when the reader moves to Allocation — so without the pane
              in the condition an order poll would keep hitting the gateway
              behind a tab nobody is looking at, which is what it did while
              every Positions card shared one scroll. */}
          <WorkingOrders
            source={book.sandbox ? "sandbox" : isStale ? "unavailable" : "live"}
            focusSymbol={selectedSymbol}
            isStale={isStale}
            active={sectionActive && positionsPane === "exit"}
            operatorToken={operatorToken}
            onChanged={() => onRefresh()}
            onFocusSymbol={(symbol) => onFocusSymbol(symbol, "research")}
          />
        </>
      )}
    </>
  );
}
