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

import { BookChrome, BookFallback, CrossLinkTile } from "@/components/portfolio/BookChrome";
import ExecutionHandoff, { type HandoffIntent } from "@/components/portfolio/ExecutionHandoff";
import HeadroomBar from "@/components/portfolio/HeadroomBar";
import RiskEngine from "@/components/portfolio/RiskEngine";
import StressTest from "@/components/portfolio/StressTest";
import WorkspaceSubtabs, { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
import { fmt, usd } from "@/lib/format";
import type { BookView } from "@/lib/use-book";

export interface RiskWorkspaceProps {
  view: BookView;
  onOpenPortfolio: () => void;
  onOpenResearch: () => void;
}

type RiskSection = "limits" | "model" | "scenarios" | "controls";

const RISK_SECTIONS = [
  { id: "limits", label: "Limits", description: "Headroom & concentration" },
  { id: "model", label: "VaR & model", description: "Loss estimates & drivers" },
  { id: "scenarios", label: "Stress tests", description: "Forward shock damage" },
  { id: "controls", label: "Controls", description: "Halt & flatten handoffs" },
] as const;

function BudgetRow({ label, used, detail }: { label: string; used: number; detail: string }) {
  const bounded = Math.max(0, Math.min(1, used || 0));
  const tone = bounded >= 0.9 ? "critical" : bounded >= 0.7 ? "warning" : "good";
  return (
    <div className="portfolio-budget-row">
      <div>
        <strong>{label}</strong>
        <span className="num">{fmt(bounded * 100, 1)}%</span>
      </div>
      <div className="portfolio-budget-track" aria-label={`${label}: ${fmt(bounded * 100, 1)} percent used`}>
        <i className={`is-${tone}`} style={{ width: `${bounded * 100}%` }} />
      </div>
      <small>{detail}</small>
    </div>
  );
}

export default function RiskWorkspace({ view, onOpenPortfolio, onOpenResearch }: RiskWorkspaceProps) {
  const [handoff, setHandoff] = useState<HandoffIntent | null>(null);
  const [section, setSection] = useState<RiskSection>("limits");

  const {
    book,
    risk,
    riskPositions,
    covarianceModel,
    varValidation,
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
        onChange={setSection}
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
            <BudgetRow
              label="Gross exposure"
              used={book.risk_budget.gross_exposure.utilisation}
              detail={`${usd(book.risk_budget.gross_exposure.remaining, 0)} headroom of ${usd(book.risk_budget.gross_exposure.limit, 0)}`}
            />
            <BudgetRow
              label="Daily drawdown"
              used={book.risk_budget.daily_drawdown.utilisation}
              detail={`${usd(book.risk_budget.daily_drawdown.cushion_usd, 0)} equity cushion to halt`}
            />
            <BudgetRow
              label="Largest position"
              used={positions[0]?.symbol_limit.utilisation ?? 0}
              detail={positions[0] ? `${positions[0].symbol} · ${usd(positions[0].symbol_limit.remaining, 0)} symbol headroom` : "No symbol exposure"}
            />
            <div className="portfolio-concentration">
              <div><span>Largest share</span><strong className="num">{fmt(book.concentration.largest_share * 100, 1)}%</strong></div>
              <div><span>Effective positions</span><strong className="num">{fmt(book.concentration.effective_positions, 1)}</strong></div>
            </div>
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
          equity={book.equity.current}
          loading={riskLoading && !risk}
          missing={missingHistory}
          validation={varValidation}
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
          />
        </div>
      </WorkspaceSubtabPanel>
    </>
  );
}
