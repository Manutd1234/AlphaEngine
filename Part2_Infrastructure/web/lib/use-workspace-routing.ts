"use client";

/**
 * Where the reader is, and every way the desk moves them.
 *
 * Lifted whole out of `app/dashboard/page.tsx`, where it was roughly 355 lines
 * of the single 2,000-line component: the eight rail states, the hash the URL
 * carries, the tab switch, the cross-link helper every panel routes through,
 * and the remembered location. Nothing about it is a render, and the page was
 * the only thing holding it together.
 *
 * The invariant it exists to keep: the URL and the rails always agree. Every
 * move writes the FULL `#view/section`, and `followLocation` — the reader in
 * `lib/workspace-hash`, which owns no React state — puts a hash back into that
 * state on load, popstate and hashchange, so copy-link, reload and Back all
 * resolve to the same screen.
 */

import {
  type Dispatch, type SetStateAction,
  startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from "react";

import type { WorkspaceView } from "@/components/WorkspaceHeader";
import type { StageId } from "@/lib/overview-state";
import {
  DATA_SECTION_IDS, type DataSection,
  DEVELOPER_SECTION_IDS, type DeveloperSection,
  EXECUTION_SECTION_IDS, type ExecutionSection,
  OVERVIEW_SECTION_IDS, type OverviewSection,
  PORTFOLIO_SECTION_IDS, type PortfolioSection,
  RELIABILITY_SECTION_IDS, type ReliabilitySection,
  RESEARCH_SECTION_IDS, type ResearchSection,
  RISK_SECTION_IDS, type RiskSection,
} from "@/lib/sections";
import { emitPrefChange } from "@/lib/pref-sync-bus";
import { useConsolePrefetch } from "@/lib/use-console-prefetch";
import { WORKSPACE_LOCATION_KEY } from "@/lib/user-prefs";
import { useRailSections } from "@/lib/use-rail-sections";
import { useWorkspaceBootstrap } from "@/lib/use-workspace-bootstrap";
import { useHashFor, useViewWriter } from "@/lib/workspace-location";
import { locationHash } from "@/lib/section-views";
import { clearWorkspaceEntity } from "@/lib/workspace-entities";
import { buildTourStops } from "@/lib/workspace-tour";

export function useWorkspaceRouting() {
  const [view, setView] = useState<WorkspaceView>("overview");
  // Rail state, the live-section ref and the applier table live in
  // `use-rail-sections` — see its header for the seam. Called unconditionally
  // and first, so the hook count per render is unchanged by the split.
  const rails = useRailSections();
  const {
    overviewSection, researchSection, executionSection, dataSection, reliabilitySection,
    developerSection, marketsSection, coherenceSection, diffusionSection, riskSection, portfolioSection,
    setOverviewSection, setResearchSection, setExecutionSection, setDataSection,
    setReliabilitySection, setDeveloperSection, setMarketsSection, setCoherenceSection, setDiffusionSection, setRiskSection,
    setPortfolioSection, sectionByViewRef, applier,
    sectionViews, setSectionView, viewBySectionRef,
  } = rails;


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

  /** The visible tab, readable at click time for the same reason the sections are. */
  const viewRef = useRef<WorkspaceView>(view);

  const hashFor = useHashFor({ sectionByViewRef, viewBySectionRef, viewRef });
  viewRef.current = view;

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

  /** Hover/focus warm-up for the three chunk-split consoles. */
  const warmView = useConsolePrefetch();

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
        clearWorkspaceEntity(url);
        // Always the FULL location. Bare `#research` while the rail shows
        // Strategies was the desync: copy-link disagreed with reload, and a
        // forced per-workspace reset (data/reliability used to snap back to
        // overview) only hid it. Panels keep state; the URL tells the truth.
        url.hash = detail?.hash ?? hashFor(next);
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
     * the click happens, not when the render lands.
     *
     * The scroll reset is NOT here any more. Resetting at click time, while
     * the transition was still rendering the incoming workspace, scrolled the
     * OUTGOING panel to its top first — a visible jump of the old content,
     * longest on a console's first visit while its chunk was still arriving —
     * and then the cut. The reset now rides the layout effect below, in the
     * same commit that reveals the new panel. What stays here is the one case
     * that commit never sees: re-selecting the workspace already on screen
     * changes no state, so the effect cannot fire, and the click's answer has
     * always been "back to the top of the tab".
     */
    const url = new URL(window.location.href);
    clearWorkspaceEntity(url);
    url.hash = detail?.hash ?? hashFor(next);
    window.history[replace ? "replaceState" : "pushState"]({}, "", url);
    startTransition(() => {
      setView(next);
      detail?.apply();
    });
    if (viewRef.current === next) shellRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [hashFor]);

  /**
   * The cut lands when the panel does — for a tab change AND a subtab change.
   *
   * A layout effect keyed on the view and on the ACTIVE workspace's section
   * runs inside the commit that flips the panels' `hidden` attributes, before
   * the browser paints — so the incoming panel appears already at its top, in
   * the same frame, instead of the old one jerking upward and the new one
   * arriving later. It also covers every path that changes either level
   * without passing through `navigate`: popstate and hashchange land in
   * `readLocation`'s bare setters, which used to leave Back parked mid-page at
   * whatever depth the previous panel had been read to. Instant on purpose — a
   * change of panel is a cut, not a camera move, and a cut leaves
   * `prefers-reduced-motion` nothing to reduce.
   *
   * The section half exists because a workspace's visited panels stay mounted
   * behind `display: none` and share one scroller, so its scrollHeight follows
   * the TALLEST open panel. Measured on Portfolio: Performance settles at
   * 1066px against Positions' 406px, so switching down clamped scrollTop from
   * 650 to 5 and slid the page heading 645px back under the sticky rail — read
   * as "the summary card getting smaller then bigger". Keyed on
   * `sectionByViewRef.current[view]`, not on all eight section states, so a
   * change in a HIDDEN workspace cannot scroll the visible one; that ref is
   * assigned during render, so it is a legal dependency. And keyed on a
   * CHANGE: a data poll re-rendering the same section moves nobody.
   *
   * REJECTED — per-subtab scroll memory: returning to a section and finding
   * yourself mid-page with no explanation is worse than a predictable top, and
   * each section's summary and verdict live at its top. REJECTED — copying
   * ResearchWorkspace's local `scrollTop = 0` into the other seven rails:
   * `.research-content` and `.workspace-shell` are different boxes, so the
   * copy is inert in seven of eight workspaces, and eight `onChange` handlers
   * would miss Back, the cross-links and the palette. Research keeps its own
   * line rather than losing it here — at desk width its inner pane scrolls
   * too, and a reset of the shell cannot reach inside it.
   *
   * WorkspaceSubtabPanel's finer realignment composes rather than fights:
   * layout effects run before passive ones, so the shell lands at 0 first and
   * that effect's `drift < 0` branch then finds nothing to correct.
   */
  const activeSection = sectionByViewRef.current[view];
  useLayoutEffect(() => {
    shellRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [view, activeSection]);

  // The fragment is unavailable to the server render. This hook applies it in
  // a layout effect and releases the head bootstrap only after the lazy target
  // panel is the committed visible panel.
  useWorkspaceBootstrap({ view, activeSection, applier, setView, sectionByViewRef, viewRef });

  /** Records the section and its retained lens without leaving the workspace. */
  const pushSection = useCallback((workspace: WorkspaceView, next: string) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    clearWorkspaceEntity(url);
    // A section remembers its lens while the reader visits another section.
    // Serialise that lens on return or the mounted UI and a reload of the URL
    // disagree whenever the remembered lens is not the section default.
    url.hash = locationHash(workspace, next, viewBySectionRef.current[workspace]?.[next]);
    window.history.pushState({}, "", url);
  }, [viewBySectionRef]);

  /**
   * setState plus the URL push, one per rail. Bound as a table like `applier`
   * and for the same reason: eight hand-written callbacks of identical shape
   * had already let two of them re-implement `pushSection` inline.
   */
  const change = useMemo(() => {
    const bind = <T extends string>(workspace: WorkspaceView, set: Dispatch<SetStateAction<T>>) =>
      (next: T) => {
        set(next);
        pushSection(workspace, next);
      };
    return {
      overview: bind("overview", setOverviewSection),
      research: bind("research", setResearchSection),
      live: bind("live", setExecutionSection),
      developer: bind("developer", setDeveloperSection),
      markets: bind("markets", setMarketsSection),
      coherence: bind("coherence", setCoherenceSection),
      diffusion: bind("diffusion", setDiffusionSection),
      risk: bind("risk", setRiskSection),
      portfolio: bind("portfolio", setPortfolioSection),
      data: bind("data", setDataSection),
      reliability: bind("reliability", setReliabilitySection),
    };
  }, [pushSection]);

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
   * themselves are pinned by tests/desk-interconnect-cross-links.test.ts.
   */
  const openSection = useCallback((next: WorkspaceView, section?: string) => {
    const apply = section === undefined ? null : applier[next](section);
    if (!apply) {
      navigate(next);
      return;
    }
    navigate(next, false, { apply, hash: `${next}/${section}` });
  }, [applier, navigate]);

  /* Stable identities for the memoised tabs: an inline arrow prop would give
     every page render a fresh function and defeat the memo the page applies. */
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

  // One writer per view-declaring tab — explicit hooks rather than a loop —
  // and one setter dispatching between them for the panels.
  const changeResearchView = useViewWriter({ sectionByViewRef, viewBySectionRef, viewRef }, "research", setSectionView);
  const changeMarketsView = useViewWriter({ sectionByViewRef, viewBySectionRef, viewRef }, "markets", setSectionView);
  const changeCoherenceView = useViewWriter({ sectionByViewRef, viewBySectionRef, viewRef }, "coherence", setSectionView);
  const changeDiffusionView = useViewWriter({ sectionByViewRef, viewBySectionRef, viewRef }, "diffusion", setSectionView);
  const changeSectionView = useCallback((tab: WorkspaceView, section: string, next: string) => {
    if (tab === "research") changeResearchView(section, next);
    else if (tab === "markets") changeMarketsView(section, next);
    else if (tab === "coherence") changeCoherenceView(section, next);
    else if (tab === "diffusion") changeDiffusionView(section, next);
    else setSectionView(tab, section, next);
  }, [changeResearchView, changeMarketsView, changeCoherenceView, changeDiffusionView, setSectionView]);

  /** The current location as a shareable URL, straight from the live ref. */
  const copyLinkToView = useCallback(() => {
    const url = new URL(window.location.href);
    url.hash = hashFor(view);
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(url.toString()).catch(() => {
        // Clipboard access can be denied by browser policy. The command must
        // not turn that environmental refusal into an unhandled rejection.
      });
    }
  }, [view]);

  const tourStops = useMemo(() => buildTourStops({
    navigate, setOverviewSection, setResearchSection, setExecutionSection,
    setPortfolioSection, setRiskSection, setDataSection, setReliabilitySection,
    setDeveloperSection, setMarketsSection, setCoherenceSection, setDiffusionSection,
  }), [navigate]);

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
        JSON.stringify({ view, sections: sectionByViewRef.current, views: viewBySectionRef.current }),
      );
    } catch {
      // ignored
    }
    emitPrefChange(WORKSPACE_LOCATION_KEY);
    // Every rail, including the two the Kalshi engine now spans. Coherence had
    // been missing from this list since it landed, so a reader who moved only
    // inside that tab had the move persisted on their next move anywhere else,
    // or not at all.
  }, [view, overviewSection, researchSection, executionSection, dataSection,
    reliabilitySection, developerSection, marketsSection, coherenceSection, diffusionSection,
    riskSection, portfolioSection]);

  // Packed rather than one key per line: this file sits under the same size
  // ceiling page.tsx was split to respect.
  return {
    view, shellRef, visitedViews, navigate, warmView, pushSection, openSection,
    overviewSection, researchSection, executionSection, dataSection,
    reliabilitySection, developerSection, marketsSection, coherenceSection, diffusionSection, riskSection, portfolioSection,
    setOverviewSection, setResearchSection, setExecutionSection, setDataSection,
    setReliabilitySection, setDeveloperSection, setMarketsSection, setCoherenceSection, setDiffusionSection, setRiskSection, setPortfolioSection,
    changeOverviewSection: change.overview, changeResearchSection: change.research,
    changeExecutionSection: change.live, changeDeveloperSection: change.developer,
    changeRiskSection: change.risk, changePortfolioSection: change.portfolio,
    changeDataSection: change.data, changeReliabilitySection: change.reliability,
    changeMarketsSection: change.markets, changeCoherenceSection: change.coherence,
    changeDiffusionSection: change.diffusion,
    openRiskSection, openPortfolioSection, openResearchSummary, openLiveLiquidity,
    openReliabilityOverview, openDataOverview, openLoopStage, openReliabilitySection,
    copyLinkToView, tourStops,
    sectionViews, setSectionView: changeSectionView,
  };
}
