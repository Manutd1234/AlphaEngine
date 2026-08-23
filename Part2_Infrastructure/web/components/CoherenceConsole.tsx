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

import { useMemo } from "react";

import PageHead from "@/components/workspace/PageHead";
import WorkspaceSubtabs, { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
import FreshnessStamp from "@/components/workspace/FreshnessStamp";
import BooksPane from "@/components/coherence/BooksPane";
import CertificatePane from "@/components/coherence/CertificatePane";
import DiffusionPane from "@/components/coherence/DiffusionPane";
import IndexPane from "@/components/coherence/IndexPane";
import AblationPane from "@/components/coherence/AblationPane";
import FeesPane from "@/components/coherence/FeesPane";
import LessonsPane from "@/components/coherence/LessonsPane";
import PendingPane from "@/components/coherence/PendingPane";
import StatusPane from "@/components/coherence/StatusPane";
import UniversePane from "@/components/coherence/UniversePane";
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
    "/api/gateway/coherence/universe?max_events=4",
    active && (section === "universe" || section === "certificate"),
  );
  const books = useCoherenceRead<CoherenceBooks>("/api/gateway/coherence/books", active && section === "books");

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
        title="Kalshi, tested against the probabilities its prices claim"
        description={
          <>
            A contract paying $1 if an event happens is a probability with a price on it. Where a family of prices
            admits no probability measure, the portfolio that wins in every state is what the failure hands back. This
            tab reads the exchange live and records what it saw; nothing here places an order.
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
        <UniversePane universe={universe.data} error={universe.error} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="coherence" tabId="books" activeId={section}>
        <BooksPane books={books.data} error={books.error} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="coherence" tabId="lattice" activeId={section}>
        <PendingPane
          purpose="It will draw the implication graph the exchange publishes — which markets imply which — with the survival function the strike ladder samples and the probability mass each bucket carries."
          waitingOn={[
            "Build the lattice from mutual exclusivity, strike ladders, buckets and settlement sources",
            "Write the constraint families as sparse rows, each carrying the sentence it prints when violated",
          ]}
          lessons={["lattice"]}
        />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="coherence" tabId="certificate" activeId={section}>
        <CertificatePane events={universe.data?.events ?? []} active={active && section === "certificate"} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="coherence" tabId="fees" activeId={section}>
        <FeesPane active={active && section === "fees"} />
        <AblationPane active={active && section === "fees"} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="coherence" tabId="index" activeId={section}>
        <IndexPane active={active && section === "index"} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="coherence" tabId="diffusion" activeId={section}>
        <DiffusionPane active={active && section === "diffusion"} />
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
