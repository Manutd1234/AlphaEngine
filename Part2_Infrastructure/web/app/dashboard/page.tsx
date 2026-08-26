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
 *   - and the ⌘K palette, already `lib/workspace-commands`;
 *   - the eight `<section role="tabpanel">` elements themselves, now
 *     `components/workspace/WorkspacePanels`, with the four-tile briefs that
 *     open three of them in `lib/workspace-insights`;
 *   - and the two global keystrokes, now `lib/use-workspace-shortcuts`.
 *
 * What stays is the shell's own job: run the hooks, draw the one header every
 * tab shares, hold the state two or more panels read (the order draft, the
 * execution sleeve, the engineering queue), own the one invalidation path
 * every mutation calls, and keep every hook above the render so a tab switch
 * can never change how many of them run.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type PortfolioFocusDestination } from "@/components/PortfolioWorkspace";
import CommandBar, { type Command } from "@/components/header/CommandBar";
import ShortcutsOverlay from "@/components/header/ShortcutsOverlay";
import WorkspaceBottomNav from "@/components/WorkspaceBottomNav";
import WorkspaceHeader from "@/components/WorkspaceHeader";
import WorkspacePanels from "@/components/workspace/WorkspacePanels";
import { useDataWorkQueue } from "@/lib/use-data-work-queue";
import {
  createInitialDeveloperWorkItems,
  loadDeveloperWorkItems,
  saveDeveloperWorkItems,
  type DeveloperWorkItem,
} from "@/lib/developer-work";
import { useBook } from "@/lib/use-book";
import { useSweepRun } from "@/lib/use-sweep-run";
import { useSystemHealth } from "@/lib/use-system-health";
import { useThrottledValue } from "@/lib/use-throttled-value";
import { useWorkspaceRouting } from "@/lib/use-workspace-routing";
import { useWorkspaceShortcuts } from "@/lib/use-workspace-shortcuts";
import { buildCommands } from "@/lib/workspace-commands";
import { DEFAULT_REQUEST, type Strategy } from "@/lib/types";
import { startUserPrefsSync } from "@/lib/user-prefs";
import type { Side } from "@/lib/venues";

export default function Page() {
  // Both hooks are held whole, not spread: `WorkspacePanels` takes each return
  // as one object, so a panel cannot be handed half a hook. The shell pulls out
  // only what the header, the palette and its own handlers need.
  const routing = useWorkspaceRouting();
  const {
    view, shellRef, navigate, warmView, setExecutionSection, openReliabilitySection,
    setOverviewSection, setResearchSection, setDataSection, setReliabilitySection,
    setDeveloperSection, setMarketsSection, setCoherenceSection, setDiffusionSection, setRiskSection, setPortfolioSection, researchSection,
    copyLinkToView, tourStops, setSectionView,
  } = routing;
  const sweep = useSweepRun({ view });
  const {
    req, data, running, run, runNow, pinRun, currentPinned, updateStrategy,
    updateSymbol, setAutoRun, setAutoSuspended,
  } = sweep;

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
  const { commandBarOpen, setCommandBarOpen, shortcutsOpen, setShortcutsOpen } = useWorkspaceShortcuts();

  // One book and one health snapshot, shared by the tabs that read them. Both
  // hooks own their polling, so a tab is a rendering decision rather than a
  // second source of truth.
  const book = useBook();
  const systems = useSystemHealth(req.symbol);
  const headerSummary = useThrottledValue(systems.health?.summary ?? null); // counters only; health stays immediate
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
   * holds no routing knowledge of its own: all 10 tabs, every rail section,
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
    setDeveloperSection, setMarketsSection, setCoherenceSection, setDiffusionSection, setSectionView, updateStrategy, updateSymbol, run, pinRun, running,
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
    setMarketsSection, setCoherenceSection, setDiffusionSection, setSectionView,
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
        latency={headerSummary?.upstreamLatency ?? headerSummary?.latency ?? null}
        gatewayHopLatency={headerSummary?.gatewayHopLatency ?? null}
        degraded={systems.degraded}
        providersReady={headerSummary?.ready ?? null}
        providersTotal={headerSummary?.total ?? null}
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
        <WorkspacePanels
          routing={routing}
          sweep={sweep}
          /* The state the shell owns because two or more panels read it: the
             order draft, the execution sleeve, the engineering queue, and the
             one invalidation path every mutation calls. */
          desk={{
            book, systems, dataWork, side, setSide, notional, setNotional,
            orderType, setOrderType, limitPrice, setLimitPrice,
            executionStrategy, setExecutionStrategy, showMcBands, setShowMcBands,
            mcRunNonce, developerWorkItems, setDeveloperWorkItems,
            selectedSleeveDetail, selectedSleeveAttribution, revalidateDesk,
            focusPortfolioSymbol, stageLimitFromLadder, resumeAutoRun, changeAutoRun,
          }}
        />

      </main>

      <WorkspaceBottomNav
        view={view}
        onNavigate={navigate}
        onOpenPalette={() => setCommandBarOpen(true)}
      />

      <footer className="workspace-footer">
        <span>AlphaEngine</span>
        <p>
          Educational demonstration, not a brokerage or investment service and not investment
          advice. No brokerage accounts, no funds, no real orders; execution is paper-only, gated
          by the risk gateway. Signing in is optional and stores workspace preferences only.
        </p>
      </footer>
    </>
  );
}
