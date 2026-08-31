"use client";

/**
 * Risk manager's tab: the limits, the tail, and the two controls that stop
 * trading.
 *
 * The blueprint's line for this role is that risk should be a live guardrail
 * rather than an end-of-day report, so the ordering is deliberate — headroom
 * first (how close are we), then the loss estimate, then the diagram that
 * scores it, then scenarios, and only then the controls. A halt button above
 * the numbers that justify pressing it would be a worse page.
 *
 * The book itself is on the Portfolio tab. What comes along is only what a risk
 * decision needs: equity, exposure and position count.
 */

import { useState } from "react";

import { BookChrome, BookFallback, BookSourceControl } from "@/components/portfolio/BookChrome";
import ExecutionHandoff, { type HandoffIntent } from "@/components/portfolio/ExecutionHandoff";
import OracleVarPanel from "@/components/portfolio/OracleVarPanel";
import RiskEngine from "@/components/portfolio/RiskEngine";
import StressTest from "@/components/portfolio/StressTest";
import HorizonSeg from "@/components/risk/HorizonSeg";
import LimitsPanel from "@/components/risk/LimitsPanel";
import MonteCarloDistribution, { type McDriver } from "@/components/risk/MonteCarloDistribution";
import WorkspaceSubtabs, { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
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

/** Why "Flatten the book" is unavailable, in the button and on screen. */
const FLAT_BOOK_REASON = "Nothing to flatten: this book holds no open position.";

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

  const positions = book.exposure.positions;
  const flatBook = positions.length === 0;

  /**
   * Same props, same snapshot, one third each. The model, diagram and drivers
   * subtabs cannot disagree about the book because they are one component
   * reading one set of props — written once here so that stays true by
   * construction rather than by three panels being kept in step by hand. It
   * matters most for the diagram: the forecast it draws and the Kupiec score
   * on the model subtab are graded off the same `varSeries` and `varValidation`
   * pair, and a second call site is all it would take for them to drift.
   */
  const riskEngine = (part: "model" | "diagram" | "drivers") => (
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
    <HorizonSeg ariaLabel={ariaLabel} days={mcHorizonDays} onDays={(days) => setMcHorizonDays(days)} />
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
        <LimitsPanel book={book} onOpenPortfolio={onOpenPortfolio} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="risk" tabId="model" activeId={section}>
        {riskEngine("model")}
      </WorkspaceSubtabPanel>

      {/* The forecast and the scorecard that grades it, one subtab apart. They
          were one card: a VaR figure with its Kupiec zone, and under it the
          chart of the same band against realised losses. Splitting them gives
          the chart the full desk width its 361 lines were drawn for, and the
          engine card a heading that is not a preamble to something else. The
          section id behind "Risk engine" is still `model`, so #risk/model keeps
          resolving to the half it always named. */}
      <WorkspaceSubtabPanel workspaceId="risk" tabId="diagram" activeId={section}>
        {riskEngine("diagram")}
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
        {/* `live` is the gate on the panel's re-run cadence and it needs BOTH
            terms: `active` is this workspace being the visible tab, the section
            test is this subtab being the visible one within it. Subtab panels
            mount on first open and stay mounted behind `display: none` for the
            life of the workspace, so "mounted" says nothing about whether
            anyone is looking — and every re-run is a real database call.
            `positionCount` is not a figure the card renders; it is how the card
            tells a flat book apart from a model still being measured, which
            arrive at its boundary as the same null. */}
        <OracleVarPanel
          equity={book.equity.current}
          annualVol={risk?.annualisedVolatility ?? null}
          sandbox={Boolean(book.sandbox)}
          horizonDays={mcHorizonDays}
          positionCount={positions.length}
          live={active && section === "oraclevar"}
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
            <button
              type="button"
              disabled={flatBook}
              title={flatBook ? FLAT_BOOK_REASON : undefined}
              onClick={() => setHandoff({ kind: "flatten_all" })}
            >
              Flatten the book
            </button>
            <button type="button" onClick={() => setHandoff({ kind: "halt" })}>Halt trading</button>
          </div>
          {/* On screen, not only in the disabled button's title: a tooltip
              needs a pointer and a disabled button takes no focus, so a dimmed
              control explained by a hover alone is a bare dash. Halt stays
              live — a flat book can still be stopped from trading. */}
          {flatBook && (
            <small className="muted">
              <span aria-hidden>◌</span> {FLAT_BOOK_REASON}
            </small>
          )}
          <ExecutionHandoff
            intent={handoff}
            onClose={() => setHandoff(null)}
            sandbox={Boolean(book.sandbox)}
            stale={view.isStale}
            onExecuted={() => void refresh(true)}
            operatorToken={operatorToken}
          />
        </div>
      </WorkspaceSubtabPanel>
    </>
  );
}
