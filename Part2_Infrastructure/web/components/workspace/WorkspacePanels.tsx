"use client";

/**
 * The ten panels, and nothing else.
 *
 * `app/dashboard/page.tsx` is the shell: it runs the hooks, draws the one
 * header every tab shares, and owns the state two or more panels read. This
 * file is the other half — the eight `<section role="tabpanel">` elements it
 * mounts inside `#workspace-content`, each wired to the workspace component
 * that renders it.
 *
 * The split is along the seam the shell already had: six of the eight stay
 * mounted behind `hidden` so a tab switch keeps their scroll and their draft,
 * and two (Research, Execution) unmount. Props arrive as the three objects the
 * shell already holds — the routing hook's return, the sweep hook's return and
 * the desk state — rather than as fifty loose values, so no panel can be handed
 * half a hook.
 */

import ExecutionCockpit from "@/components/execution/ExecutionCockpit";
import LiveMarket from "@/components/LiveMarket";
import { type PortfolioFocusDestination } from "@/components/PortfolioWorkspace";
import ResearchWorkspace from "@/components/ResearchWorkspace";
import NextStepFooter from "@/components/common/NextStepFooter";
import EnginePanels from "./EnginePanels";
import { BookStatus } from "@/components/portfolio/BookChrome";
import WorkspaceIntro from "@/components/WorkspaceIntro";
import WorkspaceSubtabs from "@/components/WorkspaceSubtabs";
import {
  DataTab, DeveloperTab, OverviewTab, PortfolioTab, ReliabilityTab, RiskTab,
} from "@/components/workspace/lazy-panels";
import type { DeveloperWorkItem } from "@/lib/developer-work";
import { EXECUTION_SECTIONS } from "@/lib/sections";
import type { useBook } from "@/lib/use-book";
import type { useDataWorkQueue } from "@/lib/use-data-work-queue";
import type { useSweepRun } from "@/lib/use-sweep-run";
import type { useSystemHealth } from "@/lib/use-system-health";
import type { useWorkspaceRouting } from "@/lib/use-workspace-routing";
import { executionInsights, portfolioInsights, riskInsights } from "@/lib/workspace-insights";
import type { Strategy } from "@/lib/types";
import type { Side } from "@/lib/venues";


/** The state the shell owns because two or more panels read it. */
export interface DeskShell {
  book: ReturnType<typeof useBook>;
  systems: ReturnType<typeof useSystemHealth>;
  dataWork: ReturnType<typeof useDataWorkQueue>;
  side: Side;
  setSide: (next: Side) => void;
  notional: number;
  setNotional: (next: number) => void;
  orderType: "MARKET" | "LIMIT";
  setOrderType: (next: "MARKET" | "LIMIT") => void;
  limitPrice: number | null;
  setLimitPrice: (next: number | null) => void;
  executionStrategy: Strategy;
  setExecutionStrategy: (next: Strategy) => void;
  showMcBands: boolean;
  setShowMcBands: (next: boolean) => void;
  mcRunNonce: number;
  developerWorkItems: DeveloperWorkItem[];
  setDeveloperWorkItems: (next: DeveloperWorkItem[]) => void;
  /** "N accepted of M orders" for the staged sleeve, or why there is none. */
  selectedSleeveDetail: string;
  selectedSleeveAttribution: { filled: number } | null;
  revalidateDesk: () => Promise<void>;
  focusPortfolioSymbol: (symbol: string, destination: PortfolioFocusDestination) => void;
  stageLimitFromLadder: (staged: { side: Side; price: number }) => void;
  resumeAutoRun: () => void;
  changeAutoRun: (next: boolean) => void;
}

interface WorkspacePanelsProps {
  routing: ReturnType<typeof useWorkspaceRouting>;
  sweep: ReturnType<typeof useSweepRun>;
  desk: DeskShell;
}

export default function WorkspacePanels({ routing, sweep, desk }: WorkspacePanelsProps) {
  const {
    view, visitedViews, navigate, openSection,
    overviewSection, researchSection, executionSection, dataSection,
    reliabilitySection, developerSection, marketsSection, coherenceSection, diffusionSection, riskSection, portfolioSection,
    changeOverviewSection, changeResearchSection, changeExecutionSection,
    changeDeveloperSection, changeRiskSection, changePortfolioSection,
    changeDataSection, changeReliabilitySection, changeMarketsSection, changeCoherenceSection, changeDiffusionSection,
    openRiskSection, openPortfolioSection, openResearchSummary, openLiveLiquidity,
    openReliabilityOverview, openDataOverview, openLoopStage,
    marketsViews, setMarketsView,
  } = routing;
  const {
    req, data, inspect, displayedResult, activeResult, running, researchDirty,
    researchStale, sweepIncoming, error, errorFix, experiments, setExperiments,
    autoRun, autoSuspended, resultAnnouncement, run, runNow, commitRequest,
    updateRequest, updateStrategy, updateSymbol, cloneExperiment, dropExperiment,
    inspectCombo, pinRun, currentPinned, triedStrategies, mcDriver,
  } = sweep;
  const {
    book, systems, dataWork, side, setSide, notional, setNotional,
    orderType, setOrderType, limitPrice, setLimitPrice,
    executionStrategy, setExecutionStrategy, showMcBands, setShowMcBands,
    mcRunNonce, developerWorkItems, setDeveloperWorkItems,
    selectedSleeveDetail, selectedSleeveAttribution, revalidateDesk,
    focusPortfolioSymbol, stageLimitFromLadder, resumeAutoRun, changeAutoRun,
  } = desk;

  return (
    <>
      {(view === "overview" || visitedViews.current.has("overview")) && (
        <section id="panel-overview" role="tabpanel" aria-labelledby="tab-overview" className="view-panel" hidden={view !== "overview"}>
          <OverviewTab
            active={view === "overview"}
            request={req}
            result={activeResult}
            running={running}
            researchStale={researchStale}
            staleResult={researchDirty ? data : null}
            side={side}
            notional={notional}
            book={book}
            systems={systems}
            onNavigate={navigate}
            onOpenStage={openLoopStage}
            onRun={runNow}
            section={overviewSection}
            onSectionChange={changeOverviewSection}
          />
          <NextStepFooter currentView="overview" currentSection={overviewSection} onNavigate={openSection} />
        </section>
      )}

      {(view === "portfolio" || visitedViews.current.has("portfolio")) && (
        <section id="panel-portfolio" role="tabpanel" aria-labelledby="tab-portfolio" className="view-panel" hidden={view !== "portfolio"}>
          <WorkspaceIntro
            kicker="Portfolio manager"
            title="Portfolio"
            /* Not the section rail in prose: "what the book holds" is
               Positions, "how capital is spread" is Allocation, "which sleeve
               earned the P&L" is Performance — three of the five tabs below.
               This is the question those five sections answer together. */
            description={<>Whether the book is where it was meant to be, and where the P&amp;L came from.</>}
            insights={portfolioInsights({
              book, executionStrategy, selectedSleeveDetail, selectedSleeveAttribution,
            })}
            /* Which book these four chips describe, in the heading's control
               slot rather than a full-width row below them. Both book tabs
               pass the same node, because Portfolio and Risk are one snapshot
               asked a different question and a reader who saw "Live" on one
               and nothing on the other would have to guess which was current. */
            actions={<BookStatus view={book} />}
          />
          <PortfolioTab
            active={view === "portfolio"}
            view={book}
            workspaceSymbol={req.symbol}
            onFocusSymbol={focusPortfolioSymbol}
            /* The cross-link tile names the panel that explains its own four
               figures, so the shell routes to whatever it asked for; the
               fallback is Limits, where gross headroom, the drawdown cushion
               and the binding constraint are all computed. */
            onOpenRisk={openRiskSection}
            operatorToken={systems.token}
            section={portfolioSection}
            onSectionChange={changePortfolioSection}
          />
          <NextStepFooter currentView="portfolio" currentSection={portfolioSection} onNavigate={openSection} />
        </section>
      )}

      {(view === "risk" || visitedViews.current.has("risk")) && (
        <section id="panel-risk" role="tabpanel" aria-labelledby="tab-risk" className="view-panel" hidden={view !== "risk"}>
          <WorkspaceIntro
            kicker="Risk manager"
            title="Risk"
            /* The worst of the three: this was every section tab named in
               rail order, restated a line above the rail itself. */
            description={<>How much this book can lose before a limit stops it, and what does the stopping.</>}
            insights={riskInsights({
              book, executionStrategy, selectedSleeveDetail, selectedSleeveAttribution,
            })}
            actions={<BookStatus view={book} />}
          />
          <RiskTab
            view={book}
            /* Same shape: the tile quoting equity, gross exposure and the
               position count names its own destination, and Overview is the
               fallback for a link that names none. Research is the book
               fallback's escape hatch when the book cannot be read at all, so
               it opens on the verdict. */
            onOpenPortfolio={openPortfolioSection}
            onOpenResearch={openResearchSummary}
            operatorToken={systems.token}
            mcDriver={mcDriver}
            mcRunNonce={mcRunNonce}
            section={riskSection}
            onSectionChange={changeRiskSection}
            active={view === "risk"}
          />
          <NextStepFooter currentView="risk" currentSection={riskSection} onNavigate={openSection} />
        </section>
      )}

      {view === "research" && (
        <section id="panel-research" role="tabpanel" aria-labelledby="tab-research" className="view-panel">
          <ResearchWorkspace
            req={req}
            data={data}
            displayedResult={displayedResult}
            activeResult={activeResult}
            inspect={inspect}
            running={running}
            researchDirty={researchDirty}
            researchStale={researchStale}
            sweepIncoming={sweepIncoming}
            error={error}
            errorFix={errorFix}
            autoRun={autoRun}
            autoSuspended={autoSuspended}
            experiments={experiments}
            setExperiments={setExperiments}
            currentPinned={currentPinned}
            triedStrategies={triedStrategies}
            resultAnnouncement={resultAnnouncement}
            showMcBands={showMcBands}
            onShowMcBandsChange={setShowMcBands}
            systemsHealth={systems.health}
            systemsHealthError={systems.healthError}
            run={run}
            updateRequest={updateRequest}
            updateStrategy={updateStrategy}
            commitRequest={commitRequest}
            pinRun={pinRun}
            inspectCombo={inspectCombo}
            cloneExperiment={cloneExperiment}
            dropExperiment={dropExperiment}
            onAutoRunChange={changeAutoRun}
            onResumeAuto={resumeAutoRun}
            /* Promotion stages the sleeve Execution will carry; the shell owns
               that state because the ticket and both book tabs quote it. */
            onStageSleeve={setExecutionStrategy}
            onOpenSection={openSection}
            section={researchSection}
            onSectionChange={changeResearchSection}
          />
          <NextStepFooter currentView="research" currentSection={researchSection} onNavigate={openSection} />
        </section>
      )}

      {view === "live" && (
        <section id="panel-live" role="tabpanel" aria-labelledby="tab-live" className="view-panel">
          <WorkspaceIntro
            kicker="Quant trader"
            title="Execution"
            /* Not a list of the section tabs directly below — those read
               Trade, Liquidity, Routing & TCA, Fill quality, Blotter, which
               is the same sentence in less space. This says what the tab is
               for: the modelled cost of an order, and what it really cost. */
            description={<>What it would cost to trade {req.symbol} now, and what it actually cost.</>}
            insights={executionInsights({ symbol: req.symbol, side, notional })}
          />
          <WorkspaceSubtabs
            workspaceId="execution"
            label="Quant trader sections"
            tabs={EXECUTION_SECTIONS}
            activeId={executionSection}
            onChange={changeExecutionSection}
          />
          <LiveMarket
            symbol={req.symbol}
            onSymbolChange={updateSymbol}
            side={side}
            onSideChange={setSide}
            notional={notional}
            onNotionalChange={setNotional}
            research={activeResult}
            /* Both of these hang off the attached research context — "Review
               evidence" beside the model's cost budget, "Verify feed" beside
               the quote it was priced against — so they open the verdict and
               the feed contracts rather than the last section read there. */
            onOpenResearch={openResearchSummary}
            onOpenData={() => openSection("data", "feeds")}
            section={executionSection}
            onPriceSelect={stageLimitFromLadder}
          >
            <ExecutionCockpit
              /* One seed for the whole desk: the cockpit generates its own
                 sandbox book and blotter, and an unseeded call here would put a
                 second, different generated desk beside Portfolio's. */
              seed={book.seed}
              symbol={req.symbol}
              side={side}
              notional={notional}
              orderType={orderType}
              limitPrice={limitPrice}
              section={executionSection}
              onSideChange={setSide}
              onNotionalChange={setNotional}
              onOrderTypeChange={setOrderType}
              onLimitPriceChange={setLimitPrice}
              operatorToken={systems.token}
              operatorGuard={systems.guard}
              operatorTokenEnv={systems.tokenEnv}
              paperOrderDefaultAvailable={systems.paperOrderDefaultAvailable}
              onOperatorTokenChange={systems.setToken}
              strategy={executionStrategy}
              onStrategyChange={setExecutionStrategy}
              researchExperimentId={null}
              onOrderSettled={revalidateDesk}
              /* The ticket and the blotter both ask the same thing of
                 Research — what evidence stands behind this sleeve — which
                 is the Summary verdict. */
              onOpenResearch={openResearchSummary}
            />
          </LiveMarket>
          <NextStepFooter currentView="live" currentSection={executionSection} onNavigate={openSection} />
        </section>
      )}

      {(view === "data" || visitedViews.current.has("data")) && (
        <section id="panel-data" role="tabpanel" aria-labelledby="tab-data" className="view-panel" hidden={view !== "data"}>
          <DataTab
            active={view === "data"}
            view={systems}
            workspaceSymbol={req.symbol}
            workspaceInterval={req.interval}
            onWorkspaceSymbolChange={updateSymbol}
            onOpenReliability={openReliabilityOverview}
            section={dataSection}
            onSectionChange={changeDataSection}
            workItems={dataWork.items}
            onWorkItemsChange={dataWork.setItems}
            workSource={dataWork.source}
            onWorkMutation={dataWork.mutate}
            pendingWorkWrites={dataWork.pendingWrites}
            workNotice={dataWork.notice}
          />
          <NextStepFooter currentView="data" currentSection={dataSection} onNavigate={openSection} />
        </section>
      )}

      {(view === "reliability" || visitedViews.current.has("reliability")) && (
        <section id="panel-reliability" role="tabpanel" aria-labelledby="tab-reliability" className="view-panel" hidden={view !== "reliability"}>
          <ReliabilityTab
            active={view === "reliability"}
            view={systems}
            workspaceSymbol={req.symbol}
            onOpenData={openDataOverview}
            section={reliabilitySection}
            onSectionChange={changeReliabilitySection}
          />
          <NextStepFooter currentView="reliability" currentSection={reliabilitySection} onNavigate={openSection} />
        </section>
      )}

      {(view === "developer" || visitedViews.current.has("developer")) && (
        <section id="panel-developer" role="tabpanel" aria-labelledby="tab-developer" className="view-panel" hidden={view !== "developer"}>
          <DeveloperTab
            view={systems}
            workspaceSymbol={req.symbol}
            /* The three shared-context links, each landing where its own
               noun is explained: "Research {symbol}" on the verdict for it,
               "Open live book" on the consolidated depth, "Open Reliability"
               on attention and the SLIs. */
            onOpenResearch={openResearchSummary}
            onOpenLive={openLiveLiquidity}
            onOpenReliability={openReliabilityOverview}
            section={developerSection}
            onSectionChange={changeDeveloperSection}
            workItems={developerWorkItems}
            onWorkItemsChange={setDeveloperWorkItems}
            active={view === "developer"}
          />
          <NextStepFooter currentView="developer" currentSection={developerSection} onNavigate={openSection} />
        </section>
      )}

      {/* The three engine tabs are `EnginePanels`. This file was at 399 of the
          four-hundred-line ceiling when Diffusion became the eleventh tab, and
          the seam is the one the desk already has: eight tabs are the decision
          loop, and three are the Kalshi engine. */}
      <EnginePanels
        view={view}
        visited={visitedViews.current}
        marketsSection={marketsSection}
        marketsViews={marketsViews}
        setMarketsView={setMarketsView}
        coherenceSection={coherenceSection}
        diffusionSection={diffusionSection}
        changeMarketsSection={changeMarketsSection}
        changeCoherenceSection={changeCoherenceSection}
        changeDiffusionSection={changeDiffusionSection}
        openSection={openSection}
      />
    </>
  );
}
