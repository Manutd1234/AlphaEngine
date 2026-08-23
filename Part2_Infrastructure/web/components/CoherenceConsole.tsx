"use client";

/**
 * Coherence — Kalshi's prices, tested against the probabilities they claim.
 *
 * A contract that pays a dollar if an event happens is a probability with a
 * price on it. The exchange publishes the logical structure between those
 * contracts in its own metadata, which makes the venue a set of probability
 * claims that either admit a measure or do not. Where they do not, the
 * portfolio that profits in every state falls out of the failure — so this tab
 * does not scan for arbitrage shapes, it tests for coherence and reports what
 * the failure certificate is.
 *
 * What it may claim today: the exchange is read live, the books are shown as
 * Kalshi really publishes them, the mutually exclusive families are priced
 * against the dollar they pay, and the tape is being recorded. What it may not
 * claim: that anything has been solved, sized or traded. The solver, the cost
 * model and the index are named on the rail and marked as unbuilt rather than
 * hidden, because the rail is the outline of the argument.
 *
 * Panes are `.seg` groups inside a section, never a nested `<WorkspaceSubtabs>`
 * — a second rail instance fights the first over the `--rail-h` publisher, as
 * `ReliabilityConsole` records.
 */

import { useMemo, useState } from "react";

import PageHead from "@/components/workspace/PageHead";
import WorkspaceSubtabs, { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
import FreshnessStamp from "@/components/workspace/FreshnessStamp";
import BooksSection, { type BooksView } from "@/components/coherence/BooksSection";
import CertificatePane from "@/components/coherence/CertificatePane";
import DiffusionPane from "@/components/coherence/DiffusionPane";
import IndexPane from "@/components/coherence/IndexPane";
import CalibrationPane from "@/components/coherence/CalibrationPane";
import CombosPane from "@/components/coherence/CombosPane";
import FeesSection from "@/components/coherence/FeesSection";
import LessonsPane from "@/components/coherence/LessonsPane";
import ShellPane from "@/components/coherence/ShellPane";
import StatusPane from "@/components/coherence/StatusPane";
import SurfacePane from "@/components/coherence/SurfacePane";
import UniverseSection from "@/components/coherence/UniverseSection";
import { COHERENCE_SECTIONS, type CoherenceSection } from "@/lib/sections";
import { COHERENCE_POLL_MS, useCoherenceRead } from "@/lib/coherence/use-coherence";
import type { CoherenceBooks, CoherenceStatus, CoherenceUniverse } from "@/lib/coherence/types";

export { type CoherenceSection } from "@/lib/sections";

export interface CoherenceConsoleProps {
  section: CoherenceSection;
  onSectionChange: (section: CoherenceSection) => void;
  /** False while another tab is in front: every poll here is gated on it. */
  active?: boolean;
}

export default function CoherenceConsole({ section, onSectionChange, active = true }: CoherenceConsoleProps) {
  const status = useCoherenceRead<CoherenceStatus>("/api/gateway/coherence/status", active);
  const universe = useCoherenceRead<CoherenceUniverse>(
    // Two events per watched series, not four. Each event costs two round
    // trips even read concurrently, and `callGateway` gives up at eight
    // seconds — four took 10.1s before the reads were parallelised and 6.4s
    // after, which is inside the deadline but not comfortably. Two answers in
    // about four and a half.
    "/api/gateway/coherence/universe?max_events=2",
    active && (section === "universe" || section === "certificate" || section === "lattice"),
  );
  // Which of the three book views is open. The read below is the exchange's
  // book route; the Dispersion view does not draw a book, so it does not ask
  // for one. `BooksSection` announces the change because the read has to live
  // up here, where `active` and `section` are.
  const [booksView, setBooksView] = useState<BooksView>("ladder");
  const books = useCoherenceRead<CoherenceBooks>(
    "/api/gateway/coherence/books",
    active && section === "books" && booksView !== "dispersion",
  );

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

  const openSection = (next: CoherenceSection) => {
    onSectionChange(next);
    requestAnimationFrame(() => document.getElementById(`coherence-subtab-${next}`)?.focus());
  };

  return (
    <div className="coherence-plane">
      <PageHead
        kicker="Coherence"
        title="Prices as probabilities, tested for coherence"
        description={
          <>
            A contract paying $1 if an event happens is a probability with a price on it. Where a family of those
            prices admits no probability measure, the failure hands back a portfolio that wins in every state. This tab
            reads the exchange live and records what it saw; it places no orders.
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
        workspaceId="coherence"
        label="Coherence sections"
        tabs={COHERENCE_SECTIONS}
        activeId={section}
        onChange={openSection}
        secondary={["lessons"]}
        active={active}
      />

      <WorkspaceSubtabPanel workspaceId="coherence" tabId="universe" activeId={section}>
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

      <WorkspaceSubtabPanel workspaceId="coherence" tabId="books" activeId={section}>
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

      <WorkspaceSubtabPanel workspaceId="coherence" tabId="lattice" activeId={section}>
        <SurfacePane
          events={universe.data?.events ?? []}
          active={active && section === "lattice"}
        />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="coherence" tabId="certificate" activeId={section}>
        <CertificatePane events={universe.data?.events ?? []} active={active && section === "certificate"} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="coherence" tabId="fees" activeId={section}>
        <FeesSection active={active && section === "fees"} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="coherence" tabId="index" activeId={section}>
        <IndexPane active={active && section === "index"} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="coherence" tabId="combos" activeId={section}>
        <CombosPane active={active && section === "combos"} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="coherence" tabId="calibration" activeId={section}>
        <CalibrationPane active={active && section === "calibration"} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="coherence" tabId="diffusion" activeId={section}>
        <DiffusionPane active={active && section === "diffusion"} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="coherence" tabId="shell" activeId={section}>
        <ShellPane active={active && section === "shell"} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="coherence" tabId="lessons" activeId={section}>
        <LessonsPane />
      </WorkspaceSubtabPanel>

      <div className="coh-console__status">
        <StatusPane status={status.data} error={status.error} />
      </div>
    </div>
  );
}
