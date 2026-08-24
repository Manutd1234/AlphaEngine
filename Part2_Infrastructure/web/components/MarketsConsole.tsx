"use client";

/**
 * Markets — the Kalshi venue as it is quoted, before anything is proved about it.
 *
 * A contract that pays a dollar if an event happens is a probability with a
 * price on it. This tab is the reading: which families the engine watches and
 * what a whole dollar of one costs, the two bid ladders the exchange really
 * publishes, the implication structure between the outcomes, and the same
 * universe walked as a filesystem. What follows FROM those prices — the
 * de Finetti test, the cost model, the index, the settled scorecard — is the
 * Coherence tab, which is the other half of one argument split on 2026-08-24
 * because eleven sections asked a reader to hold two questions at once.
 *
 * It reads and records; it places no orders, and there is no send path in this
 * version.
 *
 * Panes are `.seg` groups inside a section, never a nested `<WorkspaceSubtabs>`
 * — a second rail instance fights the first over the `--rail-h` publisher, as
 * `ReliabilityConsole` records.
 */

import { useCallback, useMemo, useState } from "react";

import PageHead from "@/components/workspace/PageHead";
import WorkspaceSubtabs, { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
import FreshnessStamp from "@/components/workspace/FreshnessStamp";
import BooksSection, { type BooksView } from "@/components/coherence/BooksSection";
import ShellPane from "@/components/coherence/ShellPane";
import StatusPane from "@/components/coherence/StatusPane";
import SurfacePane from "@/components/coherence/SurfacePane";
import UniverseSection from "@/components/coherence/UniverseSection";
import { MARKETS_SECTIONS, type MarketsSection } from "@/lib/sections";
import { booksRoute, shellRoute, statusRoute, universeRoute } from "@/lib/coherence/routes";
import { COHERENCE_POLL_MS, useCoherenceRead, warmCoherenceRead } from "@/lib/coherence/use-coherence";
import type { CoherenceBooks, CoherenceStatus, CoherenceUniverse } from "@/lib/coherence/types";
import { useSectionWarming } from "@/lib/coherence/use-section-warming";

export { type MarketsSection } from "@/lib/sections";

/**
 * What each section asks the gateway for the moment it opens.
 *
 * Only the reads a section makes with no choice from the reader — the surface
 * and stake reads name a family the reader picks, and warming one guesses at
 * an answer rather than at a question. Built from `lib/coherence/routes` so a
 * query string cannot drift between the pane that asks and the rail that warms.
 */
const SECTION_READS: Record<MarketsSection, readonly string[]> = {
  universe: [universeRoute()],
  books: [booksRoute()],
  lattice: [universeRoute()],
  shell: [shellRoute("/", "ls")],
};

export interface MarketsConsoleProps {
  section: MarketsSection;
  onSectionChange: (section: MarketsSection) => void;
  /** False while another tab is in front: every poll here is gated on it. */
  active?: boolean;
}

export default function MarketsConsole({ section, onSectionChange, active = true }: MarketsConsoleProps) {
  const status = useCoherenceRead<CoherenceStatus>(statusRoute(), active);
  const universe = useCoherenceRead<CoherenceUniverse>(
    universeRoute(),
    active && (section === "universe" || section === "lattice"),
  );
  // Which of the three book views is open. The read below is the exchange's
  // book route; the Dispersion view does not draw a book, so it does not ask
  // for one. `BooksSection` announces the change because the read has to live
  // up here, where `active` and `section` are.
  const [booksView, setBooksView] = useState<BooksView>("ladder");
  const books = useCoherenceRead<CoherenceBooks>(
    booksRoute(),
    active && section === "books" && booksView !== "dispersion",
  );

  useSectionWarming(SECTION_READS, active);

  const metrics = useMemo(() => {
    const recorder = status.data?.recorder;
    const tape = status.data?.tape as { book_snapshots?: number } | undefined;
    return [
      {
        label: "Exchange",
        value: status.data?.hosts.some((host) => host.reachable) ? "reachable" : "—",
        note: status.data?.hosts[0]?.host ?? "not yet asked",
      },
      {
        label: "Families priced",
        value: universe.data ? String(universe.data.events.length) : "—",
        note: universe.data ? "mutually exclusive baskets read live" : "not read on this section",
      },
      {
        label: "Books recorded",
        value: tape?.book_snapshots != null ? String(tape.book_snapshots) : "—",
        note: recorder?.configured ? `every ${recorder.poll_seconds}s` : "recorder not configured",
        mono: true,
      },
      {
        label: "Order path",
        value: "none",
        note: "this engine reads, records and certifies; it sends nothing",
      },
    ];
  }, [status.data, universe.data]);

  const openSection = (next: MarketsSection) => {
    onSectionChange(next);
    requestAnimationFrame(() => document.getElementById(`markets-subtab-${next}`)?.focus());
  };
  const warmSection = useCallback((next: MarketsSection) => {
    for (const url of SECTION_READS[next]) warmCoherenceRead(url);
  }, []);

  return (
    <div className="coherence-plane">
      <PageHead
        kicker="Markets"
        title="The exchange as it is quoted"
        description={
          <>
            A contract paying $1 if an event happens is a probability with a price on it. These are the families this
            engine watches, the ladders behind them and the structure between their outcomes, read live and recorded.
            Whether those prices admit a probability at all is the Coherence tab.
          </>
        }
        actions={
          <FreshnessStamp updatedAt={status.updatedAt} pollMs={COHERENCE_POLL_MS} paused={!active} transport="poll" />
        }
        metrics={metrics}
        status={
          status.data
            ? { label: status.data.state === "ok" ? "Reading the exchange" : status.data.state, tone: status.data.state === "ok" ? "good" : "warn" }
            : undefined
        }
      />

      <WorkspaceSubtabs
        workspaceId="markets"
        label="Markets sections"
        tabs={MARKETS_SECTIONS}
        activeId={section}
        onChange={openSection}
        onIntent={warmSection}
        active={active}
      />

      <WorkspaceSubtabPanel workspaceId="markets" tabId="universe" activeId={section}>
        {/* The settlement feed is a view of this section rather than a pane
            stacked under it, because it answers the question the universe
            raises: these families are priced against an outcome, and this is
            the published variable that outcome is read from — which is not the
            price anybody watches. */}
        <UniverseSection
          universe={universe.data}
          error={universe.error}
          active={active && section === "universe"}
        />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="markets" tabId="books" activeId={section}>
        {/* Maker dispersion is a view of this section for the reason it
            exists: a book shows the most aggressive opinion on one market, and
            for a combo it shows nothing at all. The RFQ panel is the only place
            the venue reveals what professionals disagree about. */}
        <BooksSection
          books={books.data}
          error={books.error}
          active={active && section === "books"}
          onViewChange={setBooksView}
        />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="markets" tabId="lattice" activeId={section}>
        <SurfacePane
          events={universe.data?.events ?? []}
          active={active && section === "lattice"}
        />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="markets" tabId="shell" activeId={section}>
        <ShellPane active={active && section === "shell"} />
      </WorkspaceSubtabPanel>

      <div className="coh-console__status">
        <StatusPane status={status.data} error={status.error} />
      </div>
    </div>
  );
}
