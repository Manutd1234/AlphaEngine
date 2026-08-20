"use client";

/**
 * Quant researcher's tab: build a candidate, validate it, promote it.
 *
 * Research was the last of the eight workspaces still rendered inline in
 * `app/dashboard/page.tsx` — roughly 490 lines of JSX inside a 2,000-line
 * component, while the other seven had already been given a child of their
 * own. This is that extraction, and it takes the same shape `PortfolioWorkspace`
 * and `RiskWorkspace` already have: the shell owns the sweep and the routing,
 * this component owns the panels.
 *
 * The rule that runs through every section below: a result belonging to a
 * context the reader has since changed stays VISIBLE, under a veil that says
 * which one it belongs to. It is never silently redrawn as current, and never
 * blanked either — `StaleGate` is on every section whose content is a function
 * of the current parameters, and deliberately off the two (lineage, codex)
 * that answer questions about the catalogue and the past.
 */

import { useEffect, useRef } from "react";

import Controls from "@/components/Controls";
import AttributionSection from "@/components/research/AttributionSection";
import DecisionSection from "@/components/research/DecisionSection";
import ExperimentHistory from "@/components/research/ExperimentHistory";
import FavouritesPanel from "@/components/research/FavouritesPanel";
import FittedModels from "@/components/research/FittedModels";
import ResearchBanners from "@/components/research/ResearchBanners";
import ResearchCorpus from "@/components/research/ResearchCorpus";
import ResearchSummary from "@/components/research/ResearchSummary";
import SignalDAGViewer from "@/components/research/SignalDAGViewer";
import StabilityPanel from "@/components/research/StabilityPanel";
import StaleGate from "@/components/research/StaleGate";
import StrategyCodex from "@/components/research/StrategyCodex";
import StrategyDocCard from "@/components/research/StrategyDocCard";
import WalkForwardTimeline from "@/components/research/WalkForwardTimeline";
import { ResultsTable } from "@/components/Tables";
import type { WorkspaceView } from "@/components/WorkspaceHeader";
import WorkspaceIntro from "@/components/WorkspaceIntro";
import WorkspaceSubtabs, { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
import type { SystemHealth } from "@/components/systems/types";
import {
  annotateExperiment, clearExperiments, saveExperiments, type ExperimentRecord,
} from "@/lib/experiments";
import { RESEARCH_SECTIONS, type ResearchSection } from "@/lib/sections";
import {
  ParamResult, STRATEGY_LABELS, type Strategy, type SweepRequest, type SweepResponse,
} from "@/lib/types";
import type { RunSweep } from "@/lib/use-sweep-run";

export interface ResearchWorkspaceProps {
  /** The live request the controls edit — not the request the result came from. */
  req: SweepRequest;
  data: SweepResponse | null;
  /** The drill-down's result when one is open, else the sweep's. */
  displayedResult: SweepResponse | null;
  /** The result only while it still belongs to the current context; null once stale. */
  activeResult: SweepResponse | null;
  inspect: ParamResult | null;
  running: boolean;
  researchDirty: boolean;
  researchStale: boolean;
  sweepIncoming: boolean;
  error: string | null;
  errorFix: string | null;
  autoRun: boolean;
  autoSuspended: string | null;
  experiments: ExperimentRecord[];
  setExperiments: (next: ExperimentRecord[] | ((current: ExperimentRecord[]) => ExperimentRecord[])) => void;
  currentPinned: boolean;
  triedStrategies: Set<Strategy>;
  /** Keyed so a repeated sentence still replaces the live region's child. */
  resultAnnouncement: { key: string; text: string } | null;
  showMcBands: boolean;
  onShowMcBandsChange: (next: boolean) => void;
  /** For the lineage pane, which reports observed stages rather than a fixed list. */
  systemsHealth: SystemHealth | null;
  systemsHealthError: string | null;
  run: RunSweep;
  updateRequest: (next: SweepRequest) => void;
  updateStrategy: (strategy: Strategy) => void;
  commitRequest: () => void;
  pinRun: () => void;
  inspectCombo: (result: ParamResult) => void;
  cloneExperiment: (request: SweepRequest) => void;
  dropExperiment: (id: string) => void;
  onAutoRunChange: (next: boolean) => void;
  onResumeAuto: () => void;
  /** Promotion stages the sleeve Execution will carry. Research never sends it. */
  onStageSleeve: (strategy: Strategy) => void;
  /** The shell's section-aware cross-link, so a hand-off names the panel it lands on. */
  onOpenSection: (view: WorkspaceView, section?: string) => void;
  section: ResearchSection;
  onSectionChange: (section: ResearchSection) => void;
}

export default function ResearchWorkspace({
  req, data, displayedResult, activeResult, inspect, running, researchDirty,
  researchStale, sweepIncoming, error, errorFix, autoRun, autoSuspended,
  experiments, setExperiments, currentPinned, triedStrategies, resultAnnouncement,
  showMcBands, onShowMcBandsChange, systemsHealth, systemsHealthError, run,
  updateRequest, updateStrategy, commitRequest, pinRun, inspectCombo,
  cloneExperiment, dropExperiment, onAutoRunChange, onResumeAuto, onStageSleeve,
  onOpenSection, section, onSectionChange,
}: ResearchWorkspaceProps) {
  const researchContentRef = useRef<HTMLDivElement | null>(null);
  // Each evidence section should open at its own beginning. The desktop
  // workbench deliberately gives this shared pane the scroll, so without this
  // reset Summary's scrollTop would carry into Parameters or Attribution.
  useEffect(() => {
    if (researchContentRef.current) researchContentRef.current.scrollTop = 0;
  }, [section]);

  return (
    <>
      <WorkspaceIntro
        kicker="Quant researcher"
        title="Research lab"
        description={<>Build, validate and promote {req.symbol} experiments.</>}
        insights={[
          { label: "Instrument", value: req.symbol, detail: req.interval, tone: "accent", mono: true },
          {
            label: "Candidate",
            value: running ? "Running" : activeResult ? activeResult.verdict.level : researchDirty ? "Stale" : "Pending",
            detail: activeResult ? `${activeResult.combosTested} combinations tested` : "explicit rerun required",
            tone: activeResult?.verdict.level === "pass" ? "good" : activeResult?.verdict.level === "fail" ? "critical" : "warn",
          },
          {
            label: "Experiment trail",
            value: String(experiments.length),
            detail: "locally recorded attempts",
            tone: "accent",
            mono: true,
          },
        ]}
      />

      <ResearchBanners
        req={req}
        data={data}
        error={error}
        errorFix={errorFix}
        autoSuspended={autoSuspended}
        researchDirty={researchDirty}
        sweepIncoming={sweepIncoming}
        updateRequest={updateRequest}
        run={run}
        onResumeAuto={onResumeAuto}
        onInspectDataHealth={() => onOpenSection("data", "overview")}
      />

      <WorkspaceSubtabs
        workspaceId="research"
        label="Quant researcher sections"
        tabs={RESEARCH_SECTIONS}
        activeId={section}
        onChange={onSectionChange}
        secondary={["runs", "codex"]}
        actions={
          <>
            <label className="rail-toggle" title="Re-run the sweep whenever a control settles">
              <input
                type="checkbox"
                checked={autoRun}
                onChange={(event) => onAutoRunChange(event.target.checked)}
              />
              Auto
            </label>
            {/* Auto-runs deliberately do not enter the trail (see `run`),
                so keeping one is an explicit act. */}
            <button
              type="button"
              onClick={pinRun}
              disabled={!data || currentPinned || running}
              title={currentPinned
                ? "These parameters are already in the run archive"
                : "Record these parameters and their result in the run archive"}
            >
              {currentPinned ? "Pinned" : "Pin run"}
            </button>
            <button
              type="button"
              className="primary-action"
              onClick={() => run()}
              disabled={running}
            >
              {running ? "Running…" : "Run now"}
            </button>
          </>
        }
      />

      {inspect && (
        <div className="banner warn research-inspection-banner" role="status">
          <span aria-hidden>◎</span>
          <div>
            Inspecting <strong className="num">{inspect.fast}/{inspect.slow}</strong> without replacing the full parameter sweep.
            <button className="text-action" onClick={() => run()}>Back to full sweep →</button>
          </div>
        </div>
      )}

      <div className="research-layout research-layout--sectioned">
        <Controls
          req={req}
          setReq={updateRequest}
          onRun={() => run()}
          onCommit={commitRequest}
          tried={triedStrategies}
        />

        <div className="research-content" ref={researchContentRef}>
          <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {resultAnnouncement && (
              <span key={resultAnnouncement.key}>{resultAnnouncement.text}</span>
            )}
          </p>
          {/* No empty-state map: `data` seeds from SEED_RUN and the one
              setData call writes completed runs, so a runless research
              tab is a state this component cannot reach. The map that
              stood here was unreachable — and its "Run research" button
              was a second primary-action for the rail's "Run now". If
              the seed is ever removed, restore a reported empty state
              rather than letting the panels render nothing. */}
          {data && displayedResult && (
            <>
              <WorkspaceSubtabPanel workspaceId="research" tabId="summary" activeId={section}>
                <ResearchSummary
                  displayedResult={displayedResult}
                  researchStale={researchStale}
                  sweepIncoming={sweepIncoming}
                  running={running}
                  targetSymbol={req.symbol}
                  targetInterval={req.interval}
                  showMcBands={showMcBands}
                  onShowMcBandsChange={onShowMcBandsChange}
                  onRerun={() => run()}
                />
              </WorkspaceSubtabPanel>

              <WorkspaceSubtabPanel workspaceId="research" tabId="parameters" activeId={section}>
                <StaleGate
                  active={researchStale}
                  mode={sweepIncoming ? "recomputing" : "stale"}
                  running={running}
                  targetSymbol={req.symbol}
                  targetInterval={req.interval}
                  onRerun={() => run()}
                >
                  {data.results.length > 3 ? (
                    <StabilityPanel
                      stability={data.stability}
                      results={data.results}
                      best={data.best}
                      selected={inspect}
                      onSelect={inspectCombo}
                    />
                  ) : null}
                  <div className="card">
                    <h2>Candidate ranking</h2>
                    <p className="sub">The top 15 combinations behind the winner. Select a row to inspect that pair without losing the full sweep.</p>
                    <ResultsTable data={data} onSelect={inspectCombo} selected={inspect} />
                  </div>
                </StaleGate>
              </WorkspaceSubtabPanel>

              <WorkspaceSubtabPanel workspaceId="research" tabId="walkforward" activeId={section}>
                <StaleGate
                  active={researchStale}
                  mode={sweepIncoming ? "recomputing" : "stale"}
                  running={running}
                  targetSymbol={req.symbol}
                  targetInterval={req.interval}
                  onRerun={() => run()}
                >
                  {/* One card, one per-fold table. A "Walk-forward
                      validation" card used to stack beneath this with a
                      second table repeating five of its columns for the
                      same folds; the timeline's table now carries the
                      train window and OOS return it alone added. */}
                  <WalkForwardTimeline report={data.walkForwardReport} />
                </StaleGate>
              </WorkspaceSubtabPanel>

              <WorkspaceSubtabPanel workspaceId="research" tabId="attribution" activeId={section}>
                <AttributionSection
                  data={data}
                  researchStale={researchStale}
                  sweepIncoming={sweepIncoming}
                  running={running}
                  targetSymbol={req.symbol}
                  targetInterval={req.interval}
                  onRerun={() => run()}
                />
              </WorkspaceSubtabPanel>

              {/*
                Lineage answers "where did this signal come from and has
                the desk seen it before" — provenance, not decomposition.
                It carries no StaleGate at all: the signal path is the
                system's shape rather than this sweep's output, and the
                corpus answers a question about history, so veiling
                either when the current parameters change would imply the
                past had gone stale too.
              */}
              <WorkspaceSubtabPanel workspaceId="research" tabId="lineage" activeId={section}>
                {/* Real state, not a hardcoded array: the panel reports
                    what this deployment can observe, and says "not
                    measured" for the one stage that runs in the browser
                    and therefore has no server timing. */}
                <SignalDAGViewer health={systemsHealth} healthError={systemsHealthError} />
                <ResearchCorpus />
              </WorkspaceSubtabPanel>

              <WorkspaceSubtabPanel workspaceId="research" tabId="decision" activeId={section}>
                <DecisionSection
                  data={data}
                  researchStale={researchStale}
                  sweepIncoming={sweepIncoming}
                  running={running}
                  researchDirty={researchDirty}
                  inspect={inspect}
                  targetSymbol={req.symbol}
                  targetInterval={req.interval}
                  onRerun={() => run()}
                  onStageSleeve={onStageSleeve}
                  onOpenSection={onOpenSection}
                />
              </WorkspaceSubtabPanel>

              <WorkspaceSubtabPanel workspaceId="research" tabId="runs" activeId={section}>
                <ExperimentHistory
                  records={experiments}
                  activeRequest={data.request}
                  onClone={cloneExperiment}
                  onRemove={dropExperiment}
                  onClear={() => setExperiments(clearExperiments())}
                  onAnnotate={(id, annotation) =>
                    setExperiments((current) => annotateExperiment(current, id, annotation))}
                  onImport={(merged) => setExperiments(saveExperiments(merged))}
                />
                {/* Below the log it draws from, not beside it: choosing
                    favourites is something a reader does after reading
                    the history, and a combine control above the runs it
                    combines has nothing to point at yet. */}
                <FavouritesPanel records={experiments} />
              </WorkspaceSubtabPanel>
            </>
          )}

          {/* Reference material, outside both the empty-state map and
              the data gate: the codex is about the catalogue, not the
              current sweep, so it neither goes stale nor needs a run. */}
          <WorkspaceSubtabPanel workspaceId="research" tabId="fitted" activeId={section}>
            <FittedModels />
          </WorkspaceSubtabPanel>
          <WorkspaceSubtabPanel workspaceId="research" tabId="codex" activeId={section}>
            <StrategyDocCard strategy={req.strategy} />
            <StrategyCodex
              records={experiments}
              activeStrategy={req.strategy}
              onSelect={(strategy) => {
                updateStrategy(strategy);
                onSectionChange("summary");
              }}
            />
          </WorkspaceSubtabPanel>
        </div>
      </div>
    </>
  );
}
