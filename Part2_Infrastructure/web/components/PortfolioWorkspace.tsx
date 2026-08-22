"use client";

/**
 * Portfolio manager's tab: what the book owns, and whether the shape of it is
 * the shape that was intended.
 *
 * The limits themselves live on the Risk tab. What stays here is the subset a PM
 * acts on — how much of each cap is spent, and which one binds first — because
 * "should I add to this sleeve" is an allocation question answered by a limit,
 * and sending someone to another tab to learn they have no room would make this
 * page lie by omission.
 *
 * The five sections answer five different questions and were one scroll until
 * they were split: what is the book worth (overview), how did it get there
 * (equity), what exactly is in it (positions), what should be in it
 * (allocation), and which sleeve earned it (performance). Four of those have
 * since split again, in-panel — Overview into Standing/Book, Positions into
 * Holdings/Shape/Exit, Allocation into Mix/Targets/Composition and Performance
 * into its two time bases — because a section that answers one question with
 * eight cards is a scroll wearing a subtab's name.
 * Real-time monitoring and static target allocation are not the
 * same activity, and a page that interleaves them asks the reader to hold both
 * at once.
 *
 * This file is the wiring and nothing else. It held all five sections inline
 * and reached 1,105 lines, at which point the panel a reader wanted could only
 * be found by scrolling past the four they did not. Each section is now one
 * component behind one `WorkspaceSubtabPanel`, which is the shape
 * `RiskWorkspace` and `DeveloperConsole` already use — and the four in-panel
 * pane selectors moved with their sections, each declared above its own
 * component's first return.
 *
 * What deliberately stayed here: the section jump, because it moves focus onto
 * the rail this component owns; the book bail-out, so no section is ever handed
 * a null book and none of them needs its own null branch; and the execution
 * handoff, which must outlive a section change.
 */

import { useState } from "react";

import { BookChrome, BookFallback, BookSourceControl, bookStateLabel } from "@/components/portfolio/BookChrome";
import AllocationSection from "@/components/portfolio/AllocationSection";
import EquityCurve from "@/components/portfolio/EquityCurve";
import ExecutionHandoff, { type HandoffIntent } from "@/components/portfolio/ExecutionHandoff";
import OverviewSection from "@/components/portfolio/OverviewSection";
import PerformanceSection from "@/components/portfolio/PerformanceSection";
import PnlWaterfall from "@/components/portfolio/PnlWaterfall";
import PositionsSection from "@/components/portfolio/PositionsSection";
import WorkspaceSubtabs, { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
import { buildPnlWaterfall } from "@/lib/pnl-attribution";
import { PORTFOLIO_SECTIONS, type PortfolioSection, type RiskSection } from "@/lib/sections";
import type { BookView } from "@/lib/use-book";

export type PortfolioFocusDestination = "research" | "live" | "data";

export interface PortfolioWorkspaceProps {
  view: BookView;
  workspaceSymbol: string;
  onFocusSymbol: (symbol: string, destination: PortfolioFocusDestination) => void;
  /**
   * The section is optional so a caller that can only switch tabs stays valid.
   * The cross-link tile names the panel that explains its figures; a handler
   * that ignores the argument lands wherever the reader last was, which is the
   * behaviour this argument exists to end.
   */
  onOpenRisk: (section?: RiskSection) => void;
  /** Operator credential shared with the Reliability tab and the header. */
  operatorToken?: string;
  section: PortfolioSection;
  onSectionChange: (section: PortfolioSection) => void;
  /** False while this workspace is mounted but hidden behind another tab. */
  active?: boolean;
}

export { PORTFOLIO_SECTION_IDS, type PortfolioSection } from "@/lib/sections";

export default function PortfolioWorkspace({
  view,
  workspaceSymbol,
  onFocusSymbol,
  onOpenRisk,
  operatorToken,
  section,
  onSectionChange,
  active = true,
}: PortfolioWorkspaceProps) {
  // Above the `!book` bail-out, with every other hook: state declared after an
  // early return is the "rendered more hooks than during the previous render"
  // crash on the first snapshot that arrives. The four pane selectors keep the
  // same rule one file along — each sits at the top of its own section
  // component, which this one mounts only once the bail-out below has passed.
  const [handoff, setHandoff] = useState<HandoffIntent | null>(null);
  const selectedSymbol = workspaceSymbol.trim().toUpperCase();

  const {
    book,
    isStale,
    risk,
    riskPositions,
    covarianceModel,
    allocationLimits,
    riskShare,
    betaBySymbol,
    equityTrack,
    periods,
    historyBackfilled,
    referenceSymbol,
    referenceSessionReturn,
    refresh,
  } = view;

  const fallback = <BookFallback view={view} onOpenResearch={() => onFocusSymbol(selectedSymbol, "research")} />;
  if (!book) return fallback;

  // Sandbox first: `isStale` is forced false in sandbox, so keying on it alone
  // would caption generated positions as a "Live book". The three words now
  // come from `bookStateLabel`, which the heading's status line reads too — the
  // wording was stated in both places and had already drifted apart in the
  // stale case, so one snapshot carried two names a scroll apart.
  const bookLabel = bookStateLabel(Boolean(book.sandbox), isStale);

  // Moving focus with the section is what makes the jump usable from a keyboard:
  // the rail is a tablist, so landing on the tab itself puts the arrow keys back
  // in reach instead of stranding the caret wherever the link was.
  const openSection = (next: PortfolioSection) => {
    onSectionChange(next);
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => document.getElementById(`portfolio-subtab-${next}`)?.focus());
    }
  };

  const waterfall = buildPnlWaterfall({
    book,
    positions: riskPositions,
    betaBySymbol,
    referenceSymbol,
    referenceReturn: referenceSessionReturn,
  });

  return (
    <>
      <BookChrome view={view} />

      <WorkspaceSubtabs
        workspaceId="portfolio"
        label="Portfolio manager sections"
        tabs={PORTFOLIO_SECTIONS}
        activeId={section}
        onChange={onSectionChange}
        actions={<BookSourceControl view={view} />}
        active={active}
      />

      <WorkspaceSubtabPanel workspaceId="portfolio" tabId="overview" activeId={section}>
        <OverviewSection
          book={book}
          bookLabel={bookLabel}
          risk={risk}
          riskPositions={riskPositions}
          covarianceModel={covarianceModel}
          allocationLimits={allocationLimits}
          equityTrack={equityTrack}
          onOpenSection={openSection}
          onOpenRisk={onOpenRisk}
        />
      </WorkspaceSubtabPanel>

      {/* One session read two ways — the path and its decomposition. They left
          the overview because that section had grown to seven panels covering
          alerts, headroom, charts, a positions preview and a risk cross-link;
          the charts are the half a reader comes back to. Two charts is not a
          scroll, so this section keeps no in-panel switcher and stays here. */}
      <WorkspaceSubtabPanel workspaceId="portfolio" tabId="equity" activeId={section}>
        <div className="compact-grid-2col portfolio-chart-pair">
          <EquityCurve
            periods={periods}
            backfilled={historyBackfilled}
            points={equityTrack}
            startOfDay={book.equity.start_of_day}
            haltLevel={book.risk_budget.daily_drawdown.equity_at_halt}
            generated={Boolean(book.sandbox)}
          />

          <PnlWaterfall waterfall={waterfall} generated={Boolean(book.sandbox)} />
        </div>
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="portfolio" tabId="positions" activeId={section}>
        {/* `sectionActive` rather than `active`: the section panel stays mounted
            once opened and the workspace persists behind other tabs, so the
            working-orders poll inside has to be told about both. The pane half
            of that condition is the section's own. */}
        <PositionsSection
          book={book}
          bookLabel={bookLabel}
          isStale={isStale}
          betaBySymbol={betaBySymbol}
          riskShare={riskShare}
          advBySymbol={view.advBySymbol}
          selectedSymbol={selectedSymbol}
          operatorToken={operatorToken}
          sectionActive={active && section === "positions"}
          onFocusSymbol={onFocusSymbol}
          onRequestHandoff={setHandoff}
          onRefresh={() => void refresh(true)}
        />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="portfolio" tabId="allocation" activeId={section}>
        <AllocationSection
          book={book}
          riskPositions={riskPositions}
          covarianceModel={covarianceModel}
          allocationLimits={allocationLimits}
        />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="portfolio" tabId="performance" activeId={section}>
        <PerformanceSection book={book} isStale={isStale} equityTrack={equityTrack} />
      </WorkspaceSubtabPanel>

      {/* Outside every panel on purpose: an in-flight handoff must not vanish
          because the reader changed section while the request was open. */}
      <ExecutionHandoff
        intent={handoff}
        onClose={() => setHandoff(null)}
        sandbox={Boolean(book.sandbox)}
        onExecuted={() => void refresh(true)}
        operatorToken={operatorToken}
      />
    </>
  );
}
