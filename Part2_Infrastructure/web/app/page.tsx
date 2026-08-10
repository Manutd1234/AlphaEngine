"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

import Controls from "@/components/Controls";
import DataConsole, { DATA_SECTION_IDS, type DataSection } from "@/components/DataConsole";
import DeveloperConsole, { type DeveloperSection } from "@/components/DeveloperConsole";
import EquityChart from "@/components/EquityChart";
import ExecutionCockpit from "@/components/execution/ExecutionCockpit";
import LiveMarket, { type ExecutionSection } from "@/components/LiveMarket";
import PortfolioWorkspace, {
  PORTFOLIO_SECTION_IDS,
  type PortfolioFocusDestination,
  type PortfolioSection,
} from "@/components/PortfolioWorkspace";
import PriceChart from "@/components/PriceChart";
import ReliabilityConsole, { RELIABILITY_SECTION_IDS, type ReliabilitySection } from "@/components/ReliabilityConsole";
import RiskWorkspace, { RISK_SECTION_IDS, type RiskSection } from "@/components/RiskWorkspace";
import SignalDAGViewer from "@/components/research/SignalDAGViewer";
import StrategyDocCard from "@/components/research/StrategyDocCard";
import ExperimentHistory from "@/components/research/ExperimentHistory";
import FactorPanel from "@/components/research/FactorPanel";
import FavouritesPanel from "@/components/research/FavouritesPanel";
import BenchmarkPanel from "@/components/research/BenchmarkPanel";
import PromotionPanel from "@/components/research/PromotionPanel";
import QualityScorePanel from "@/components/research/QualityScorePanel";
import ResearchCorpus from "@/components/research/ResearchCorpus";
import StrategyCodex from "@/components/research/StrategyCodex";
import RegimePanel from "@/components/research/RegimePanel";
import SizingPanel from "@/components/research/SizingPanel";
import StabilityPanel from "@/components/research/StabilityPanel";
import StaleGate from "@/components/research/StaleGate";
import TearSheet from "@/components/research/TearSheet";
import WalkForwardTimeline from "@/components/research/WalkForwardTimeline";
import NextStepFooter from "@/components/common/NextStepFooter";
import StatTile from "@/components/StatTile";
import { ResultsTable, WalkForwardTable } from "@/components/Tables";
import Verdict from "@/components/Verdict";
import CommandBar, { type Command } from "@/components/header/CommandBar";
import WorkspaceHeader, { NAV_ITEMS, type WorkspaceView } from "@/components/WorkspaceHeader";
import WorkspaceIntro from "@/components/WorkspaceIntro";
import WorkspaceOverview from "@/components/WorkspaceOverview";
import WorkspaceSubtabs, { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
import { createInitialDataWorkItems, type DataWorkItem } from "@/lib/data-work-queue";
import { createInitialDeveloperWorkItems, type DeveloperWorkItem } from "@/lib/developer-work";
import { fmt, pct, signedPct, usd } from "@/lib/format";
import { REFERENCE_EQUITY } from "@/lib/portfolio";
import { useBook } from "@/lib/use-book";
import { useSystemHealth } from "@/lib/use-system-health";
import { RESEARCH_SYMBOLS } from "@/lib/research-symbols";
import {
  DEFAULT_REQUEST,
  ParamResult,
  STRATEGY_FAMILY,
  STRATEGY_LABELS,
  SweepRequest,
  SweepResponse,
  type Strategy,
} from "@/lib/types";
import {
  addExperiment,
  annotateExperiment,
  clearExperiments,
  loadExperiments,
  removeExperiment,
  sameRequest,
  saveExperiments,
  type ExperimentRecord,
} from "@/lib/experiments";
import { strategyProgress } from "@/lib/strategy-progress";
import { toggleDocumentThemeMode } from "@/lib/theme";
import { APP_COMMIT } from "@/lib/version";
import type { Side } from "@/lib/venues";

const VIEWS: WorkspaceView[] = NAV_ITEMS.map((item) => item.id);

type ResearchSection = "summary" | "parameters" | "walkforward" | "attribution" | "decision" | "runs" | "codex";

const RESEARCH_SECTIONS = [
  { id: "summary", label: "Summary", description: "Verdict & performance" },
  { id: "parameters", label: "Parameters", description: "Stability & ranking" },
  { id: "walkforward", label: "Walk-forward", description: "Out-of-sample evidence" },
  { id: "attribution", label: "Attribution", description: "Factors, tail & lineage" },
  { id: "decision", label: "Decision", description: "Promotion & sizing" },
  { id: "runs", label: "Runs", description: "Experiment history" },
  { id: "codex", label: "Codex", description: "Models & strategy guide" },
] as const;

const EXECUTION_SECTIONS = [
  { id: "trade", label: "Trade", description: "Ticket & pre-trade gates" },
  { id: "liquidity", label: "Liquidity", description: "Depth & consolidated book" },
  { id: "routing", label: "Routing & TCA", description: "Cost & venue allocation" },
  { id: "activity", label: "Activity", description: "Quality, fills & alerts" },
] as const;

/** Section ids, for validating a hash before it is trusted as state. */
const RESEARCH_SECTION_IDS = RESEARCH_SECTIONS.map((s) => s.id) as readonly ResearchSection[];
const EXECUTION_SECTION_IDS = EXECUTION_SECTIONS.map((s) => s.id) as readonly ExecutionSection[];
const DEVELOPER_SECTION_IDS = [
  "overview",
  "codebase",
  "work",
  "apis",
  "quality",
] as const satisfies readonly DeveloperSection[];

/**
 * The console used to be one "Systems" tab. Anyone holding a link to it lands on
 * reliability, which is the half that answers "is it up" — the question someone
 * following a saved systems link is most likely asking.
 */
const LEGACY_VIEWS: Record<string, WorkspaceView> = {
  systems: "reliability",
};

/** Remembers the Auto choice across visits. Off is a deliberate act; it should stick. */
const AUTO_RUN_KEY = "alphaengine.research.autorun";

/**
 * Safety net for the one commit signal the DOM does not give us: a field the
 * user typed into and then abandoned without blurring, pressing Enter, or
 * touching anything else. Long enough that it never races a real `change`,
 * short enough that the result does not feel abandoned. Runs it triggers are
 * deduplicated by `sameRequest`, so firing after a `change` already ran is a
 * no-op rather than a second request.
 */
const IDLE_COMMIT_MS = 700;

/**
 * A sweep slower than this makes auto-run feel worse than the button it
 * replaced, so Auto turns itself off and says why rather than making every
 * subsequent edit wait on a run the user did not ask for.
 */
const AUTO_RUN_BUDGET_MS = 1500;

export default function Page() {
  const [req, setReq] = useState<SweepRequest>(DEFAULT_REQUEST);
  const [data, setData] = useState<SweepResponse | null>(null);
  const [inspectionData, setInspectionData] = useState<SweepResponse | null>(null);
  const [inspect, setInspect] = useState<ParamResult | null>(null);
  const [running, setRunning] = useState(false);
  const [researchDirty, setResearchDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * An interval the failed request could succeed at, offered as one click.
   *
   * Set only from the 422 short-window response, which is the one failure a
   * user causes by changing a dropdown: free equity tiers hold years of daily
   * history and days of intraday, so MSFT · 4h dies at 6 bars while MSFT · 1d
   * returns 400. The banner offering "Switch to 1d" is the difference between
   * a data limit the reader can step around and what reads as a broken app.
   */
  const [errorFix, setErrorFix] = useState<string | null>(null);
  const [view, setView] = useState<WorkspaceView>("overview");
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
  const [researchSection, setResearchSection] = useState<ResearchSection>("summary");
  const [showMcBands, setShowMcBands] = useState(true);
  const [executionSection, setExecutionSection] = useState<ExecutionSection>("trade");
  const [dataSection, setDataSection] = useState<DataSection>("overview");
  const [reliabilitySection, setReliabilitySection] = useState<ReliabilitySection>("overview");
  const [developerSection, setDeveloperSection] = useState<DeveloperSection>("overview");
  // Risk and Portfolio kept these internally, which made them the only two
  // steppers in the workspace that a link could not address: `#risk/model`
  // opened the tab on step 1. Lifted here so they route exactly like the other
  // five — pushed on change, and restored by `readLocation` on back/forward.
  const [riskSection, setRiskSection] = useState<RiskSection>("limits");
  const [portfolioSection, setPortfolioSection] = useState<PortfolioSection>("overview");
  const [dataWorkItems, setDataWorkItems] = useState<DataWorkItem[]>(createInitialDataWorkItems);
  const [developerWorkItems, setDeveloperWorkItems] = useState<DeveloperWorkItem[]>(createInitialDeveloperWorkItems);
  const [experiments, setExperiments] = useState<ExperimentRecord[]>([]);
  const activeRun = useRef<AbortController | null>(null);
  const runSeq = useRef(0);
  const researchContentRef = useRef<HTMLDivElement | null>(null);
  // Auto-run state. `autoRun` is the user's switch; `autoSuspended` is the
  // reason we turned it off for them, shown once and cleared when they turn it
  // back on. Hydrated from localStorage in an effect, never during render.
  const [autoRun, setAutoRun] = useState(true);
  const [autoSuspended, setAutoSuspended] = useState<string | null>(null);
  const [commandBarOpen, setCommandBarOpen] = useState(false);
  const [resultAnnouncement, setResultAnnouncement] = useState<{
    key: string;
    text: string;
  } | null>(null);
  // The request the newest run was started with. `sameRequest` against this is
  // what makes the idle fallback, the `change` commit and ⌘Enter idempotent
  // instead of three requests for one edit.
  const lastRunRequest = useRef<SweepRequest | null>(null);

  // One book and one health snapshot, shared by the tabs that read them. Both
  // hooks own their polling, so a tab is a rendering decision rather than a
  // second source of truth.
  const book = useBook();
  const systems = useSystemHealth(req.symbol);
  const selectedSleeveAttribution = book.book?.attribution.by_strategy.find(
    (row) => row.strategy === executionStrategy,
  ) ?? null;
  const selectedSleeveDetail = selectedSleeveAttribution
    ? `${selectedSleeveAttribution.filled} accepted · ${selectedSleeveAttribution.orders} orders`
    : "no audited orders yet";
  const refreshBookAfterOrder = useCallback(() => {
    void book.refresh(true);
  }, [book.refresh]);
  const navigate = useCallback((
    next: WorkspaceView,
    replace = false,
    /** A nested section applied atomically with the tab switch (⌘K commands). */
    detail?: { apply: () => void; hash: string },
  ) => {
    const apply = () => {
      setView(next);
      if (next === "data") setDataSection("overview");
      if (next === "reliability") setReliabilitySection("overview");
      detail?.apply();
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.hash = detail?.hash ?? next;
        window.history[replace ? "replaceState" : "pushState"]({}, "", url);
      }
    };
    if (typeof document === "undefined") {
      apply();
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduced && "startViewTransition" in document) {
      // Progressive, Chromium — the same posture rise-in already takes. The
      // sticky header carries view-transition-name: workspace-header, so the
      // swap reads as content changing under a stable frame. `is-vt`
      // suppresses panel-in for the swap (the cross-fade replaces it), and
      // the scroll reset moves INSIDE the callback as `auto` so it cannot
      // race the snapshot.
      document.documentElement.classList.add("is-vt");
      const transition = document.startViewTransition(() => {
        flushSync(apply);
        window.scrollTo({ top: 0, behavior: "auto" });
      });
      transition.finished.finally(() => document.documentElement.classList.remove("is-vt"));
    } else {
      apply();
      // Tabs are a lateral move between desk surfaces, not a continuation of
      // the one being left. Landing halfway down the new tab — which is what
      // happens when the scroll position carries over from a long surface like
      // the blotter — hides the page heading and the section rail, so the tab
      // reads as broken until you scroll up. Reset to the top of the workspace.
      window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
    }
  }, []);

  useEffect(() => {
    const readLocation = () => {
      const [workspace, nestedSection] = window.location.hash.slice(1).split("/");
      const hashView = workspace as WorkspaceView;
      if (VIEWS.includes(hashView)) {
        setView(hashView);
        if (hashView === "data") {
          const requested = nestedSection as DataSection;
          setDataSection(DATA_SECTION_IDS.includes(requested) ? requested : "overview");
        }
        if (hashView === "reliability") {
          const requested = nestedSection as ReliabilitySection;
          setReliabilitySection(RELIABILITY_SECTION_IDS.includes(requested) ? requested : "overview");
        }
        // Research, Execution and Developer address their sections the same
        // way. Every second-level rail in the workspace is now a real location:
        // a link into "walk-forward evidence" survives being sent to someone,
        // and Back steps through sections instead of leaving the tab entirely.
        if (hashView === "research") {
          const requested = nestedSection as ResearchSection;
          setResearchSection(RESEARCH_SECTION_IDS.includes(requested) ? requested : "summary");
        }
        if (hashView === "live") {
          const requested = nestedSection as ExecutionSection;
          setExecutionSection(EXECUTION_SECTION_IDS.includes(requested) ? requested : "trade");
        }
        if (hashView === "developer") {
          const requested = nestedSection as DeveloperSection;
          setDeveloperSection(DEVELOPER_SECTION_IDS.includes(requested) ? requested : "overview");
        }
        if (hashView === "risk") {
          const requested = nestedSection as RiskSection;
          setRiskSection(RISK_SECTION_IDS.includes(requested) ? requested : "limits");
        }
        if (hashView === "portfolio") {
          const requested = nestedSection as PortfolioSection;
          setPortfolioSection(PORTFOLIO_SECTION_IDS.includes(requested) ? requested : "overview");
        }
      } else if (LEGACY_VIEWS[workspace]) {
        setView(LEGACY_VIEWS[workspace]);
      }
    };
    readLocation();
    window.addEventListener("popstate", readLocation);
    window.addEventListener("hashchange", readLocation);
    return () => {
      window.removeEventListener("popstate", readLocation);
      window.removeEventListener("hashchange", readLocation);
    };
  }, []);

  /** Records a second-level section in the URL without leaving the workspace. */
  const pushSection = useCallback((workspace: WorkspaceView, next: string) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.hash = `${workspace}/${next}`;
    window.history.pushState({}, "", url);
  }, []);

  // Each evidence section should open at its own beginning. The desktop
  // workbench deliberately gives this shared pane the scroll, so without this
  // reset Summary's scrollTop would carry into Parameters or Attribution.
  useEffect(() => {
    if (researchContentRef.current) researchContentRef.current.scrollTop = 0;
  }, [researchSection]);

  const changeResearchSection = useCallback((next: ResearchSection) => {
    setResearchSection(next);
    pushSection("research", next);
  }, [pushSection]);

  const changeExecutionSection = useCallback((next: ExecutionSection) => {
    setExecutionSection(next);
    pushSection("live", next);
  }, [pushSection]);

  const changeDeveloperSection = useCallback((next: DeveloperSection) => {
    setDeveloperSection(next);
    pushSection("developer", next);
  }, [pushSection]);

  const changeRiskSection = useCallback((next: RiskSection) => {
    setRiskSection(next);
    pushSection("risk", next);
  }, [pushSection]);

  const changePortfolioSection = useCallback((next: PortfolioSection) => {
    setPortfolioSection(next);
    pushSection("portfolio", next);
  }, [pushSection]);

  const changeDataSection = useCallback((next: DataSection) => {
    setDataSection(next);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.hash = `data/${next}`;
      window.history.pushState({}, "", url);
    }
  }, []);

  const changeReliabilitySection = useCallback((next: ReliabilitySection) => {
    setReliabilitySection(next);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.hash = `reliability/${next}`;
      window.history.pushState({}, "", url);
    }
  }, []);

  const openReliabilitySection = useCallback((next: ReliabilitySection, targetId?: string) => {
    setView("reliability");
    setReliabilitySection(next);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.hash = `reliability/${next}`;
      window.history.pushState({}, "", url);
      if (targetId) {
        window.requestAnimationFrame(() => document.getElementById(targetId)?.focus());
      }
    }
  }, []);

  const run = useCallback(
    async (
      override?: Partial<SweepRequest>,
      preserveInspect = false,
      /**
       * Whether this run belongs in the experiment trail.
       *
       * Auto-runs pass `false`. `addExperiment` deduplicates by `sameRequest`,
       * so a *re-run* replaces its predecessor — but every auto-run carries
       * DIFFERENT parameters and would therefore be a new record. Dragging one
       * slider across ten values would write ten rows into the panel whose
       * entire purpose is an honest count of how many hypotheses were tried.
       * The trail is populated by an explicit Pin, or by promotion.
       */
      record = true,
    ) => {
      activeRun.current?.abort();
      const controller = new AbortController();
      activeRun.current = controller;
      const sequence = ++runSeq.current;
      const body = { ...req, ...override };
      lastRunRequest.current = body;

      setRunning(true);
      setError(null);
      setErrorFix(null);
      if (!preserveInspect) {
        setInspect(null);
        setInspectionData(null);
      }

      const startedAt = Date.now();
      try {
        const response = await fetch("/api/backtest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const json = await response.json();
        if (!response.ok) {
          // A 422 short-window response names the interval that would work;
          // remember it so the error banner can offer the fix as an action.
          if (sequence === runSeq.current) {
            setErrorFix(typeof json.suggestedInterval === "string" ? json.suggestedInterval : null);
          }
          throw new Error(json.error ?? `HTTP ${response.status}`);
        }
        if (sequence !== runSeq.current) return;
        const completed = json as SweepResponse;
        if (preserveInspect) {
          setInspectionData(completed);
        } else {
          setData(completed);
          // The dataset hash prevents render noise from masquerading as a new
          // result; the accepted-run sequence distinguishes two real sweeps
          // over the same bars. Replacing the keyed span also guarantees a DOM
          // mutation when two sweeps happen to produce the same sentence.
          setResultAnnouncement({
            key: `${completed.dataHash}:${sequence}`,
            text: `Sweep complete: ${completed.verdict.level.toUpperCase()} — DSR ${fmt(completed.deflatedSharpeRatio, 2)}, ${completed.combosTested} combinations`,
          });
        }
        setResearchDirty(false);
        // Measured end to end, not from the engine's own duration: what makes
        // auto-run unpleasant is the wait the user experiences, which includes
        // the request. A grid this slow stops driving itself.
        if (Date.now() - startedAt > AUTO_RUN_BUDGET_MS && !record) {
          setAutoRun(false);
          setAutoSuspended(
            "That sweep took over 1.5s, so Auto is off. Narrow the grid or run it by hand.",
          );
        }
        // Drill-downs are not hypotheses either. `inspectCombo` re-runs the
        // sweep pinned to one cell to isolate it; recording that would inflate
        // the same count.
        if (record && !preserveInspect) {
          setExperiments((current) => addExperiment(current, json as SweepResponse, Date.now()));
        }
      } catch (runError) {
        if ((runError as Error).name !== "AbortError" && sequence === runSeq.current) {
          setError((runError as Error).message);
          // A failed run leaves the result belonging to the old context with no
          // sweep on its way, which is the hard-stale case — the veil must go
          // back to asking rather than claiming to be recomputing.
          lastRunRequest.current = null;
        }
      } finally {
        if (sequence === runSeq.current) setRunning(false);
      }
    },
    [req],
  );

  /**
   * The auto-run entry point: a value settled, so run unless something says not to.
   *
   * Skipping a request identical to the one already in flight is what keeps the
   * three commit paths (native `change`, the idle fallback, ⌘Enter) from
   * becoming three requests for one edit.
   */
  const commitRequest = useCallback(() => {
    if (!autoRun) return;
    // A drill-down is a deliberate isolation of one parameter pair, run with
    // `preserveInspect`. An auto-run would replace it with the full sweep and
    // silently undo the thing the user just asked for.
    if (inspect) return;
    if (lastRunRequest.current && sameRequest(lastRunRequest.current, req)) return;
    void run(undefined, false, false);
  }, [autoRun, inspect, req, run]);

  useEffect(() => {
    void run();
    return () => activeRun.current?.abort();
    // The baseline. Every later run comes from a settled control, the idle
    // fallback or an explicit action — never from this effect, which would
    // re-fire on each `run` identity change and fan out network work mid-drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hydrated in an effect rather than in the initial state. `page.tsx` is a
  // client component but is still server-rendered, so reading localStorage
  // during render throws on the server and desynchronises the first paint.
  useEffect(() => {
    setExperiments(loadExperiments());
    try {
      if (window.localStorage.getItem(AUTO_RUN_KEY) === "0") setAutoRun(false);
    } catch {
      // Private browsing or a blocked origin. The default stands.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(AUTO_RUN_KEY, autoRun ? "1" : "0");
    } catch {
      // Preference is a convenience; failing to persist it must not break the run.
    }
  }, [autoRun]);

  /**
   * The idle fallback described at `IDLE_COMMIT_MS`.
   *
   * This is NOT the primary mechanism — the native `change` listener in
   * `Controls` is. It only catches a field left mid-edit with no commit event
   * coming. `commitRequest` short-circuits on `sameRequest`, so on every path
   * where `change` already fired this timer resolves to nothing.
   */
  useEffect(() => {
    if (!autoRun || inspect) return;
    const timer = window.setTimeout(commitRequest, IDLE_COMMIT_MS);
    return () => window.clearTimeout(timer);
  }, [req, autoRun, inspect, commitRequest]);

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

  /** ⌘/Ctrl+Enter runs the sweep from anywhere, and always records it. */
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== "Enter") return;
      if (view !== "research") return;
      event.preventDefault();
      void run();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [run, view]);

  const cloneExperiment = useCallback((request: SweepRequest) => {
    setReq(request);
    setResearchDirty(true);
    setInspect(null);
    setInspectionData(null);
  }, []);

  const dropExperiment = useCallback((id: string) => {
    setExperiments((current) => removeExperiment(current, id));
  }, []);

  const updateRequest = useCallback((next: SweepRequest) => {
    setReq(next);
    setResearchDirty(true);
    setInspect(null);
    setInspectionData(null);
  }, []);

  /**
   * Switching strategy from the doc card's "compare against" links.
   *
   * Shares `updateRequest`'s bookkeeping rather than calling `setReq` directly:
   * a changed strategy invalidates the displayed result exactly as a changed
   * symbol does, and a path that forgot `setResearchDirty` would leave the old
   * sweep on screen under the new strategy's name.
   */
  const updateStrategy = useCallback((strategy: SweepRequest["strategy"]) => {
    setReq((current) => ({ ...current, strategy }));
    setResearchDirty(true);
    setInspect(null);
    setInspectionData(null);
  }, []);

  const updateSymbol = useCallback((symbol: string) => {
    setReq((current) => ({ ...current, symbol }));
    setResearchDirty(true);
    setInspect(null);
    setInspectionData(null);
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
  }, []);

  const inspectCombo = useCallback(
    (result: ParamResult) => {
      setInspect(result);
      void run(
        {
          fastMin: result.fast,
          fastMax: result.fast + 1,
          fastStep: 1,
          slowMin: result.slow,
          slowMax: result.slow + 1,
          slowStep: 1,
          walkForward: false,
        },
        true,
      );
    },
    [run],
  );

  /** Records the displayed result as a hypothesis worth keeping. */
  const pinRun = useCallback(() => {
    if (!data) return;
    setExperiments((current) => addExperiment(current, data, Date.now()));
  }, [data]);

  const activeResult = researchDirty ? null : data;
  const displayedResult = inspectionData ?? data;
  // Drives the region-level gates: stale evidence stays visible under a veil,
  // never silently presented as current.
  const researchStale = researchDirty && Boolean(data);
  /**
   * Whether a sweep for the current context is genuinely on its way. Only then
   * may the veil describe itself as recomputing — with Auto off, or after a
   * failed run, nothing is coming and it has to say so and offer the rerun.
   */
  const sweepIncoming = autoRun && !inspect && !error;
  const currentPinned = useMemo(
    () => data !== null && experiments.some((record) => sameRequest(record.request, data.request)),
    [data, experiments],
  );
  const copyLinkToView = useCallback(() => {
    const sectionByView: Partial<Record<WorkspaceView, string>> = {
      portfolio: portfolioSection,
      risk: riskSection,
      research: researchSection,
      live: executionSection,
      data: dataSection,
      reliability: reliabilitySection,
      developer: developerSection,
    };
    const url = new URL(window.location.href);
    const section = sectionByView[view];
    url.hash = section ? `${view}/${section}` : view;
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(url.toString()).catch(() => {
        // Clipboard access can be denied by browser policy. The command must
        // not turn that environmental refusal into an unhandled rejection.
      });
    }
  }, [
    dataSection,
    developerSection,
    executionSection,
    portfolioSection,
    reliabilitySection,
    researchSection,
    riskSection,
    view,
  ]);
  /** For the picker's "— run" marks: same projection the codex renders. */
  const triedStrategies = useMemo(
    () => new Set(strategyProgress(experiments).keys()),
    [experiments],
  );

  /**
   * Everything ⌘K can reach, built where the lists already live. The palette
   * holds no routing knowledge of its own: all 8 tabs, every rail section,
   * all 46 strategies, every research symbol and the kill switch flow from
   * this one memo. Labels for the five workspaces whose section objects are
   * private mirror their rails verbatim.
   */
  const commands = useMemo<Command[]>(() => {
    const list: Command[] = NAV_ITEMS.map((item, index) => ({
      id: `tab-${item.id}`,
      label: `${item.accessibleLabel ?? item.label} — ${item.role}`,
      category: "Workspace",
      hotkey: `Alt+${index + 1}`,
      action: () => navigate(item.id),
    }));

    const section = (
      view: WorkspaceView,
      tab: string,
      id: string,
      label: string,
      apply: () => void,
    ) => {
      list.push({
        id: `sec-${view}-${id}`,
        label: `${tab} → ${label}`,
        category: "Section",
        action: () => navigate(view, false, { apply, hash: `${view}/${id}` }),
      });
    };
    for (const s of RESEARCH_SECTIONS) {
      section("research", "Research", s.id, `${s.label} — ${s.description}`, () => setResearchSection(s.id));
    }
    for (const s of EXECUTION_SECTIONS) {
      section("live", "Execution", s.id, `${s.label} — ${s.description}`, () => setExecutionSection(s.id));
    }
    const PORTFOLIO_LABELS = { overview: "Overview — Book snapshot & equity", positions: "Positions — Holdings & exposure", allocation: "Allocation — Targets & rebalancing", performance: "Performance — Attribution & costs" } as const;
    for (const id of PORTFOLIO_SECTION_IDS) {
      section("portfolio", "Portfolio", id, PORTFOLIO_LABELS[id], () => setPortfolioSection(id));
    }
    const RISK_LABELS = { limits: "Limits — Headroom & concentration", model: "VaR & model — Loss estimates & drivers", scenarios: "Stress tests — Forward shock damage", controls: "Controls — Halt & flatten handoffs" } as const;
    for (const id of RISK_SECTION_IDS) {
      section("risk", "Risk", id, RISK_LABELS[id], () => setRiskSection(id));
    }
    const DATA_LABELS = { overview: "Overview & Trust", quality: "Quality & Incidents", lineage: "Lineage & Payloads", providers: "Providers & Capacity", queue: "Work Queue — mocked, session-only" } as const;
    for (const id of DATA_SECTION_IDS) {
      section("data", "Data", id, DATA_LABELS[id], () => setDataSection(id));
    }
    const RELIABILITY_LABELS = { overview: "Telemetry & SLIs", services: "Services & Circuits", events: "Logs & Traces", controls: "Remediation" } as const;
    for (const id of RELIABILITY_SECTION_IDS) {
      section("reliability", "Reliability", id, RELIABILITY_LABELS[id], () => setReliabilitySection(id));
    }
    const DEVELOPER_LABELS = { overview: "Overview — Topology & readiness", quality: "CI / CD — Pipelines & test gates", apis: "API & Schema — Contract drift", codebase: "Code & Diffs — Repository paths", work: "Task Queue — Engineering work" } as const;
    for (const id of DEVELOPER_SECTION_IDS) {
      section("developer", "Developer", id, DEVELOPER_LABELS[id], () => setDeveloperSection(id));
    }

    for (const strategy of Object.keys(STRATEGY_LABELS) as Strategy[]) {
      list.push({
        id: `model-${strategy}`,
        label: `Model: ${STRATEGY_LABELS[strategy]} — ${STRATEGY_FAMILY[strategy]}`,
        category: "Model",
        action: () => {
          updateStrategy(strategy);
          navigate("research", false, { apply: () => setResearchSection("summary"), hash: "research/summary" });
        },
      });
    }
    for (const s of RESEARCH_SYMBOLS) {
      list.push({
        id: `sym-${s.symbol}`,
        label: `${s.symbol} — ${s.name} · ${s.sector}`,
        category: "Symbol",
        action: () => { updateSymbol(s.symbol); navigate("live"); },
      });
    }
    list.push({
      id: "act-kill",
      label: "Kill switch — halt and flatten",
      category: "Risk control",
      action: () => navigate("risk", false, { apply: () => setRiskSection("controls"), hash: "risk/controls" }),
    });
    // Navigation stays the empty-query index. Unused verbs sit after it; once
    // used, CommandBar's existing recents projection promotes them above it.
    list.push(
      {
        id: "action-run-sweep",
        label: "Run sweep",
        category: "Action",
        hotkey: "⌘↵",
        action: () => {
          if (view !== "research" || researchSection !== "summary") {
            navigate("research", false, {
              apply: () => setResearchSection("summary"),
              hash: "research/summary",
            });
          }
          void run();
        },
      },
      {
        id: "action-pin-run",
        label: running
          ? "Pin run — sweep in progress"
          : currentPinned
            ? "Pin run — already pinned"
            : data
              ? "Pin run"
              : "Pin run — no completed result",
        category: "Action",
        action: () => {
          if (data && !currentPinned && !running) pinRun();
        },
      },
      {
        id: "action-toggle-mc-band",
        label: `${showMcBands ? "Hide" : "Show"} Monte Carlo band`,
        category: "Action",
        action: () => setShowMcBands((visible) => !visible),
      },
      {
        id: "action-toggle-theme",
        label: "Toggle theme",
        category: "Action",
        action: toggleDocumentThemeMode,
      },
      {
        id: "action-copy-link",
        label: "Copy link to this view",
        category: "Action",
        action: copyLinkToView,
      },
    );
    return list;
  }, [
    copyLinkToView,
    currentPinned,
    data,
    navigate,
    pinRun,
    researchSection,
    run,
    running,
    showMcBands,
    updateStrategy,
    updateSymbol,
    view,
  ]);
  const shown = displayedResult?.best;
  const tiles = useMemo(() => {
    if (!displayedResult || !shown) return null;
    // A cost assumption must never be invisible: when anything beyond flat
    // bps was modelled, the tile says which frictions were charged.
    const costs = displayedResult.costs;
    const frictionNote = costs && !costs.flatOnly
      ? [
          costs.impactBps > 0 ? `+${fmt(costs.impactBps, 1)} bps impact` : null,
          costs.fundingBpsPer8h !== 0 ? `funding ${fmt(costs.fundingBpsPer8h, 1)} bps/8h` : null,
          costs.borrowBpsAnnual > 0 ? `borrow ${fmt(costs.borrowBpsAnnual, 0)} bps/yr` : null,
        ].filter(Boolean).join(" · ")
      : null;
    return (
      <div className="tiles research-tiles">
        <StatTile
          label="Annualised Sharpe"
          value={fmt(shown.sharpe, 2)}
          note={`buy & hold ${fmt(displayedResult.benchmark.sharpe, 2)}`}
          tone={shown.sharpe > displayedResult.benchmark.sharpe ? "pos" : "muted"}
          explain={{
            definition: "Excess return per unit of volatility, scaled to a year.",
            formula: "√periods · mean(r) ÷ stdev(r)",
            plainEnglish:
              "How much return the strategy earned for the amount it bounced around. "
              + "Compare it to buy-and-hold below — beating the market matters less than "
              + "beating it per unit of risk taken.",
          }}
        />
        <StatTile
          label="Total return"
          value={signedPct(shown.totalReturn)}
          note={`buy & hold ${signedPct(displayedResult.benchmark.totalReturn)}`}
          tone={shown.totalReturn >= 0 ? "pos" : "neg"}
        />
        <StatTile
          label="Max drawdown"
          value={pct(shown.maxDrawdown)}
          note={`calmar ${fmt(shown.calmar, 2)}`}
          tone="neg"
          explain={{
            definition: "The deepest peak-to-trough fall in equity over the run.",
            formula: "min(equity ÷ running-max(equity) − 1)",
            plainEnglish:
              "The worst losing streak you would have had to sit through. This is the number "
              + "that decides whether a strategy is actually tradable — a great Sharpe with a "
              + "60% drawdown gets turned off by a human long before it recovers.",
          }}
        />
        <StatTile label="Trades" value={String(shown.trades)} note={`win rate ${pct(shown.winRate, 0)}`} />
        <StatTile
          label="Time in market"
          value={pct(shown.exposure, 0)}
          note={`turnover ${fmt(shown.turnover, 1)}×`}
          explain={{
            definition: "Share of bars holding a position, and how often the book turned over.",
            plainEnglish:
              "Low exposure with a high Sharpe means the edge is concentrated in a few periods; "
              + "high turnover means costs matter more than the headline return suggests.",
          }}
        />
        <StatTile
          label="Costs paid"
          value={usd(shown.feesPaid)}
          note={frictionNote ? `on a $100k book · ${frictionNote}` : "on a $100k book"}
        />
      </div>
    );
  }, [displayedResult, shown]);

  return (
    <>
      <a className="skip-link" href="#workspace-content">Skip to workspace content</a>
      <WorkspaceHeader
        view={view}
        onViewChange={navigate}
        onOpenProviderHealth={() => openReliabilitySection("services", "reliability-provider-health")}
        onOpenTailLatency={() => openReliabilitySection("services", "reliability-latency-guide")}
        latency={systems.health?.summary.latency ?? null}
        degraded={systems.degraded}
        providersReady={systems.health?.summary.ready ?? null}
        providersTotal={systems.health?.summary.total ?? null}
        healthUnreachable={Boolean(systems.healthError)}
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
          onExecuted: () => {
            void book.refresh(true);
            void systems.refresh(true);
          },
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

      <main id="workspace-content" className="workspace-shell" tabIndex={-1}>
        {view === "overview" && (
          <section id="panel-overview" role="tabpanel" aria-labelledby="tab-overview" className="view-panel">
            <WorkspaceOverview
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
              onRun={() => void run()}
            />
            <NextStepFooter currentView="overview" onNavigate={navigate} />
          </section>
        )}

        {view === "portfolio" && (
          <section id="panel-portfolio" role="tabpanel" aria-labelledby="tab-portfolio" className="view-panel">
            <WorkspaceIntro
              kicker="Portfolio manager"
              title="Portfolio"
              description={<>What the book holds, how capital is spread, and which sleeve earned the P&amp;L — from one reconciled snapshot.</>}
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
            <PortfolioWorkspace
              view={book}
              workspaceSymbol={req.symbol}
              onFocusSymbol={focusPortfolioSymbol}
              onOpenRisk={() => navigate("risk")}
              operatorToken={systems.token}
              section={portfolioSection}
              onSectionChange={changePortfolioSection}
            />
            <NextStepFooter currentView="portfolio" onNavigate={navigate} />
          </section>
        )}

        {view === "risk" && (
          <section id="panel-risk" role="tabpanel" aria-labelledby="tab-risk" className="view-panel">
            <WorkspaceIntro
              kicker="Risk manager"
              title="Risk"
              description={<>Limits, validated loss estimates, forward-looking scenarios and emergency controls — separated by decision.</>}
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
                    ? book.book.risk_budget.binding_constraint[0].replaceAll("_", " ")
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
                    ? `${book.varValidation.zone} validation · ${book.varValidation.observations} obs`
                    : "historical VaR 95 · 1 day",
                  tone: book.varValidation?.zone === "red" ? "critical" : book.varValidation?.zone === "yellow" ? "warn" : "accent",
                },
                {
                  label: "Execution sleeve",
                  value: STRATEGY_LABELS[executionStrategy],
                  detail: `${selectedSleeveDetail} · aggregate book risk below`,
                  tone: selectedSleeveAttribution?.filled ? "good" : "accent",
                },
              ]}
            />
            <RiskWorkspace
              view={book}
              onOpenPortfolio={() => navigate("portfolio")}
              onOpenResearch={() => navigate("research")}
              operatorToken={systems.token}
              section={riskSection}
              onSectionChange={changeRiskSection}
            />
            <NextStepFooter currentView="risk" onNavigate={navigate} />
          </section>
        )}

        {view === "research" && (
          <section id="panel-research" role="tabpanel" aria-labelledby="tab-research" className="view-panel">
            <WorkspaceIntro
              kicker="Quant researcher"
              title="Research lab"
              description={<>Build, validate and promote {req.symbol} experiments through focused evidence sections.</>}
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

            {error && (
              <div className="banner error" role="alert">
                <span aria-hidden>✕</span>
                <div>
                  <strong>Sweep failed.</strong> {error}
                  {errorFix && (
                    // Same idiom as "Inspect data health →" one banner down:
                    // the fix is a click, not a sentence asking for one. The
                    // run is explicit — `updateRequest` alone would leave the
                    // rerun to the Auto toggle, and this button says "rerun".
                    <button
                      className="text-action"
                      onClick={() => {
                        updateRequest({ ...req, interval: errorFix });
                        void run({ interval: errorFix });
                      }}
                    >
                      Switch to {errorFix} and rerun →
                    </button>
                  )}
                </div>
              </div>
            )}
            {data?.warnings.map((warning) => (
              <div className="banner warn" key={warning} role="status">
                <span aria-hidden>!</span>
                <div>
                  {warning}
                  <button className="text-action" onClick={() => navigate("data")}>Inspect data health →</button>
                </div>
              </div>
            ))}
            {autoSuspended && (
              <div className="banner warn" role="status">
                <span aria-hidden>!</span>
                <div>{autoSuspended}</div>
                <button onClick={() => { setAutoRun(true); setAutoSuspended(null); }}>Turn Auto back on</button>
              </div>
            )}
            {/* Only when nothing is coming on its own. With Auto on, a run is
                already in flight within a few hundred milliseconds and this
                would be a call to action for something already happening. */}
            {researchDirty && data && !sweepIncoming && (
              <div className="banner context-change" role="status">
                <span aria-hidden>↻</span>
                <div>
                  <strong>Desk context changed.</strong> The result below belongs to {data.request.symbol} · {data.request.interval}.
                  Run the sweep to refresh it for {req.symbol} · {req.interval}.
                </div>
                <button onClick={() => run()} disabled={running}>{running ? "Running…" : "Refresh research"}</button>
              </div>
            )}

            <WorkspaceSubtabs
              workspaceId="research"
              label="Quant researcher sections"
              tabs={RESEARCH_SECTIONS}
              activeId={researchSection}
              onChange={changeResearchSection}
              secondary={["runs", "codex"]}
              actions={
                <>
                  <label className="rail-toggle" title="Re-run the sweep whenever a control settles">
                    <input
                      type="checkbox"
                      checked={autoRun}
                      onChange={(event) => {
                        setAutoRun(event.target.checked);
                        setAutoSuspended(null);
                      }}
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
                running={running}
                tried={triedStrategies}
              />

              <div className="research-content" ref={researchContentRef}>
                <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                  {resultAnnouncement && (
                    <span key={resultAnnouncement.key}>{resultAnnouncement.text}</span>
                  )}
                </p>
                {/* The codex is deliberately missing from this empty-state
                    map — it renders below, runless: a reference library that
                    demands a completed sweep is wrong. */}
                {!data && RESEARCH_SECTIONS.filter((section) => section.id !== "codex").map((section) => (
                  <WorkspaceSubtabPanel
                    key={section.id}
                    workspaceId="research"
                    tabId={section.id}
                    activeId={researchSection}
                  >
                    {running ? (
                      <>
                        <div className="skeleton" style={{ height: 150, marginBottom: 16 }} />
                        <div className="skeleton" style={{ height: 330 }} />
                      </>
                    ) : (
                      <div className="card capability-empty research-empty-section">
                        <span className="role-monogram" aria-hidden>R</span>
                        <div>
                          <span className="page-kicker">No completed run</span>
                          <h2>Run the experiment setup to populate {section.label.toLowerCase()}.</h2>
                          <p>The current controls stay available at left, so you can revise the hypothesis before starting.</p>
                          <button className="primary-action" onClick={() => run()}>Run research</button>
                        </div>
                      </div>
                    )}
                  </WorkspaceSubtabPanel>
                ))}

                {data && displayedResult && (
                  <>
                    <WorkspaceSubtabPanel workspaceId="research" tabId="summary" activeId={researchSection}>
                      {/* The capsule stays outside the stale gate: reading the
                          provenance of the old result is exactly what someone
                          facing the veil needs to do. */}
                      <div className="research-provenance" aria-label="Research reproducibility capsule">
                        <div className="research-provenance__lead">
                          <span className="page-kicker">Reproducibility capsule</span>
                          <strong>Evidence carries its own data identity.</strong>
                          <small>Compare the fingerprint before attributing a changed result to the model.</small>
                        </div>
                        <dl>
                          <div>
                            <dt>Instrument</dt>
                            <dd className="num">{displayedResult.request.symbol} · {displayedResult.request.interval}</dd>
                          </div>
                          <div>
                            <dt>Dataset</dt>
                            <dd><code title={displayedResult.dataHash}>{displayedResult.dataHash?.slice(0, 12) ?? "legacy run"}</code></dd>
                          </div>
                          <div>
                            <dt>Source</dt>
                            <dd>{displayedResult.dataSource}</dd>
                          </div>
                          <div>
                            <dt>Window</dt>
                            <dd className="num">{displayedResult.bars} bars</dd>
                          </div>
                          <div>
                            <dt>Search</dt>
                            <dd className="num">{displayedResult.combosTested} combos</dd>
                          </div>
                          <div>
                            <dt>Runtime</dt>
                            <dd className="num">{fmt(displayedResult.durationMs, 0)}ms</dd>
                          </div>
                          <div>
                            <dt>Build</dt>
                            <dd><code>{displayedResult.commit ?? APP_COMMIT}</code></dd>
                          </div>
                          {displayedResult.dataSource === "synthetic" && displayedResult.syntheticSeed != null && (
                            <div>
                              <dt>Seed</dt>
                              <dd className="num">{displayedResult.syntheticSeed}</dd>
                            </div>
                          )}
                        </dl>
                      </div>

                      <StaleGate
                        active={researchStale}
                        mode={sweepIncoming ? "recomputing" : "stale"}
                        running={running}
                        targetSymbol={req.symbol}
                        targetInterval={req.interval}
                        onRerun={() => run()}
                      >
                        <Verdict data={displayedResult} />

                        {tiles}

                        <div className="compact-grid-2col">
                          <div className="card">
                            <div className="chart-heading">
                              <h2>Performance</h2>
                              <label className="chart-toggle">
                                <input
                                  type="checkbox"
                                  checked={showMcBands}
                                  disabled={!displayedResult.monteCarlo}
                                  onChange={(e) => setShowMcBands(e.target.checked)}
                                />
                                Monte Carlo band
                              </label>
                            </div>
                            <p className="sub">
                              {displayedResult.request.symbol} · {displayedResult.request.interval} · {STRATEGY_LABELS[displayedResult.request.strategy]} {displayedResult.best.fast}/{displayedResult.best.slow}.
                            </p>
                            <EquityChart
                              series={displayedResult.series}
                              bands={displayedResult.monteCarlo ?? null}
                              showBands={showMcBands}
                            />
                          </div>

                          <div className="card">
                            <h2>Signal behavior</h2>
                            <p className="sub">Shaded bands are held positions. Signals form on one bar and execute on the next.</p>
                            <PriceChart
                              series={displayedResult.series}
                              strategy={displayedResult.request.strategy}
                              fast={displayedResult.best.fast}
                              slow={displayedResult.best.slow}
                              symbol={displayedResult.request.symbol}
                            />
                          </div>
                        </div>

                      </StaleGate>
                    </WorkspaceSubtabPanel>

                    <WorkspaceSubtabPanel workspaceId="research" tabId="parameters" activeId={researchSection}>
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

                    <WorkspaceSubtabPanel workspaceId="research" tabId="walkforward" activeId={researchSection}>
                      <StaleGate
                        active={researchStale}
                        mode={sweepIncoming ? "recomputing" : "stale"}
                        running={running}
                        targetSymbol={req.symbol}
                        targetInterval={req.interval}
                        onRerun={() => run()}
                      >
                        <WalkForwardTimeline report={data.walkForwardReport} />
                        <div className="card">
                          <h2>Walk-forward validation</h2>
                          <p className="sub">Choose parameters on one window, then trade the next window blind.</p>
                          <WalkForwardTable data={data} />
                        </div>
                      </StaleGate>
                    </WorkspaceSubtabPanel>

                    <WorkspaceSubtabPanel workspaceId="research" tabId="attribution" activeId={researchSection}>
                      <StaleGate
                        active={researchStale}
                        mode={sweepIncoming ? "recomputing" : "stale"}
                        running={running}
                        targetSymbol={req.symbol}
                        targetInterval={req.interval}
                        onRerun={() => run()}
                      >
                        <div className="compact-grid-2col">
                          <FactorPanel report={data.factors} />
                          <RegimePanel regimes={data.regimes} />
                        </div>
                        {/* Next to the factor decomposition because they are
                            the same question asked two ways: what explains
                            these returns. FactorPanel builds its factors from
                            this symbol's own series; this one uses another
                            instrument entirely. */}
                        <BenchmarkPanel
                          comparison={data.benchmarkComparison}
                          requested={data.request.benchmarkSymbol}
                        />
                        <TearSheet
                          tail={data.tail}
                          interval={data.request.interval}
                          turnoverPerYear={data.tail.annualisedTurnover}
                        />
                        {/* The execution lineage is supporting evidence, not a
                            second summary. Keeping it with attribution shortens
                            the decision-first landing section substantially. */}
                        <SignalDAGViewer />
                      </StaleGate>
                      {/*
                        Outside the StaleGate on purpose. The corpus answers
                        "has this desk seen anything like this before", which is
                        a question about history — it does not go stale when the
                        current sweep's parameters change, and veiling it would
                        imply the past results had.
                      */}
                      <ResearchCorpus />
                    </WorkspaceSubtabPanel>

                    <WorkspaceSubtabPanel workspaceId="research" tabId="decision" activeId={researchSection}>
                      <StaleGate
                        active={researchStale}
                        mode={sweepIncoming ? "recomputing" : "stale"}
                        running={running}
                        targetSymbol={req.symbol}
                        targetInterval={req.interval}
                        onRerun={() => run()}
                      >
                        {/* Above the gate, not beside it. The score ranks and
                            the gate vetoes; side by side they read as two
                            rival verdicts on the same run. */}
                        <QualityScorePanel data={data} />
                        <div className="compact-grid-2col">
                          <PromotionPanel
                            gate={data.promotion}
                            symbol={data.request.symbol}
                            fast={data.best.fast}
                            slow={data.best.slow}
                            dataHash={data.dataHash ?? null}
                            strategyLabel={STRATEGY_LABELS[data.request.strategy]}
                            slippageBps={data.request.slippageBps}
                            blocked={researchDirty || running || Boolean(inspect)}
                            blockedReason={researchDirty
                              ? "Refresh this candidate for the current desk context before promotion."
                              : inspect
                                ? "Return to the full parameter sweep before promotion."
                                : "Wait for the active research run to finish."}
                            onHandOff={() => {
                              setExecutionStrategy(data.request.strategy);
                              navigate("live");
                            }}
                          />
                          <SizingPanel
                            best={data.best}
                            gate={data.promotion}
                            equity={REFERENCE_EQUITY}
                          />
                        </div>
                        <div className="workflow-handoff research-data-handoff">
                          <div>
                            <span className="page-kicker">Evidence lineage</span>
                            <strong>Verify the inputs before approving the candidate.</strong>
                            <small>Open the data workspace with {data.request.symbol} still in context.</small>
                          </div>
                          <button onClick={() => navigate("data")}>Trace market data</button>
                        </div>
                      </StaleGate>
                    </WorkspaceSubtabPanel>

                    <WorkspaceSubtabPanel workspaceId="research" tabId="runs" activeId={researchSection}>
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
                <WorkspaceSubtabPanel workspaceId="research" tabId="codex" activeId={researchSection}>
                  <StrategyDocCard
                    strategy={req.strategy}
                    onSelect={updateStrategy}
                  />
                  <StrategyCodex
                    records={experiments}
                    activeStrategy={req.strategy}
                    onSelect={(strategy) => {
                      updateStrategy(strategy);
                      changeResearchSection("summary");
                    }}
                  />
                </WorkspaceSubtabPanel>
              </div>
            </div>
            <NextStepFooter currentView="research" onNavigate={navigate} />
          </section>
        )}

        {view === "live" && (
          <section id="panel-live" role="tabpanel" aria-labelledby="tab-live" className="view-panel">
            <WorkspaceIntro
              kicker="Quant trader"
              title="Execution"
              description={<>Trade {req.symbol}, inspect liquidity, compare routing cost and review fills without one endless page.</>}
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
              onOpenResearch={() => navigate("research")}
              onOpenData={() => navigate("data")}
              section={executionSection}
              onPriceSelect={stageLimitFromLadder}
            >
              <ExecutionCockpit
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
                onOrderSettled={refreshBookAfterOrder}
                onOpenResearch={() => navigate("research")}
              />
            </LiveMarket>
            <NextStepFooter currentView="live" onNavigate={navigate} />
          </section>
        )}

        {view === "data" && (
          <section id="panel-data" role="tabpanel" aria-labelledby="tab-data" className="view-panel">
            <DataConsole
              view={systems}
              workspaceSymbol={req.symbol}
              workspaceInterval={req.interval}
              onWorkspaceSymbolChange={updateSymbol}
              onOpenReliability={() => navigate("reliability")}
              section={dataSection}
              onSectionChange={changeDataSection}
              workItems={dataWorkItems}
              onWorkItemsChange={setDataWorkItems}
            />
            <NextStepFooter currentView="data" onNavigate={navigate} />
          </section>
        )}

        {view === "reliability" && (
          <section id="panel-reliability" role="tabpanel" aria-labelledby="tab-reliability" className="view-panel">
            <ReliabilityConsole
              view={systems}
              workspaceSymbol={req.symbol}
              onOpenData={() => navigate("data")}
              section={reliabilitySection}
              onSectionChange={changeReliabilitySection}
            />
            <NextStepFooter currentView="reliability" onNavigate={navigate} />
          </section>
        )}

        {view === "developer" && (
          <section id="panel-developer" role="tabpanel" aria-labelledby="tab-developer" className="view-panel">
            <DeveloperConsole
              view={systems}
              workspaceSymbol={req.symbol}
              onOpenResearch={() => navigate("research")}
              onOpenLive={() => navigate("live")}
              onOpenReliability={() => navigate("reliability")}
              section={developerSection}
              onSectionChange={changeDeveloperSection}
              workItems={developerWorkItems}
              onWorkItemsChange={setDeveloperWorkItems}
            />
            <NextStepFooter currentView="developer" onNavigate={navigate} />
          </section>
        )}

        <footer className="workspace-footer">
          <span>AlphaEngine</span>
          <p>
            Educational case-study demonstration built for a developer assessment. Not a brokerage
            or investment service: no accounts, no funds, no real orders, and no credentials are
            requested from visitors. Execution is paper-only and remains gated by the risk gateway.
            Not investment advice.
          </p>
        </footer>
      </main>
    </>
  );
}
