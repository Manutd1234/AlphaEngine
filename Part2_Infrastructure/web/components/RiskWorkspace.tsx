"use client";

/**
 * Risk manager's tab: the limits, the tail, and the two controls that stop
 * trading.
 *
 * The blueprint's line for this role is that risk should be a live guardrail
 * rather than an end-of-day report, so the ordering is deliberate — headroom
 * first (how close are we), then the loss estimate and its own scorecard, then
 * scenarios, and only then the controls. A halt button above the numbers that
 * justify pressing it would be a worse page.
 *
 * The book itself is on the Portfolio tab. What comes along is only what a risk
 * decision needs: equity, exposure and position count.
 */

import { useState } from "react";

import { BookChrome, BookFallback, BookSourceControl, CrossLinkTile } from "@/components/portfolio/BookChrome";
import ExecutionHandoff, { type HandoffIntent } from "@/components/portfolio/ExecutionHandoff";
import HeadroomBar from "@/components/portfolio/HeadroomBar";
import RiskEngine from "@/components/portfolio/RiskEngine";
import StressTest from "@/components/portfolio/StressTest";
import WorkspaceSubtabs, { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
import { fmt, pct, usd } from "@/lib/format";
import { type LimitTone, limitRows, limitTone } from "@/lib/portfolio";
import type { BookView } from "@/lib/use-book";

export interface RiskWorkspaceProps {
  view: BookView;
  onOpenPortfolio: () => void;
  onOpenResearch: () => void;
  /** Operator credential shared with the Reliability tab and the header. */
  operatorToken?: string;
  section: RiskSection;
  onSectionChange: (section: RiskSection) => void;
}

export const RISK_SECTION_IDS = ["limits", "model", "scenarios", "controls"] as const;
export type RiskSection = (typeof RISK_SECTION_IDS)[number];

const RISK_SECTIONS = [
  { id: "limits", label: "Limits", description: "Headroom & concentration" },
  { id: "model", label: "VaR & model", description: "Loss estimates & drivers" },
  { id: "scenarios", label: "Stress tests", description: "Forward shock damage" },
  { id: "controls", label: "Controls", description: "Halt & flatten handoffs" },
] as const;

const TONE_TEXT: Record<LimitTone, string | undefined> = {
  good: undefined,
  warning: "var(--warning-text)",
  critical: "var(--critical-text)",
};

/** Raw values arrive from `limitRows`; the unit decides the formatter. */
function limitValue(value: number, unit: "usd" | "pct"): string {
  return unit === "usd" ? usd(value, 0) : pct(value, 2);
}

export default function RiskWorkspace({
  view,
  onOpenPortfolio,
  onOpenResearch,
  operatorToken,
  section,
  onSectionChange,
}: RiskWorkspaceProps) {
  const [handoff, setHandoff] = useState<HandoffIntent | null>(null);

  const {
    book,
    risk,
    riskPositions,
    covarianceModel,
    varValidation,
    varSeries,
    riskLoading,
    missingHistory,
    referenceSymbol,
    returns,
    refresh,
  } = view;

  const fallback = <BookFallback view={view} onOpenResearch={onOpenResearch} surface="risk" />;
  if (!book) return fallback;

  const binding = book.risk_budget.binding_constraint;
  const positions = book.exposure.positions;

  return (
    <>
      <BookChrome view={view} />

      <WorkspaceSubtabs
        workspaceId="risk"
        label="Risk manager sections"
        tabs={RISK_SECTIONS}
        activeId={section}
        onChange={onSectionChange}
        actions={<BookSourceControl view={view} />}
      />

      <WorkspaceSubtabPanel workspaceId="risk" tabId="limits" activeId={section}>
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

        <div className="portfolio-main-grid">
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
            <div className="table-wrap">
              <table>
                <caption className="sr-only">
                  Each pre-trade constraint with its current usage, its limit, the headroom left, and
                  whether it is the one that binds first.
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
                    <tr key={row.id}>
                      <td>
                        {row.label}
                        {/* icon + word, never colour alone */}
                        {row.binding && <span className="muted"> · ▲ binds first</span>}
                      </td>
                      <td className="num">{limitValue(row.used, row.unit)}</td>
                      <td className="num">{limitValue(row.limit, row.unit)}</td>
                      <td className="num">{limitValue(row.headroom, row.headroomUnit)}</td>
                      <td className="num" style={{ color: TONE_TEXT[limitTone(row.utilisation)] }}>
                        {pct(row.utilisation, 1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="portfolio-concentration">
              <div><span>Largest share</span><strong className="num">{fmt(book.concentration.largest_share * 100, 1)}%</strong></div>
              <div><span>Effective positions</span><strong className="num">{fmt(book.concentration.effective_positions, 1)}</strong></div>
            </div>
            <p className="research-note">
              Effective positions is 1 ÷ the Herfindahl index of the book&apos;s weights — the number
              of equally-sized positions that would carry this much concentration.{" "}
              {positions.length} position{positions.length === 1 ? "" : "s"} behaving like{" "}
              {fmt(book.concentration.effective_positions, 1)} is a statement about how much of the
              book is really one bet.
            </p>
          </div>

          {/* The book, compressed to what a limit decision needs. Full positions
              table is one click away rather than duplicated here. */}
          <CrossLinkTile
            kicker="Owned by the portfolio desk"
            title="Book under these limits"
            actionLabel="Open Portfolio"
            onNavigate={onOpenPortfolio}
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
                note: `${fmt(book.exposure.leverage, 2)}× · net ${usd(book.exposure.net, 0)}`,
              },
              {
                label: "Positions",
                value: String(positions.length),
                note: positions[0] ? `largest ${positions[0].symbol}` : "flat book",
              },
            ]}
          />
        </div>
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="risk" tabId="model" activeId={section}>
        <RiskEngine
          risk={risk}
          model={covarianceModel}
          loading={riskLoading && !risk}
          missing={missingHistory}
          validation={varValidation}
          varSeries={varSeries}
          sandbox={Boolean(book.sandbox)}
        />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="risk" tabId="scenarios" activeId={section}>
        {riskPositions.length > 0 ? (
          <StressTest
            positions={riskPositions}
            equity={book.equity.current}
            returns={returns}
            referenceSymbol={referenceSymbol}
            drawdownLimitPct={book.risk_budget.daily_drawdown.limit_pct}
            startOfDayEquity={book.equity.start_of_day}
          />
        ) : (
          <div className="card">
            <div className="portfolio-card-heading">
              <div>
                <span className="page-kicker">Scenario analysis</span>
                <h2>Stress test</h2>
              </div>
            </div>
            <p className="sub">
              A flat book cannot be stressed — there is no exposure for a shock to move. Load the
              sandbox to see the engine against a populated book.
            </p>
          </div>
        )}
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="risk" tabId="controls" activeId={section}>
        <div className="card portfolio-controls-card">
          <div className="portfolio-card-heading">
            <div>
              <span className="page-kicker">Risk controls</span>
              <h2>Emergency actions</h2>
            </div>
            <span>handoff only</span>
          </div>
          <p className="sub">
            This workspace holds no gateway credential and cannot move risk. These produce the exact
            authenticated request to run against your gateway, where it is gated and audited.
          </p>
          <div className="page-actions">
            <button onClick={() => setHandoff({ kind: "flatten_all" })} disabled={!positions.length}>
              Flatten the book
            </button>
            <button onClick={() => setHandoff({ kind: "halt" })}>Halt trading</button>
          </div>
          <ExecutionHandoff
            intent={handoff}
            onClose={() => setHandoff(null)}
            sandbox={Boolean(book.sandbox)}
            onExecuted={() => void refresh(true)}
            operatorToken={operatorToken}
          />
        </div>
      </WorkspaceSubtabPanel>
    </>
  );
}
