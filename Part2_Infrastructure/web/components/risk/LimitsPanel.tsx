"use client";

/**
 * The Risk tab's limits subtab: headroom, the constraint table, and the tile
 * through to the book those limits are drawn against.
 *
 * Extracted from `RiskWorkspace.tsx`, which had reached the 400-line ceiling
 * with the panel body inline and could not take another subtab. The rejected
 * alternative was extracting the Emergency actions card instead: it is the
 * smaller block (about 35 lines against this one's 140, so the workspace would
 * be back at the wall on the next change), and it carries the sentence saying
 * this workspace holds no gateway credential — a line `disclosure-risk` and
 * `summarised-risk` both pin against `RiskWorkspace.tsx` by name, so moving it
 * would have turned a headroom fix into a safety-copy migration.
 *
 * Nothing here changed in the move. The wrapper `<WorkspaceSubtabPanel
 * tabId="limits">` stays in the workspace, so the rail still owns which panel
 * is on screen and this file only renders what is inside it.
 *
 * This component calls no hooks and takes no early return.
 */

import type { CSSProperties } from "react";

import { CrossLinkTile } from "@/components/portfolio/BookChrome";
import HeadroomBar from "@/components/portfolio/HeadroomBar";
import BookConcentration from "@/components/risk/BookConcentration";
import { fmt, pct, usd } from "@/lib/format";
import { type LimitTone, limitRows, limitTone, type PortfolioPayload } from "@/lib/portfolio";
import type { PortfolioSection } from "@/lib/sections";

export interface LimitsPanelProps {
  book: PortfolioPayload;
  /**
   * The section is optional so a caller that can only switch tabs stays valid.
   * The cross-link tile names the panel that holds the full positions table; a
   * handler that ignores the argument lands wherever the reader last was, which
   * is the behaviour this argument exists to end.
   */
  onOpenPortfolio: (section?: PortfolioSection) => void;
}

const TONE_TEXT: Record<LimitTone, string | undefined> = {
  good: undefined,
  warning: "var(--warning-text)",
  critical: "var(--critical-text)",
};

/** Raw values arrive from `limitRows`; the unit decides the formatter. */
function limitValue(value: number, unit: "usd" | "pct"): string {
  return unit === "usd" ? usd(value, 0) : pct(value, 2);
}

export default function LimitsPanel({ book, onOpenPortfolio }: LimitsPanelProps) {
  // Derived here rather than passed down: one book means the tile's position
  // count and the table's rows cannot drift apart. The workspace keeps its own
  // read of the same field for the Flatten button's flat-book guard.
  const binding = book.risk_budget.binding_constraint;
  const positions = book.exposure.positions;

  return (
    <>
      <HeadroomBar
        grossUsed={book.risk_budget.gross_exposure.used}
        grossLimit={book.risk_budget.gross_exposure.limit}
        net={book.exposure.net}
        equity={book.equity.current}
        drawdownUsedPct={book.risk_budget.daily_drawdown.used_pct}
        drawdownLimitPct={book.risk_budget.daily_drawdown.limit_pct}
        cushionUsd={book.risk_budget.daily_drawdown.cushion_usd}
        bindingConstraint={binding[0]}
        bindingUtilisation={binding[1]}
        largestPosition={
          positions[0]
            ? {
                symbol: positions[0].symbol,
                utilisation: positions[0].symbol_limit.utilisation,
                remaining: positions[0].symbol_limit.remaining,
              }
            : null
        }
      />

      <div className="risk-main-grid">
        <div className="card portfolio-risk-card">
          <div className="portfolio-card-heading">
            <div>
              <span className="page-kicker">Pre-trade guardrails</span>
              <h2>Risk budget</h2>
            </div>
            <span>{book.sandbox ? "sandbox thresholds — same limits, generated book" : "enforced at the gate"}</span>
          </div>
          {/* The gauges above already carry each constraint as a bar and a
              sentence. What they compress away is the arithmetic, so this is
              the table rather than a second set of the same bars — which is
              what it used to be. */}
          <div className="table-wrap" tabIndex={0}>
            <table>
              <caption className="sr-only">
                Each pre-trade constraint, and whether it binds first.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Constraint</th>
                  <th scope="col">Used</th>
                  <th scope="col">Limit</th>
                  <th scope="col">Headroom</th>
                  <th scope="col">Utilisation</th>
                </tr>
              </thead>
              <tbody>
                {limitRows(book).map((row) => (
                  <tr key={row.id} id={`risk-constraint-${row.id.replace(/[^A-Za-z0-9_-]/g, "-")}`} tabIndex={-1}>
                    <td>
                      {row.label}
                      {/* icon + word, never colour alone */}
                      {row.binding && <span className="muted">; ▲ binds first</span>}
                    </td>
                    <td className="num">{limitValue(row.used, row.unit)}</td>
                    <td className="num">{limitValue(row.limit, row.unit)}</td>
                    <td className="num">{limitValue(row.headroom, row.headroomUnit)}</td>
                    <td className="num" style={{ color: TONE_TEXT[limitTone(row.utilisation)] }}>
                      {pct(row.utilisation, 1)}
                      {/* The same figure, ranked. Inherits the tone colour above,
                          so a constraint at cap reads red in both encodings. */}
                      <span
                        className="cell-meter"
                        aria-hidden
                        style={{ "--fill": `${Math.max(0, row.utilisation * 100)}%` } as CSSProperties}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Counting, not cutting: BookConcentration records why the Risk tab was the one book-fed tab wiring no live motion. */}
          <BookConcentration largestShare={book.concentration.largest_share} effectivePositions={book.concentration.effective_positions} />
          {/* The derivation, not the number. Both figures above stay visible;
              what collapses is the explanation of how one of them is computed,
              which a reader needs once and not on every visit. The summary
              states what is inside so the choice to open it is informed. */}
          <details className="disclosure">
            <summary>How effective positions is derived</summary>
            <p className="research-note">
              1 ÷ the Herfindahl index of the book&apos;s weights: how many equally-sized
              positions would carry this concentration. {positions.length} position
              {positions.length === 1 ? "" : "s"} behaving like{" "}
              {fmt(book.concentration.effective_positions, 1)} says how much is one bet.
            </p>
          </details>
        </div>

        {/* The book, compressed to what a limit decision needs. Full positions
            table is one click away rather than duplicated here — and the click
            now names `positions`, which is where that table actually is.
            `onNavigate` was a bare thunk, so "one click away" meant one click
            to the Portfolio tab and then however many more it took to find the
            section the reader had left it on. The label says where it lands. */}
        <CrossLinkTile<PortfolioSection>
          kicker="Owned by the portfolio desk"
          title="Book under these limits"
          actionLabel="Open Portfolio positions"
          onNavigate={onOpenPortfolio}
          targetSection="positions"
          metrics={[
            {
              label: "Equity",
              value: usd(book.equity.current, 0),
              note: `day ${usd(book.equity.daily_pnl, 0)}`,
              tone: book.equity.daily_pnl >= 0 ? "pos" : "neg",
            },
            {
              label: "Gross exposure",
              value: usd(book.exposure.gross, 0),
              note: `${fmt(book.exposure.leverage, 2)}×, net ${usd(book.exposure.net, 0)}`,
            },
            {
              label: "Positions",
              value: String(positions.length),
              note: positions[0] ? `largest ${positions[0].symbol}` : "flat book",
            },
          ]}
        />
      </div>
    </>
  );
}
