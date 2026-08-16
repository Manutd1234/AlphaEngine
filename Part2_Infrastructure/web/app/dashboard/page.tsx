"use client";

import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";

import dynamic from "next/dynamic";

import Controls from "@/components/Controls";
import EquityChart from "@/components/EquityChart";
import ExecutionCockpit from "@/components/execution/ExecutionCockpit";
import LiveMarket from "@/components/LiveMarket";
import PortfolioWorkspace, { type PortfolioFocusDestination } from "@/components/PortfolioWorkspace";
import PriceChart from "@/components/PriceChart";
import RiskWorkspace from "@/components/RiskWorkspace";
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
import { ResultsTable } from "@/components/Tables";
import Verdict from "@/components/Verdict";
import CommandBar, { type Command } from "@/components/header/CommandBar";
import ShortcutsOverlay, { type TourStop } from "@/components/header/ShortcutsOverlay";
import WorkspaceBottomNav from "@/components/WorkspaceBottomNav";
import WorkspaceHeader, { NAV_ITEMS, type WorkspaceView } from "@/components/WorkspaceHeader";
import WorkspaceIntro from "@/components/WorkspaceIntro";
import WorkspaceOverview from "@/components/WorkspaceOverview";
import WorkspaceSubtabs, { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
import { createInitialDataWorkItems, type DataWorkItem } from "@/lib/data-work-queue";
import {
  createInitialDeveloperWorkItems,
  loadDeveloperWorkItems,
  saveDeveloperWorkItems,
  type DeveloperWorkItem,
} from "@/lib/developer-work";
import { fmt, pct, signedPct, usd } from "@/lib/format";
import { mcSeedFor } from "@/lib/montecarlo";
import type { StageId } from "@/lib/overview-state";
import { REFERENCE_EQUITY } from "@/lib/portfolio";
import {
  DATA_SECTIONS, DATA_SECTION_IDS, type DataSection,
  DEVELOPER_SECTIONS, DEVELOPER_SECTION_IDS, type DeveloperSection,
  EXECUTION_SECTIONS, EXECUTION_SECTION_IDS, type ExecutionSection,
  OVERVIEW_SECTIONS, OVERVIEW_SECTION_IDS, type OverviewSection,
  PORTFOLIO_SECTIONS, PORTFOLIO_SECTION_IDS, type PortfolioSection,
  RELIABILITY_SECTIONS, RELIABILITY_SECTION_IDS, type ReliabilitySection,
  RESEARCH_SECTIONS, RESEARCH_SECTION_IDS, type ResearchSection,
  RISK_SECTIONS, RISK_SECTION_IDS, type RiskSection,
} from "@/lib/sections";
import { useBook } from "@/lib/use-book";
import { useSystemHealth } from "@/lib/use-system-health";
import { RESEARCH_SYMBOLS } from "@/lib/research-symbols";
import seedRunJson from "@/lib/seed-run.json";
import {
  DEFAULT_REQUEST,
  ParamResult,
  STRATEGY_FAMILY,
  STRATEGY_LABELS,
  SweepRequest,
  SweepResponse,
  type Strategy,
} from "@/lib/types";

const SEED_RUN = seedRunJson as unknown as SweepResponse;
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
import { emitPrefChange } from "@/lib/pref-sync-bus";
import { WORKSPACE_LOCATION_KEY, startUserPrefsSync } from "@/lib/user-prefs";
import { APP_COMMIT } from "@/lib/version";
import type { Side } from "@/lib/venues";

const VIEWS: WorkspaceView[] = NAV_ITEMS.map((item) => item.id);

// Section definitions live in lib/sections.ts — the rails, the palette and
// the hash whitelist all read the same arrays.

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

/**
 * Narrows a section id to one workspace's rail, or null when it does not belong
 * to it.
 *
 * `readLocation` already resets an unrecognised id to the workspace default, so
 * a cross-link naming a renamed section would land somewhere nobody chose while
 * the URL claimed otherwise. Falling back to the plain tab switch instead keeps
 * the two agreeing.
 */
function railSection<T extends string>(ids: readonly T[], section: string): T | null {
  return (ids as readonly string[]).includes(section) ? (section as T) : null;
}

/**
 * The two Attribution panes.
 *
 * The split the section's own four cards already implied: Factors and Benchmark
 * are the same question asked two ways — what explains these returns — while
 * Regimes and the tear sheet ask whether that explanation survives outside the
 * window it was measured in.
 */
type AttributionPane = "explain" | "robustness";
/**
 * Memoised once, at module level. The six persistent tabs stay mounted behind
 * `hidden` now, so every page-level state change would otherwise re-render all
 * of them; with memo (and the stable hook returns backing their props) a
 * hidden tab re-renders only when the data it actually shows changed.
 */
/**
 * The console workspaces load as their own chunks. They are the heaviest
 * subtrees on the page and none of them is needed for first paint, so the
 * initial bundle stops carrying them; an idle-time prefetch below warms the
 * chunks before the first click, and the loading box holds a panel-sized
 * rectangle so the one cold visit cannot shift the layout.
 */
const PanelLoading = () => (
  <div className="skeleton" style={{ height: 480 }} aria-busy="true" aria-label="Loading workspace" />
);
const DataConsole = dynamic(() => import("@/components/DataConsole"), { loading: PanelLoading });
const ReliabilityConsole = dynamic(() => import("@/components/ReliabilityConsole"), { loading: PanelLoading });
const DeveloperConsole = dynamic(() => import("@/components/DeveloperConsole"), { loading: PanelLoading });

const OverviewTab = memo(WorkspaceOverview);
const PortfolioTab = memo(PortfolioWorkspace);
const RiskTab = memo(RiskWorkspace);
const DataTab = memo(DataConsole);
const ReliabilityTab = memo(ReliabilityConsole);
const DeveloperTab = memo(DeveloperConsole);

const ATTRIBUTION_PANES: { id: AttributionPane; label: string; hint: string }[] = [
  {
    id: "explain",
    label: "Explain",
    hint: "What the returns decompose into — this symbol's own factors, and the same question asked against another instrument",
  },
  {
    id: "robustness",
    label: "Robustness",
    hint: "Whether that decomposition holds across regimes, and what the tail and the turnover cost",
  },
];

export default function Page() {
  const [req, setReq] = useState<SweepRequest>(DEFAULT_REQUEST);
  // Seeded, clearly-labelled demo run: real bars (committed parity fixture),
  // the real engine, computed ahead of time — so the first paint shows a real
  // verdict and a real OOS Sharpe instead of skeletons. Its warning banner
  // says exactly what it is, and the mount auto-sweep replaces it.
  const [data, setData] = useState<SweepResponse | null>(SEED_RUN);
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
  const [overviewSection, setOverviewSection] = useState<OverviewSection>("loop");
  const [researchSection, setResearchSection] = useState<ResearchSection>("summary");
  const [showMcBands, setShowMcBands] = useState(true);
  const [mcRunNonce, setMcRunNonce] = useState(0);
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
  // A pane inside Attribution, not a section: it is not a deep link, so it is
  // declared here with the section states purely to keep every hook above the
  // render — the rule tests/workspace-routing.test.ts enforces per component.
  // A fixed default, never a tier-derived one; both panes exist at every level.
  const [attributionPane, setAttributionPane] = useState<AttributionPane>("explain");
  const [dataWorkItems, setDataWorkItems] = useState<DataWorkItem[]>(createInitialDataWorkItems);
  const [developerWorkItems, setDeveloperWorkItems] = useState<DeveloperWorkItem[]>(createInitialDeveloperWorkItems);
  const [experiments, setExperiments] = useState<ExperimentRecord[]>([]);
  const activeRun = useRef<AbortController | null>(null);
  const runSeq = useRef(0);
  const researchContentRef = useRef<HTMLDivElement | null>(null);
  /**
   * The shell, which is the page's scroll container.
   *
   * The desk is viewport-locked, so `window.scrollTo` has nothing left to move:
   * the document is exactly one viewport tall and every tab's content scrolls
   * inside this element. A tab switch that still reset the window would appear
   * to work — no error, no warning — while leaving the new tab parked halfway
   * down wherever the last one had been read to.
   */
  const shellRef = useRef<HTMLElement | null>(null);
  // Auto-run state. `autoRun` is the user's switch; `autoSuspended` is the
  // reason we turned it off for them, shown once and cleared when they turn it
  // back on. Hydrated from localStorage in an effect, never during render.
  const [autoRun, setAutoRun] = useState(true);
  const [autoSuspended, setAutoSuspended] = useState<string | null>(null);
  const [commandBarOpen, setCommandBarOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
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
  /**
   * Live section per workspace, readable from handlers created once. A ref,
   * not state, because `navigate` must see the CURRENT section at click time
   * to write a truthful hash — its useCallback would otherwise capture the
   * mount-time values forever.
   */
  const sectionByViewRef = useRef<Record<WorkspaceView, string>>({
    overview: "loop",
    research: "summary",
    live: "trade",
    portfolio: "overview",
    risk: "limits",
    data: "overview",
    reliability: "overview",
    developer: "overview",
  });
  sectionByViewRef.current = {
    overview: overviewSection,
    research: researchSection,
    live: executionSection,
    portfolio: portfolioSection,
    risk: riskSection,
    data: dataSection,
    reliability: reliabilitySection,
    developer: developerSection,
  };

  /**
   * Which workspaces the reader has opened this session.
   *
   * A visited tab is never unmounted again — it is hidden. Unmount-per-switch
   * was most of the switch cost: thousands of DOM nodes rebuilt, every chart's
   * draw-on animation replayed, every mount-effect refetched (the skeleton
   * flash), and all in-panel state lost. `hidden` keeps DOM, state and chart
   * geometry warm, so a revisit is a display flip.
   *
   * Research and Execution stay unmount-on-leave deliberately: Execution holds
   * direct exchange WebSockets and the realtime tape, and Research is where
   * the desk's typing lives — both keep their teardown-on-leave semantics.
   */
  const visitedViews = useRef(new Set<WorkspaceView>());
  useEffect(() => {
    visitedViews.current.add(view);
  }, [view]);

  // Warm the console chunks while the main thread is idle, so the first click
  // on Data / Reliability / Developer finds its code already downloaded. A
  // prefetch is a hint, not a dependency — failures here surface nothing and
  // the tab's own loading box covers the cold case.
  useEffect(() => {
    const prefetch = () => {
      void import("@/components/DataConsole");
      void import("@/components/ReliabilityConsole");
      void import("@/components/DeveloperConsole");
    };
    if ("requestIdleCallback" in window) {
      const handle = window.requestIdleCallback(prefetch, { timeout: 4000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = setTimeout(prefetch, 1500);
    return () => clearTimeout(timer);
  }, []);

  const navigate = useCallback((
    next: WorkspaceView,
    replace = false,
    /** A nested section applied atomically with the tab switch (⌘K commands). */
    detail?: { apply: () => void; hash: string },
  ) => {
    const apply = () => {
      setView(next);
      detail?.apply();
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        // Always the FULL location. Bare `#research` while the rail shows
        // Strategies was the desync: copy-link disagreed with reload, and a
        // forced per-workspace reset (data/reliability used to snap back to
        // overview) only hid it. Panels keep state; the URL tells the truth.
        url.hash = detail?.hash ?? `${next}/${sectionByViewRef.current[next]}`;
        window.history[replace ? "replaceState" : "pushState"]({}, "", url);
      }
    };
    if (typeof document === "undefined") {
      apply();
      return;
    }
    /**
     * No view transition, and no smooth scroll — both were the stutter.
     *
     * `document.startViewTransition(() => flushSync(apply))` froze painting
     * for the snapshot while React synchronously rendered the entire incoming
     * workspace — the measured ~30-100ms input freeze, followed by a crossfade
     * that read as a flash. And the fallback's `behavior: "smooth"` scroll
     * animated AFTER the switch, which read as the tab still settling.
     *
     * `startTransition` keeps the switch interruptible — the click paints its
     * pressed state immediately and React renders the new panel concurrently.
     * The URL write stays synchronous: the location must be true the moment
     * the click happens, not when the render lands. The scroll reset is
     * instant for the same reason the switch is — a tab change is a cut, not
     * a camera move.
     */
    const url = new URL(window.location.href);
    url.hash = detail?.hash ?? `${next}/${sectionByViewRef.current[next]}`;
    window.history[replace ? "replaceState" : "pushState"]({}, "", url);
    startTransition(() => {
      setView(next);
      detail?.apply();
    });
    shellRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  useEffect(() => {
    const readLocation = () => {
      const [workspace, nestedSection] = window.location.hash.slice(1).split("/");
      const hashView = workspace as WorkspaceView;
      if (VIEWS.includes(hashView)) {
        setView(hashView);
        if (hashView === "overview") {
          const requested = nestedSection as OverviewSection;
          setOverviewSection(OVERVIEW_SECTION_IDS.includes(requested) ? requested : "loop");
        }
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
    // An empty hash is the only case a stored location may fill. A deep link is
    // an explicit request, and a shared URL that resolved differently per
    // visitor would be worse than not remembering at all.
    if (!window.location.hash.slice(1)) {
      try {
        const stored: unknown = JSON.parse(window.localStorage.getItem(WORKSPACE_LOCATION_KEY) ?? "null");
        const remembered = (stored as { view?: string } | null)?.view;
        if (remembered && VIEWS.includes(remembered as WorkspaceView)) {
          const sections = (stored as { sections?: Record<string, string> }).sections ?? {};
          const section = sections[remembered];
          window.history.replaceState({}, "", `#${remembered}${section ? `/${section}` : ""}`);
        }
      } catch {
        // A malformed or blocked entry simply leaves the default view.
      }
    }
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

  const changeOverviewSection = useCallback((next: OverviewSection) => {
    setOverviewSection(next);
    pushSection("overview", next);
  }, [pushSection]);

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

  /**
   * A cross-link that names the panel it lands on.
   *
   * `navigate` on its own writes `${next}/${sectionByViewRef.current[next]}` —
   * whichever section the reader last had open in that workspace — which is
   * right for a tab click and wrong for a contextual link. A tile headed "VaR
   * 95 · Gross headroom · Drawdown cushion" whose button says Open Risk has to
   * open the panel explaining those numbers, not wherever Risk was left. So
   * every link that knows which panel explains what it is quoting passes that
   * panel here, and only the bare tab switches go through `navigate` alone.
   *
   * The id is checked against the same rail `lib/sections` defines, so the pairs
   * cannot silently rot into hashes `readLocation` would reject; the pairs
   * themselves are pinned by tests/desk-interconnect.test.ts.
   */
  const openSection = useCallback((next: WorkspaceView, section?: string) => {
    const apply = ((): (() => void) | null => {
      if (section === undefined) return null;
      switch (next) {
        case "overview": {
          const id = railSection(OVERVIEW_SECTION_IDS, section);
          return id === null ? null : () => setOverviewSection(id);
        }
        case "research": {
          const id = railSection(RESEARCH_SECTION_IDS, section);
          return id === null ? null : () => setResearchSection(id);
        }
        case "live": {
          const id = railSection(EXECUTION_SECTION_IDS, section);
          return id === null ? null : () => setExecutionSection(id);
        }
        case "portfolio": {
          const id = railSection(PORTFOLIO_SECTION_IDS, section);
          return id === null ? null : () => setPortfolioSection(id);
        }
        case "risk": {
          const id = railSection(RISK_SECTION_IDS, section);
          return id === null ? null : () => setRiskSection(id);
        }
        case "data": {
          const id = railSection(DATA_SECTION_IDS, section);
          return id === null ? null : () => setDataSection(id);
        }
        case "reliability": {
          const id = railSection(RELIABILITY_SECTION_IDS, section);
          return id === null ? null : () => setReliabilitySection(id);
        }
        case "developer": {
          const id = railSection(DEVELOPER_SECTION_IDS, section);
          return id === null ? null : () => setDeveloperSection(id);
        }
      }
    })();
    if (!apply) {
      navigate(next);
      return;
    }
    navigate(next, false, { apply, hash: `${next}/${section}` });
  }, [navigate]);

  /**
   * Where each decision-loop stage explains the state it is showing.
   *
   * The reviewer tour has said for a while that "every pipeline stage links
   * into its tab", and until now the four stages rendered as plain text — the
   * one screen a reviewer is told to click was the one that did nothing. Each
   * lands on the section the stage's own verdict is computed from, so "3
   * providers degraded" opens the trust summary rather than wherever Data was
   * last left.
   */
  /* Stable identities for the memoised tabs: an inline arrow prop would give
     every page render a fresh function and defeat the memo above. */
  const openRiskSection = useCallback(
    (section?: RiskSection) => openSection("risk", section ?? "limits"),
    [openSection],
  );
  const openPortfolioSection = useCallback(
    (section?: PortfolioSection) => openSection("portfolio", section ?? "overview"),
    [openSection],
  );
  const openResearchSummary = useCallback(() => openSection("research", "summary"), [openSection]);
  const openLiveLiquidity = useCallback(() => openSection("live", "liquidity"), [openSection]);
  const openReliabilityOverview = useCallback(() => openSection("reliability", "overview"), [openSection]);
  const openDataOverview = useCallback(() => openSection("data", "overview"), [openSection]);

  const openLoopStage = useCallback((stage: StageId) => {
    switch (stage) {
      case "data": openSection("data", "overview"); break;
      case "research": openSection("research", "summary"); break;
      case "risk": openSection("risk", "limits"); break;
      case "execution": openSection("live", "trade"); break;
    }
  }, [openSection]);

  const openReliabilitySection = useCallback((next: ReliabilitySection, targetId?: string) => {
    // Through `navigate`, not raw setView: this jump used to skip the view
    // transition and the scroll reset every other workspace switch gets. It
    // reaches it through `openSection` so the header chips and every other
    // cross-link write their destination the same way; what stays local is the
    // focus move onto the evidence the chip named.
    openSection("reliability", next);
    if (typeof window !== "undefined" && targetId) {
      window.requestAnimationFrame(() => document.getElementById(targetId)?.focus());
    }
  }, [openSection]);

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
  const runNow = useCallback(() => void run(), [run]);

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

  useEffect(() => {
    try {
      window.localStorage.setItem(AUTO_RUN_KEY, autoRun ? "1" : "0");
    } catch {
      // Preference is a convenience; failing to persist it must not break the run.
    }
    emitPrefChange(AUTO_RUN_KEY);
  }, [autoRun]);

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
   * Remembers where this account was last looking.
   *
   * Written on every move, restored only on the next visit — and only when the
   * URL carries no hash of its own. A deep link is an explicit request for a
   * particular view and must always win; restoring over one would make shared
   * links resolve differently depending on who opened them.
   */
  useEffect(() => {
    try {
      window.localStorage.setItem(
        WORKSPACE_LOCATION_KEY,
        JSON.stringify({ view, sections: sectionByViewRef.current }),
      );
    } catch {
      // ignored
    }
    emitPrefChange(WORKSPACE_LOCATION_KEY);
  }, [view, overviewSection, researchSection, executionSection, dataSection,
    reliabilitySection, developerSection, riskSection, portfolioSection]);

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
  /** The Risk tab's terminal distribution resamples exactly what the band did. */
  const mcDriver = useMemo(() => {
    if (!displayedResult?.bestRunReturns?.length || !displayedResult.dataHash) return null;
    return {
      returns: displayedResult.bestRunReturns,
      seed: mcSeedFor(displayedResult.dataHash, displayedResult.best.fast, displayedResult.best.slow),
      label: `${STRATEGY_LABELS[displayedResult.request.strategy]} · ${displayedResult.best.fast}/${displayedResult.best.slow}`,
      interval: displayedResult.request.interval,
    };
  }, [displayedResult]);
  const currentPinned = useMemo(
    () => data !== null && experiments.some((record) => sameRequest(record.request, data.request)),
    [data, experiments],
  );
  const copyLinkToView = useCallback(() => {
    const sectionByView: Partial<Record<WorkspaceView, string>> = {
      overview: overviewSection,
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
    overviewSection,
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
   * The eight-stop reviewer tour — one stop per workspace, in decision-loop
   * order, each landing on a full `#view/section` deep link with the one
   * moment worth showing named. Rendered by the "?" overlay.
   */
  const tourStops = useMemo<TourStop[]>(() => {
    const stop = (
      where: string,
      moment: string,
      viewId: WorkspaceView,
      sectionId: string,
      apply: () => void,
    ): TourStop => ({
      where,
      moment,
      visit: () => navigate(viewId, false, { apply, hash: `${viewId}/${sectionId}` }),
    });
    return [
      stop("Overview → Decision loop", "The desk in one screen; every pipeline stage links into its tab — research reaches execution only through the risk gate.", "overview", "loop", () => setOverviewSection("loop")),
      stop("Research → Summary", "The reproducibility capsule and the PASS/MARGINAL/FAIL verdict; drag a slider and the six-veto promotion gate re-clears.", "research", "summary", () => setResearchSection("summary")),
      stop("Execution → Trade", "Fire the Fat finger $500k preset — the gate vector names the exact check that refused it, decided in ~0.2 ms.", "live", "trade", () => setExecutionSection("trade")),
      stop("Portfolio → Overview", "The same book Risk reads; the covariance card says “Measured · N aligned bars”, never an assumption.", "portfolio", "overview", () => setPortfolioSection("overview")),
      stop("Risk → Monte Carlo", "10,000 bootstrap paths against the live drawdown budget — the P95 loss verdict, in dollars.", "risk", "montecarlo", () => setRiskSection("montecarlo")),
      stop("Data → Quality & Incidents", "Simulate a provider outage and watch the incident row, failover graph and consensus react — then self-restore.", "data", "quality", () => setDataSection("quality")),
      stop("Reliability → Telemetry & SLIs", "Fleet-truth p99 and provider circuits — the latency chip in every header resolves here.", "reliability", "overview", () => setReliabilitySection("overview")),
      stop("Developer → API & Schema", "OpenAPI drift against the committed digest, and the Monte Carlo parity check you can run in this browser.", "developer", "apis", () => setDeveloperSection("apis")),
    ];
  }, [navigate]);

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
    // One pattern for all workspaces, read from lib/sections — the palette can
    // no longer drift from the rails in label or order.
    for (const s of OVERVIEW_SECTIONS) {
      section("overview", "Overview", s.id, `${s.label} — ${s.description}`, () => setOverviewSection(s.id));
    }
    for (const s of RESEARCH_SECTIONS) {
      section("research", "Research", s.id, `${s.label} — ${s.description}`, () => setResearchSection(s.id));
    }
    for (const s of EXECUTION_SECTIONS) {
      section("live", "Execution", s.id, `${s.label} — ${s.description}`, () => setExecutionSection(s.id));
    }
    for (const s of PORTFOLIO_SECTIONS) {
      section("portfolio", "Portfolio", s.id, `${s.label} — ${s.description}`, () => setPortfolioSection(s.id));
    }
    for (const s of RISK_SECTIONS) {
      section("risk", "Risk", s.id, `${s.label} — ${s.description}`, () => setRiskSection(s.id));
    }
    for (const s of DATA_SECTIONS) {
      section("data", "Data", s.id, `${s.label} — ${s.description}`, () => setDataSection(s.id));
    }
    for (const s of RELIABILITY_SECTIONS) {
      section("reliability", "Reliability", s.id, `${s.label} — ${s.description}`, () => setReliabilitySection(s.id));
    }
    for (const s of DEVELOPER_SECTIONS) {
      section("developer", "Developer", s.id, `${s.label} — ${s.description}`, () => setDeveloperSection(s.id));
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
        id: "action-run-mc-dist",
        label: "Run Monte Carlo distribution",
        category: "Action",
        action: () => {
          setMcRunNonce((nonce) => nonce + 1);
          navigate("risk", false, {
            apply: () => setRiskSection("montecarlo"),
            hash: "risk/montecarlo",
          });
        },
      },
      {
        id: "action-toggle-theme",
        // Names what it does now that Theme has three states. This verb flips
        // the palette and sets it explicitly, so from System it lands on light
        // or dark and stops following the machine — "Toggle theme" would not
        // have said that, and the setting it silently replaced is in the gear.
        label: "Switch to the light or dark palette",
        category: "Action",
        action: toggleDocumentThemeMode,
      },
      {
        id: "action-copy-link",
        label: "Copy link to this view",
        category: "Action",
        action: copyLinkToView,
      },
      {
        id: "action-shortcuts",
        label: "Shortcuts & reviewer tour — the five-minute walkthrough",
        category: "Action",
        hotkey: "?",
        action: () => setShortcutsOpen(true),
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
        decisionLatency={systems.decisionLatency}
        onOpenCommandBar={() => setCommandBarOpen(true)}
        latency={systems.health?.summary.latency ?? null}
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
          // Returns the work so the badge can time it and report the outcome:
          // the two quiet re-reads that decide the tier and the health snapshot.
          onRetry: () => Promise.all([book.refresh(true), systems.refresh(true)]).then(() => undefined),
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
              description={<>What the book holds, how capital is spread, and which sleeve earned the P&amp;L.</>}
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
              description={<>Limits, validated loss estimates, forward-looking scenarios and emergency controls.</>}
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
            {data && data.warnings.length > 0 && (
              /* One banner however many warnings the run returned. They are
                 all about the same bars — which provider answered, what was
                 coerced, whether the series was generated — and they all have
                 the same answer: Data ▸ Trust Summary. Stacking N banners
                 repeated the identical button N times at the same moment. */
              <div className="banner warn" role="status">
                <span aria-hidden>!</span>
                <div>
                  {data.warnings.map((warning) => (
                    <div key={warning}>{warning}</div>
                  ))}
                  <button className="text-action" onClick={() => openSection("data", "overview")}>Inspect data health →</button>
                </div>
              </div>
            )}
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
              /* Announcement only. Under exactly this condition the stale
                 veil's "Rerun sweep" already stands on every gated section
                 and the rail's "Run now" survives any scroll — a third
                 trigger for the same run() at the same moment was the shape
                 the Controls pass already removed once. "Run now" is named
                 so the ungated sections (runs, codex) still point somewhere. */
              <div className="banner context-change" role="status">
                <span aria-hidden>↻</span>
                <div>
                  <strong>Desk context changed.</strong> The result below belongs to {data.request.symbol} · {data.request.interval}.
                  Use Run now to refresh it for {req.symbol} · {req.interval}.
                </div>
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

                        <div className="compact-grid-2col research-chart-pair">
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
                            <h2>Signal behaviour</h2>
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
                        {/* One card, one per-fold table. A "Walk-forward
                            validation" card used to stack beneath this with a
                            second table repeating five of its columns for the
                            same folds; the timeline's table now carries the
                            train window and OOS return it alone added. */}
                        <WalkForwardTimeline report={data.walkForwardReport} />
                      </StaleGate>
                    </WorkspaceSubtabPanel>

                    <WorkspaceSubtabPanel workspaceId="research" tabId="attribution" activeId={researchSection}>
                      {/* Above the gate, not inside it: `StaleGate` marks its
                          content `inert`, so a switcher within it would take
                          the section's other half out of reach entirely rather
                          than merely showing it as stale. */}
                      <div className="seg" role="group" aria-label="Attribution view">
                        {ATTRIBUTION_PANES.map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            aria-pressed={attributionPane === option.id}
                            title={option.hint}
                            onClick={() => setAttributionPane(option.id)}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>

                      <StaleGate
                        active={researchStale}
                        mode={sweepIncoming ? "recomputing" : "stale"}
                        running={running}
                        targetSymbol={req.symbol}
                        targetInterval={req.interval}
                        onRerun={() => run()}
                      >
                        {/* Next to the factor decomposition because they are
                            the same question asked two ways: what explains
                            these returns. FactorPanel builds its factors from
                            this symbol's own series; this one uses another
                            instrument entirely. They were a screen apart under
                            one heading with the regime and tail cards wedged
                            between them; now the comparison is the pane. */}
                        {attributionPane === "explain" && (
                          <div className="compact-grid-2col">
                            <FactorPanel report={data.factors} />
                            <BenchmarkPanel
                              comparison={data.benchmarkComparison}
                              requested={data.request.benchmarkSymbol}
                            />
                          </div>
                        )}
                        {/* The other question: not what explains the returns
                            but whether that explanation survives a change of
                            regime, and what the tail and the turnover cost. */}
                        {attributionPane === "robustness" && (
                          <div className="compact-grid-2col">
                            <RegimePanel regimes={data.regimes} />
                            <TearSheet
                              tail={data.tail}
                              interval={data.request.interval}
                              turnoverPerYear={data.tail.annualisedTurnover}
                            />
                          </div>
                        )}
                      </StaleGate>
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
                    <WorkspaceSubtabPanel workspaceId="research" tabId="lineage" activeId={researchSection}>
                      {/* Real state, not a hardcoded array: the panel reports
                          what this deployment can observe, and says "not
                          measured" for the one stage that runs in the browser
                          and therefore has no server timing. */}
                      <SignalDAGViewer health={systems.health} healthError={systems.healthError} />
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
                            /* The sleeve is staged, so the reader is one step
                               from sending it: land on the ticket that carries
                               it. A bare `navigate("live")` handed a promoted
                               candidate to whichever execution section was last
                               read — the routing table or the blotter — which
                               is the one handoff on the desk where the next
                               action is unambiguous. */
                            onHandOff={() => {
                              setExecutionStrategy(data.request.strategy);
                              openSection("live", "trade");
                            }}
                          />
                          <SizingPanel
                            best={data.best}
                            gate={data.promotion}
                            equity={REFERENCE_EQUITY}
                          />
                        </div>
                      {/* The "trace market data" handoff that stood here as an
                          inline card now rides the NextStepFooter's measured
                          continuation for research/decision — one exit per
                          section, not a card stack of three navigation
                          furnishings pointing three ways at once. */}
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
            <NextStepFooter currentView="research" currentSection={researchSection} onNavigate={openSection} />
          </section>
        )}

        {view === "live" && (
          <section id="panel-live" role="tabpanel" aria-labelledby="tab-live" className="view-panel">
            <WorkspaceIntro
              kicker="Quant trader"
              title="Execution"
              description={<>Trade {req.symbol}, inspect liquidity, compare routing cost and review fills.</>}
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
                onOrderSettled={refreshBookAfterOrder}
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
              workItems={dataWorkItems}
              onWorkItemsChange={setDataWorkItems}
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
