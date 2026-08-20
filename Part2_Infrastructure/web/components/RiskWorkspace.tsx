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

import { useState, type CSSProperties } from "react";

import { BookChrome, BookFallback, BookSourceControl, CrossLinkTile } from "@/components/portfolio/BookChrome";
import ExecutionHandoff, { type HandoffIntent } from "@/components/portfolio/ExecutionHandoff";
import HeadroomBar from "@/components/portfolio/HeadroomBar";
import OracleVarPanel from "@/components/portfolio/OracleVarPanel";
import RiskEngine from "@/components/portfolio/RiskEngine";
import StressTest from "@/components/portfolio/StressTest";
import MonteCarloDistribution, { type McDriver } from "@/components/risk/MonteCarloDistribution";
import WorkspaceSubtabs, { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
import { fmt, pct, usd } from "@/lib/format";
import { type LimitTone, limitRows, limitTone } from "@/lib/portfolio";
import { RISK_SECTIONS, type PortfolioSection, type RiskSection } from "@/lib/sections";
import type { BookView } from "@/lib/use-book";

export interface RiskWorkspaceProps {
  view: BookView;
  /**
   * The section is optional so a caller that can only switch tabs stays valid.
   * The cross-link tile names the panel that holds the full positions table; a
   * handler that ignores the argument lands wherever the reader last was, which
   * is the behaviour this argument exists to end.
   */
  onOpenPortfolio: (section?: PortfolioSection) => void;
  onOpenResearch: () => void;
  /** Operator credential shared with the Reliability tab and the header. */
  operatorToken?: string;
  /** The research winner's drivers for the terminal distribution; null before a run. */
  mcDriver: McDriver | null;
  /** Bumped by the palette action to re-run the distribution. */
  mcRunNonce: number;
  section: RiskSection;
  onSectionChange: (section: RiskSection) => void;
  /** Whether this workspace is the visible tab; gates the rail's `--rail-h` publisher. */
  active?: boolean;
}

export { RISK_SECTION_IDS, type RiskSection } from "@/lib/sections";

const TONE_TEXT: Record<LimitTone, string | undefined> = {
  good: undefined,
  warning: "var(--warning-text)",
  critical: "var(--critical-text)",
};

/** Raw values arrive from `limitRows`; the unit decides the formatter. */
function limitValue(value: number, unit: "usd" | "pct"): string {
  return unit === "usd" ? usd(value, 0) : pct(value, 2);
}

/** The montecarlo and oraclevar sections' shared forward horizon, in days.
 *  1 day is here for the GBM panel's original range; the bootstrap converts
 *  it to ≥1 bar. */
const MC_HORIZON_CHOICES = [1, 10, 30, 90] as const;

export default function RiskWorkspace({
  view,
  onOpenPortfolio,
  onOpenResearch,
  operatorToken,
  mcDriver,
  mcRunNonce,
  section,
  onSectionChange,
  active = true,
}: RiskWorkspaceProps) {
  const [handoff, setHandoff] = useState<HandoffIntent | null>(null);
  /**
   * One horizon for both Monte Carlos. Each card used to carry its own
   * "Horizon" select, so their stated purpose — read the two loss estimates
   * against each other — only held after the reader had manually set two
   * controls to the same value. A comparison with two clocks is not a
   * comparison. The cards now live on separate subtabs (montecarlo and
   * oraclevar), which is exactly why the state stays HERE rather than
   * moving into either: the seg on one subtab sets the horizon the other
   * answers over too.
   */
  const [mcHorizonDays, setMcHorizonDays] = useState<number>(30);

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

  /**
   * Same props, same snapshot, one half each. The model and drivers subtabs
   * cannot disagree about the book because they are one component reading one
   * set of props — written once here so that stays true by construction rather
   * than by two panels being kept in step by hand.
   */
  const riskEngine = (part: "model" | "drivers") => (
    <RiskEngine
      risk={risk}
      model={covarianceModel}
      loading={riskLoading && !risk}
      missing={missingHistory}
      validation={varValidation}
      varSeries={varSeries}
      sandbox={Boolean(book.sandbox)}
      part={part}
    />
  );

  /**
   * One horizon, two controls. The montecarlo and oraclevar subtabs each
   * render this seg above their card; both read and set the same state, so
   * whichever one the reader touches, the two loss estimates stay on one
   * clock. Distinct aria-labels per call site, because two controls
   * announcing identically would read to a screen reader as one control
   * rendered twice.
   */
  const horizonSeg = (ariaLabel: string) => (
    <div className="seg research-seg" role="group" aria-label={ariaLabel}>
      {MC_HORIZON_CHOICES.map((days) => (
        <button
          key={days}
          type="button"
          aria-pressed={mcHorizonDays === days}
          title={`Run both estimates over a ${days}-day forward horizon`}
          onClick={() => setMcHorizonDays(days)}
        >
          {days}d
        </button>
      ))}
    </div>
  );

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
        active={active}
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
                  Each pre-trade constraint: usage, limit, headroom left, and whether it binds
                  first.
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

            <div className="portfolio-concentration">
              <div><span>Largest share</span><strong className="num">{fmt(book.concentration.largest_share * 100, 1)}%</strong></div>
              <div><span>Effective positions</span><strong className="num">{fmt(book.concentration.effective_positions, 1)}</strong></div>
            </div>
            {/* The derivation, not the number. Both figures above stay visible;
                what collapses is the explanation of how one of them is computed,
                which a reader needs once and not on every visit. The summary
                states what is inside so the choice to open it is informed. */}
            <details className="disclosure">
              <summary>How effective positions is derived</summary>
              <p className="research-note">
                1 ÷ the Herfindahl index of the book&apos;s weights: how many equally-sized
                positions would carry this much concentration. {positions.length} position
                {positions.length === 1 ? "" : "s"} behaving like{" "}
                {fmt(book.concentration.effective_positions, 1)} says how much is really one bet.
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
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="risk" tabId="model" activeId={section}>
        {riskEngine("model")}
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="risk" tabId="drivers" activeId={section}>
        {riskEngine("drivers")}
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="risk" tabId="montecarlo" activeId={section}>
        {horizonSeg("Forward horizon for the bootstrap loss estimate")}
        <MonteCarloDistribution
          driver={mcDriver}
          equity={book.equity.current}
          cushionUsd={book.risk_budget.daily_drawdown.cushion_usd}
          sandbox={Boolean(book.sandbox)}
          runNonce={mcRunNonce}
          horizonDays={mcHorizonDays}
          onOpenResearch={onOpenResearch}
        />
      </WorkspaceSubtabPanel>

      {/* The two Monte Carlos are one subtab apart on purpose: a bootstrap of
          the strategy's realised returns behind the montecarlo tab above, a
          GBM simulated in the database here. They answer the same question
          two ways, and disagreement between them is signal about the method,
          not an error — which is why the two subtabs share one horizon state:
          the seg on either sets both, so the estimates can never be read
          against each other on two different clocks. */}
      <WorkspaceSubtabPanel workspaceId="risk" tabId="oraclevar" activeId={section}>
        {horizonSeg("Forward horizon for the Oracle GBM loss estimate")}
        <OracleVarPanel
          equity={book.equity.current}
          annualVol={risk?.annualisedVolatility ?? null}
          sandbox={Boolean(book.sandbox)}
          horizonDays={mcHorizonDays}
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
              A flat book has no exposure for a shock to move. Load the sandbox to see the engine.
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
            This workspace holds no gateway credential and cannot move risk. These compose the
            authenticated request your gateway would gate and audit.
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
