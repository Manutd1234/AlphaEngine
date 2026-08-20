"use client";

/**
 * The desk shell: eight tabs, one shared snapshot, and the wiring between them.
 *
 * What is deliberately NOT here any more. This file was 2,033 lines with a
 * single 2,000-line function inside it, and the three biggest things in that
 * function were not shell concerns at all:
 *
 *   - the Research tab's 490 lines of JSX — the last workspace still rendered
 *     inline while the other seven delegated — now `components/ResearchWorkspace`;
 *   - where the reader is and every way the desk moves them, now
 *     `lib/use-workspace-routing`;
 *   - the sweep, the auto-run and everything derived from a result, now
 *     `lib/use-sweep-run`;
 *   - and the ⌘K palette, already `lib/workspace-commands`.
 *
 * What stays is the shell's own job: mount the eight panels, hold the state
 * two or more of them share (the order draft, the execution sleeve), own the
 * one invalidation path every mutation calls, and keep the hooks above the
 * render so a tab switch can never change how many of them run.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import dynamic from "next/dynamic";

import ExecutionCockpit from "@/components/execution/ExecutionCockpit";
import LiveMarket from "@/components/LiveMarket";
import PortfolioWorkspace, { type PortfolioFocusDestination } from "@/components/PortfolioWorkspace";
import ResearchWorkspace from "@/components/ResearchWorkspace";
import RiskWorkspace from "@/components/RiskWorkspace";
import NextStepFooter from "@/components/common/NextStepFooter";
import CommandBar, { type Command } from "@/components/header/CommandBar";
import ShortcutsOverlay from "@/components/header/ShortcutsOverlay";
import WorkspaceBottomNav from "@/components/WorkspaceBottomNav";
import WorkspaceHeader from "@/components/WorkspaceHeader";
import WorkspaceIntro from "@/components/WorkspaceIntro";
import WorkspaceOverview from "@/components/WorkspaceOverview";
import WorkspaceSubtabs from "@/components/WorkspaceSubtabs";
import { useDataWorkQueue } from "@/lib/use-data-work-queue";
import {
  createInitialDeveloperWorkItems,
  loadDeveloperWorkItems,
  saveDeveloperWorkItems,
  type DeveloperWorkItem,
} from "@/lib/developer-work";
import { constraintLabel, fmt, usd } from "@/lib/format";
import { EXECUTION_SECTIONS } from "@/lib/sections";
import { useBook } from "@/lib/use-book";
import { useSweepRun } from "@/lib/use-sweep-run";
import { useSystemHealth } from "@/lib/use-system-health";
import { useWorkspaceRouting } from "@/lib/use-workspace-routing";
import { buildCommands } from "@/lib/workspace-commands";
import { DEFAULT_REQUEST, STRATEGY_LABELS, type Strategy } from "@/lib/types";
import { startUserPrefsSync } from "@/lib/user-prefs";
import type { Side } from "@/lib/venues";

// Section definitions live in lib/sections.ts — the rails, the palette and
// the hash whitelist all read the same arrays.

/**
 * The console workspaces load as their own chunks. They are the heaviest
 * subtrees on the page and none of them is needed for first paint, so the
 * initial bundle stops carrying them; `useConsolePrefetch` warms the chunks
 * before the first click, and the loading box holds a panel-sized rectangle so
 * the one cold visit cannot shift the layout.
 */
const PanelLoading = () => (
  <div className="skeleton" style={{ height: 480 }} aria-busy="true" aria-label="Loading workspace" />
);
const DataConsole = dynamic(() => import("@/components/DataConsole"), { loading: PanelLoading });
const ReliabilityConsole = dynamic(() => import("@/components/ReliabilityConsole"), { loading: PanelLoading });
const DeveloperConsole = dynamic(() => import("@/components/DeveloperConsole"), { loading: PanelLoading });

/**
 * Memoised once, at module level. The six persistent tabs stay mounted behind
 * `hidden`, so every page-level state change would otherwise re-render all of
 * them; with memo (and the stable hook returns backing their props) a hidden
 * tab re-renders only when the data it actually shows changed.
 */
const OverviewTab = memo(WorkspaceOverview);
const PortfolioTab = memo(PortfolioWorkspace);
const RiskTab = memo(RiskWorkspace);
const DataTab = memo(DataConsole);
const ReliabilityTab = memo(ReliabilityConsole);
const DeveloperTab = memo(DeveloperConsole);

export default function Page() {
  const {
    view, shellRef, visitedViews, navigate, warmView, openSection,
    overviewSection, researchSection, executionSection, dataSection,
    reliabilitySection, developerSection, riskSection, portfolioSection,
    setOverviewSection, setResearchSection, setExecutionSection, setDataSection,
    setReliabilitySection, setDeveloperSection, setRiskSection, setPortfolioSection,
    changeOverviewSection, changeResearchSection, changeExecutionSection,
    changeDeveloperSection, changeRiskSection, changePortfolioSection,
    changeDataSection, changeReliabilitySection,
    openRiskSection, openPortfolioSection, openResearchSummary, openLiveLiquidity,
    openReliabilityOverview, openDataOverview, openLoopStage, openReliabilitySection,
    copyLinkToView, tourStops,
  } = useWorkspaceRouting();
  const {
    req, data, inspect, displayedResult, activeResult, running, researchDirty,
    researchStale, sweepIncoming, error, errorFix, experiments, setExperiments,
    autoRun, setAutoRun, autoSuspended, setAutoSuspended, resultAnnouncement,
    run, runNow, commitRequest, updateRequest, updateStrategy, updateSymbol,
    cloneExperiment, dropExperiment, inspectCombo, pinRun, currentPinned,
    triedStrategies, mcDriver,
  } = useSweepRun({ view });

  const [side, setSide] = useState<Side>("BUY");
  // Start inside the gateway's $50k per-order cap so the primary demo action
  // can fill and immediately change Portfolio/Risk. Larger rejection presets
  // remain available on the ticket for exercising the gates deliberately.
  const [notional, setNotional] = useState(25_000);
  // The order draft beyond side/notional, lifted like they are so the ladder
  // (liquidity subtab) can stage a limit the ticket (trade subtab) picks up —
  // panels stay mounted, so the draft survives the jump.
  const [orderType, setOrderType] = useState<"MARKET" | "LIMIT">("MARKET");
  const [limitPrice, setLimitPrice] = useState<number | null>(null);
  // Execution owns its intent. Research promotion seeds it deliberately, while
  // changing a research dropdown does not silently retag an order draft.
  const [executionStrategy, setExecutionStrategy] = useState<Strategy>(DEFAULT_REQUEST.strategy);
  const [showMcBands, setShowMcBands] = useState(true);
  const [mcRunNonce, setMcRunNonce] = useState(0);
  const [developerWorkItems, setDeveloperWorkItems] = useState<DeveloperWorkItem[]>(createInitialDeveloperWorkItems);
  const [commandBarOpen, setCommandBarOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // One book and one health snapshot, shared by the tabs that read them. Both
  // hooks own their polling, so a tab is a rendering decision rather than a
  // second source of truth.
  const book = useBook();
  const systems = useSystemHealth(req.symbol);
  // The Data tab's work queue lives on the gateway; the hook owns the load,
  // the versioned writes and the offline hold, and the board renders `items`.
  const dataWork = useDataWorkQueue({ token: systems.token || null, active: view === "data" });
  const selectedSleeveAttribution = book.book?.attribution.by_strategy.find(
    (row) => row.strategy === executionStrategy,
  ) ?? null;
  const selectedSleeveDetail = selectedSleeveAttribution
    ? `${selectedSleeveAttribution.filled} accepted of ${selectedSleeveAttribution.orders} orders`
    : "no audited orders yet";
  /**
   * One invalidation path for every mutation the desk makes.
   *
   * Three handlers did this by hand — a settled order re-read the book, an
   * operator action re-read the book and health, Retry re-read both and timed
   * it — so what a mutation invalidated depended on which one had been copied,
   * and the next mutation added would have had to remember. A stale Portfolio
   * tab after a kill switch is what forgetting looks like.
   *
   * Still the fallback rather than the primary path: any order moves
   * `RiskState`'s accepted and rejected counts, so the streamed `seq` moves and
   * `useBook` refetches within about a second on its own. This is what a
   * deployment with no stream has instead; `probeGateway` coalesces by URL, so
   * it costs one there, not two. Returns the work, so Retry can time itself.
   */
  const revalidateDesk = useCallback(
    () => Promise.all([book.refresh(true), systems.refresh(true)]).then(() => undefined),
    [book.refresh, systems.refresh],
  );

  // The engineering queue hydrates the same way the experiments log does:
  // seeds render first (server and client agree), storage wins after mount.
  // The persist effect skips its own mount pass — it fires in the same commit
  // as hydration, while state still holds the seeds, and writing them there
  // would clobber a stored queue before the hydrating setState applied. The
  // skip also means a reader who never edits is never pinned to first-visit
  // seeds: storage stays empty until a real change, so seed updates from
  // later deploys still reach them.
  const developerWorkPersistReady = useRef(false);
  useEffect(() => {
    const stored = loadDeveloperWorkItems();
    if (stored) setDeveloperWorkItems(stored);
  }, []);

  useEffect(() => {
    if (!developerWorkPersistReady.current) {
      developerWorkPersistReady.current = true;
      return;
    }
    saveDeveloperWorkItems(developerWorkItems);
  }, [developerWorkItems]);

  /**
   * Mirrors preferences to the signed-in account, if there is one.
   *
   * Idempotent and a no-op while signed out, which is why it can start
   * unconditionally rather than waiting for a session that may never arrive.
   */
  useEffect(() => {
    startUserPrefsSync();
  }, []);

  /**
   * ⌘K lives here rather than in `WorkspaceHeader` because the palette it opens
   * cannot render inside that element — `.workspace-header` has a
   * `backdrop-filter`, which is a containing block for fixed-position
   * descendants, so the dialog has to be a sibling of the header to escape it.
   * The shortcut follows the thing it controls.
   */
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandBarOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /**
   * "?" opens the shortcuts-and-tour overlay — unless the keystroke belongs
   * to an editable target, where a question mark is just a question mark.
   */
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "?" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(?:INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      event.preventDefault();
      setShortcutsOpen((prev) => !prev);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const focusPortfolioSymbol = useCallback((symbol: string, destination: PortfolioFocusDestination) => {
    updateSymbol(symbol);
    navigate(destination);
  }, [navigate, updateSymbol]);

  // Ladder click-to-trade: lifting an ask is a BUY, hitting a bid is a SELL.
  // The panels stay mounted, so the staged draft is live in the ticket the
  // moment the trade subtab unhides — no focus juggling needed.
  const stageLimitFromLadder = useCallback(({ side: picked, price }: { side: Side; price: number }) => {
    setSide(picked);
    setOrderType("LIMIT");
    setLimitPrice(price);
    setExecutionSection("trade");
  }, [setExecutionSection]);

  const resumeAutoRun = useCallback(() => {
    setAutoRun(true);
    setAutoSuspended(null);
  }, [setAutoRun, setAutoSuspended]);

  const changeAutoRun = useCallback((next: boolean) => {
    setAutoRun(next);
    setAutoSuspended(null);
  }, [setAutoRun, setAutoSuspended]);

  /**
   * Everything ⌘K can reach, built where the lists already live. The palette
   * holds no routing knowledge of its own: all 8 tabs, every rail section,
   * all 46 strategies, every research symbol and the kill switch flow from
   * this one memo. Labels for the five workspaces whose section objects are
   * private mirror their rails verbatim.
   */
  // Built in lib/workspace-commands.ts. The dependency list is packed rather
  // than one-per-line because this file sits at its size ceiling and the
  // ratchet only turns one way.
  const commands = useMemo<Command[]>(() => buildCommands({
    navigate, setOverviewSection, setResearchSection, setExecutionSection,
    setPortfolioSection, setRiskSection, setDataSection, setReliabilitySection,
    setDeveloperSection, updateStrategy, updateSymbol, run, pinRun, running,
    currentPinned, data, showMcBands, setShowMcBands, setMcRunNonce, side,
    setSide, setNotional, copyLinkToView, setShortcutsOpen, view,
    researchSection, focusPortfolioSymbol, symbol: req.symbol,
    reconnectSockets: systems.onReconnectSockets,
    // The palette wants the re-read, not the read's outcome. See the poll.
    refreshHealth: (quiet: boolean) => void systems.refresh(quiet),
  }), [
    copyLinkToView, currentPinned, data, focusPortfolioSymbol, navigate, pinRun,
    req.symbol, researchSection, run, running, showMcBands, side,
    systems.onReconnectSockets, systems.refresh, updateStrategy, updateSymbol, view,
    setOverviewSection, setResearchSection, setExecutionSection, setPortfolioSection,
    setRiskSection, setDataSection, setReliabilitySection, setDeveloperSection,
  ]);

  return (
    <>
      <a className="skip-link" href="#workspace-content">Skip to workspace content</a>
      <WorkspaceHeader
        view={view}
        onViewChange={navigate}
            onViewIntent={warmView}
        onOpenProviderHealth={() => openReliabilitySection("services", "reliability-provider-health")}
        onOpenTailLatency={() => openReliabilitySection("services", "reliability-latency-guide")}
        decisionLatency={systems.decisionLatency}
        onOpenCommandBar={() => setCommandBarOpen(true)}
        latency={systems.health?.summary.upstreamLatency ?? systems.health?.summary.latency ?? null}
        gatewayHopLatency={systems.health?.summary.gatewayHopLatency ?? null}
        degraded={systems.degraded}
        providersReady={systems.health?.summary.ready ?? null}
        providersTotal={systems.health?.summary.total ?? null}
        healthUpdatedAt={systems.updatedAt}
        healthUnreachable={Boolean(systems.healthError)}
        /* One statement of provenance for the whole desk. The book is the right
           source for it: it is the payload Portfolio, Risk, Execution and the
           Overview KPIs all read, so if it is generated then most of what is on
           screen is, and if it is live the writes are open. */
        dataSource={{
          provenance: book.provenance,
          detail: book.error?.error ?? null,
          onRetry: revalidateDesk,
        }}
        halt={book.book
          ? {
              halted: book.book.trading_halted,
              haltedSymbols: book.book.halted_symbols,
              sandbox: Boolean(book.book.sandbox),
            }
          : null}
        riskControl={{
          guardMode: systems.guard,
          token: systems.token,
          onTokenChange: systems.setToken,
          onExecuted: revalidateDesk,
        }}
      />

      {/* A sibling of the header, never a child: `.workspace-header`'s
          `backdrop-filter` is a containing block for fixed-position
          descendants, and a modal rendered inside it is positioned against the
          header box rather than the viewport. See CommandBar's header. */}
      <CommandBar
        open={commandBarOpen}
        onClose={() => setCommandBarOpen(false)}
        commands={commands}
      />

      <ShortcutsOverlay
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        stops={tourStops}
      />

      <main id="workspace-content" ref={shellRef} className="workspace-shell" tabIndex={-1}>
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
              insights={[
                {
                  label: "Book source",
                  value: book.sandbox ? "Sandbox" : book.connectionState,
                  detail: book.isStale ? "last good snapshot" : "shared with Risk",
                  tone: book.isStale || book.sandbox ? "warn" : "good",
                },
                {
                  label: "Positions",
                  value: String(book.book?.exposure.positions.length ?? 0),
                  detail: book.book ? "current book" : "connecting",
                  tone: "accent",
                  mono: true,
                },
                {
                  label: "Risk model",
                  value: book.riskLoading ? "Measuring" : book.risk ? "Measured" : "Pending",
                  detail: book.risk ? `${book.risk.observations} aligned bars` : "no assumptions substituted",
                  tone: book.risk ? "good" : "warn",
                },
                {
                  label: "Execution sleeve",
                  value: STRATEGY_LABELS[executionStrategy],
                  detail: selectedSleeveDetail,
                  tone: selectedSleeveAttribution?.filled ? "good" : "accent",
                },
              ]}
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
              /* The worst of the three: this was all five section tabs —
                 Limits, VaR & model, Monte Carlo, Stress tests, Controls — in
                 the order they appear, restated a line above them. */
              description={<>How much this book can lose before a limit stops it, and what does the stopping.</>}
              insights={[
                {
                  label: "Trading state",
                  value: book.book?.trading_halted ? "Halted" : book.book ? "Active" : "Connecting",
                  detail: book.sandbox ? "sandbox book" : "gateway decision",
                  tone: book.book?.trading_halted ? "critical" : book.book ? "good" : "warn",
                },
                {
                  label: "Binding constraint",
                  value: book.book
                    ? constraintLabel(book.book.risk_budget.binding_constraint[0])
                    : "Pending",
                  detail: book.book
                    ? `${fmt(book.book.risk_budget.binding_constraint[1] * 100, 1)}% utilised`
                    : "waiting for the book",
                  tone: (book.book?.risk_budget.binding_constraint[1] ?? 0) >= 0.9 ? "critical" : "warn",
                },
                {
                  label: "Tail risk",
                  value: book.risk
                    ? usd(book.risk.historicalVar95 ?? book.risk.var95, 0)
                    : book.riskLoading ? "Measuring" : "Pending",
                  detail: book.varValidation
                    ? `${book.varValidation.zone} validation, ${book.varValidation.observations} obs`
                    : "historical VaR 95, 1 day",
                  tone: book.varValidation?.zone === "red" ? "critical" : book.varValidation?.zone === "yellow" ? "warn" : "accent",
                },
                {
                  label: "Execution sleeve",
                  value: STRATEGY_LABELS[executionStrategy],
                  detail: `${selectedSleeveDetail}; aggregate book risk below`,
                  tone: selectedSleeveAttribution?.filled ? "good" : "accent",
                },
              ]}
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
              insights={[
                { label: "Instrument", value: req.symbol, detail: "consolidated L2", tone: "accent", mono: true },
                { label: "Intent", value: `${side} ${usd(notional, 0)}`, detail: "editable in the ticket", tone: side === "BUY" ? "good" : "warn", mono: true },
                { label: "Authority", value: "Paper only", detail: "pre-trade gates stay in control", tone: "good" },
              ]}
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

      </main>

      <WorkspaceBottomNav
        view={view}
        onNavigate={navigate}
        onOpenPalette={() => setCommandBarOpen(true)}
      />

      <footer className="workspace-footer">
        <span>AlphaEngine</span>
        <p>
          Educational case-study demonstration built for a developer assessment. Not a brokerage
          or investment service: it opens no brokerage accounts, holds no funds and places no real
          orders. Signing in is optional and stores workspace preferences only — the desk is fully
          browsable without it. Execution is paper-only and remains gated by the risk gateway.
          Not investment advice.
        </p>
      </footer>
    </>
  );
}
