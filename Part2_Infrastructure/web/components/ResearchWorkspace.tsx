"use client";

/**
 * Quant researcher's tab: build a candidate, validate it, promote it.
 *
 * The rule that runs through every section below: a result belonging to a
 * context the reader has since changed stays VISIBLE, under a veil that says
 * which one it belongs to. It is never silently redrawn as current, and never
 * blanked either — `StaleGate` is on every section whose content is a function
 * of the current parameters, and off lineage/codex, which describe catalogue and past.
 */
import { useEffect, useRef } from "react";

import Controls from "@/components/Controls";
import AttributionSection from "@/components/research/AttributionSection";
import CandidateRanking from "@/components/research/CandidateRanking";
import DecisionSection from "@/components/research/DecisionSection";
import ExperimentHistory from "@/components/research/ExperimentHistory";
import FavouritesPanel from "@/components/research/FavouritesPanel";
import FittedModels from "@/components/research/FittedModels";
import ResearchBanners from "@/components/research/ResearchBanners";
import ResearchCorpus from "@/components/research/ResearchCorpus";
import ResearchSummary from "@/components/research/ResearchSummary";
import ResearchSummaryViewSwitcher from "@/components/research/ResearchSummaryViewSwitcher";
import SignalDAGViewer from "@/components/research/SignalDAGViewer";
import StabilityPanel from "@/components/research/StabilityPanel";
import StaleGate from "@/components/research/StaleGate";
import StrategyCodex from "@/components/research/StrategyCodex";
import StrategyDocCard from "@/components/research/StrategyDocCard";
import WalkForwardTimeline from "@/components/research/WalkForwardTimeline";
import type { ResearchWorkspaceProps } from "@/components/research/research-workspace-types";
import { useBenchmarkFocus } from "@/components/research/use-benchmark-focus";
import WorkspaceIntro from "@/components/WorkspaceIntro";
import WorkspaceSubtabs, { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
import { annotateExperiment, clearExperiments, saveExperiments } from "@/lib/experiments";
import { RESEARCH_SECTIONS } from "@/lib/sections";
import { STRATEGY_LABELS } from "@/lib/types";

export type { ResearchWorkspaceProps } from "@/components/research/research-workspace-types";

export default function ResearchWorkspace({
  req, data, displayedResult, activeResult, inspect, running, researchDirty,
  researchStale, sweepIncoming, error, errorFix, autoRun, autoSuspended,
  experiments, setExperiments, currentPinned, triedStrategies, resultAnnouncement,
  showMcBands, onShowMcBandsChange, systemsHealth, systemsHealthError, run,
  updateRequest, updateStrategy, commitRequest, pinRun, inspectCombo,
  cloneExperiment, dropExperiment, onAutoRunChange, onResumeAuto, onStageSleeve,
  onOpenSection, section, onSectionChange, summaryView, summaryViews, setupViews,
  onSummaryViewChange,
}: ResearchWorkspaceProps) {
  const researchContentRef = useRef<HTMLDivElement | null>(null);
  const {
    selectRef,
    reachNote: benchmarkReachNote,
    chooseBenchmark,
  } = useBenchmarkFocus({
    section,
    summaryView,
    summaryViews,
    onSectionChange,
    onSummaryViewChange,
  });
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
            // Uppercased, as WorkspaceOverview and the Verdict pill already print this same field: the raw enum rendered "pass" in lowercase beside the Title-case "Running", "Stale" and "Pending" it shares the slot with, and `.page-insight > strong` sets no text-transform.
            value: running ? "Running" : activeResult ? activeResult.verdict.level.toUpperCase() : researchDirty ? "Stale" : "Pending",
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
              /* Every disabled state names its own cause: `running` and
                 `!data` used to fall through to the enabled title, so a
                 dimmed button said what it would do and not why it would
                 not. */
              title={currentPinned
                ? "These parameters are already in the run archive"
                : running
                  ? "Wait for the sweep to finish; no settled result to record yet"
                  : !data
                    ? "No result to record yet"
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
        <div className="research-content" ref={researchContentRef}>
          <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {resultAnnouncement && (
              <span key={resultAnnouncement.key}>{resultAnnouncement.text}</span>
            )}
          </p>

          <WorkspaceSubtabPanel workspaceId="research" tabId="summary" activeId={section}>
            {section === "summary" && (
              <>
                <ResearchSummaryViewSwitcher
                  options={summaryViews}
                  value={summaryView}
                  onValueChange={onSummaryViewChange}
                />
                <div
                  id="research-summary-view-panel"
                  role="tabpanel"
                  aria-labelledby={`research-summary-${summaryView}-tab`}
                >
                  {summaryView === "setup" ? (
                    <Controls
                      req={req}
                      setReq={updateRequest}
                      onRun={() => run()}
                      onCommit={commitRequest}
                      tried={triedStrategies}
                      setupViews={setupViews}
                      benchmarkSelectRef={selectRef}
                    />
                  ) : displayedResult ? (
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
                  ) : (
                    <div className="card" role="status" aria-live="polite">
                      <span className="page-kicker">
                        {running ? "Sweep in progress" : error ? "Result unavailable" : "No result yet"}
                      </span>
                      <h2>{running ? `Testing ${req.symbol}` : "No research result is available"}</h2>
                      <p className="sub">
                        {running
                          ? `The first ${req.symbol} ${req.interval} sweep is running. No stored demonstration result is shown while it completes.`
                          : error
                            ? "The request failed and there is no earlier result from this browser to retain. Nothing has been substituted."
                            : "Run now will request a result for the current setup. Until it returns, every result-dependent measure stays unavailable."}
                      </p>
                    </div>
                  )}
                </div>
              </>
            )}
          </WorkspaceSubtabPanel>

          {!data && section !== "summary" && !["lineage", "runs", "fitted", "codex"].includes(section) && (
            <div className="card" role="status" aria-live="polite">
              <span className="page-kicker">Result-dependent view</span>
              <h2>No completed sweep to inspect</h2>
              <p className="sub">
                {running
                  ? `The first ${req.symbol} ${req.interval} sweep is still running.`
                  : "This view opens after a sweep returns. No committed demonstration result fills the gap."}
              </p>
            </div>
          )}

          {data && displayedResult && (
            <>
              <WorkspaceSubtabPanel workspaceId="research" tabId="parameters" activeId={section}>
                <StaleGate
                  active={researchStale}
                  mode={sweepIncoming ? "recomputing" : "stale"}
                  running={running}
                  targetSymbol={req.symbol}
                  targetInterval={req.interval}
                  onRerun={() => run()}
                >
                  {/* Both selection handles call inspectCombo. DOM order stays
                      surface first, ranking second. A `results.length > 3`
                      gate stood on the surface and rendered NOTHING for a
                      narrow grid; the threshold is inside StabilityPanel now,
                      which reports it. */}
                  <div className="research-param-pair">
                    <StabilityPanel
                      stability={data.stability}
                      results={data.results}
                      best={data.best}
                      selected={inspect}
                      onSelect={inspectCombo}
                    />
                    <CandidateRanking data={data} onSelect={inspectCombo} selected={inspect} />
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
                  onChooseBenchmark={chooseBenchmark}
                  benchmarkReachNote={benchmarkReachNote}
                />
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

            </>
          )}

          {/* Lineage and the local run archive do not depend on the newest
              sweep completing. Keeping them outside the result gate prevents
              a network failure from erasing evidence the browser already has. */}
          <WorkspaceSubtabPanel workspaceId="research" tabId="lineage" activeId={section}>
            <SignalDAGViewer health={systemsHealth} healthError={systemsHealthError} />
            <ResearchCorpus />
          </WorkspaceSubtabPanel>
          <WorkspaceSubtabPanel workspaceId="research" tabId="runs" activeId={section}>
            <ExperimentHistory
              records={experiments}
              activeRequest={req}
              onClone={cloneExperiment}
              onRemove={dropExperiment}
              onClear={() => setExperiments(clearExperiments())}
              onAnnotate={(id, annotation) =>
                setExperiments((current) => annotateExperiment(current, id, annotation))}
              onImport={(merged) => setExperiments(saveExperiments(merged))}
            />
            <FavouritesPanel records={experiments} />
          </WorkspaceSubtabPanel>

          {/* Reference material, outside the result gate: the codex is about
              the catalogue, not the current sweep. */}
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
                onSummaryViewChange("results");
                onSectionChange("summary");
              }}
            />
          </WorkspaceSubtabPanel>
        </div>
      </div>
    </>
  );
}
