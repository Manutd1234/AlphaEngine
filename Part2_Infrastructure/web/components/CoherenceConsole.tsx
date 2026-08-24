"use client";

/**
 * Coherence — Kalshi's prices, tested against the probabilities they claim.
 *
 * The Markets tab is the reading: which families are watched, what their
 * ladders say, what structure holds between their outcomes. This tab is what
 * follows from it. Where a family of prices admits no probability measure, the
 * failure hands back a portfolio that wins in every state — so the engine does
 * not scan for arbitrage shapes, it tests for coherence and reports what the
 * failure certificate is. Then it asks the harder questions the certificate
 * cannot: what the cost model does to the edge, how far from coherent the
 * venue sits over time, whether the prices were right once settled, and how
 * fast anything gets absorbed at all.
 *
 * The two tabs were one eleven-section rail until 2026-08-24, which asked a
 * reader to hold "what is quoted" and "what is proved" at the same time. The
 * ids did not move with the split: `#coherence/books` is a public deep link
 * and `RELOCATED_SECTIONS` in `lib/workspace-hash.ts` is what keeps the four
 * that changed tab resolving.
 *
 * What it may claim today: the exchange is read live, the families are priced
 * against the dollar they pay, and the tape is being recorded. What it may not
 * claim: that anything has been solved, sized or traded. There is no send path
 * in this version.
 *
 * Panes are `.seg` groups inside a section, never a nested `<WorkspaceSubtabs>`
 * — a second rail instance fights the first over the `--rail-h` publisher, as
 * `ReliabilityConsole` records.
 */

import { useCallback, useMemo } from "react";

import PageHead from "@/components/workspace/PageHead";
import WorkspaceSubtabs, { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
import FreshnessStamp from "@/components/workspace/FreshnessStamp";
import CertificatePane from "@/components/coherence/CertificatePane";
import DiffusionPane from "@/components/coherence/DiffusionPane";
import { EXAMPLES } from "@/components/coherence/FeesPane";
import IndexPane from "@/components/coherence/IndexPane";
import CalibrationPane from "@/components/coherence/CalibrationPane";
import CombosPane from "@/components/coherence/CombosPane";
import FeesSection from "@/components/coherence/FeesSection";
import LessonsPane from "@/components/coherence/LessonsPane";
import StatusPane from "@/components/coherence/StatusPane";
import { COHERENCE_SECTIONS, type CoherenceSection } from "@/lib/sections";
import {
  absorptionRoute, calibrationRoute, combosRoute, feesRoute, indexRoute, statusRoute, universeRoute,
} from "@/lib/coherence/routes";
import { COHERENCE_POLL_MS, useCoherenceRead, warmCoherenceRead } from "@/lib/coherence/use-coherence";
import { useSectionWarming } from "@/lib/coherence/use-section-warming";
import type { CoherenceStatus, CoherenceUniverse } from "@/lib/coherence/types";

export { type CoherenceSection } from "@/lib/sections";

/**
 * What each section asks the gateway for the moment it opens.
 *
 * The view each section OPENS on, not every view it has: Fees warms the worked
 * example because that is what a reader lands on, and not the 20,000-row
 * replay behind Ablation, which is the largest read on the desk and is gated
 * on its own view for that reason. Sections whose read names a family the
 * reader picks — the certificate is solved per event — warm the universe
 * instead, which is the read that has to answer before a family can be chosen.
 *
 * Built from `lib/coherence/routes` so a query string cannot drift between the
 * pane that asks for it and the rail that warms it.
 */
const SECTION_READS: Record<CoherenceSection, readonly string[]> = {
  certificate: [universeRoute()],
  fees: [feesRoute(EXAMPLES[0].price, EXAMPLES[0].contracts, EXAMPLES[0].fills)],
  combos: [combosRoute()],
  index: [indexRoute()],
  calibration: [calibrationRoute()],
  diffusion: [absorptionRoute()],
  // The curriculum is rendered from `lib/coherence/lessons.ts`; it asks the
  // gateway for nothing, so there is nothing to warm.
  lessons: [],
};

export interface CoherenceConsoleProps {
  section: CoherenceSection;
  onSectionChange: (section: CoherenceSection) => void;
  /** False while another tab is in front: every poll here is gated on it. */
  active?: boolean;
}

export default function CoherenceConsole({ section, onSectionChange, active = true }: CoherenceConsoleProps) {
  const status = useCoherenceRead<CoherenceStatus>(statusRoute(), active);
  // The certificate is solved per family, so the families have to be read here
  // even though Markets is where they are drawn. The shared cache means this
  // costs nothing when a reader arrives from that tab.
  const universe = useCoherenceRead<CoherenceUniverse>(
    universeRoute(),
    active && section === "certificate",
  );

  useSectionWarming(SECTION_READS, active);

  const metrics = useMemo(() => {
    const solver = status.data?.solver as { engine?: string } | undefined;
    return [
      {
        label: "Exchange",
        value: status.data?.hosts.some((host) => host.reachable) ? "reachable" : "—",
        note: status.data?.hosts[0]?.host ?? "not yet asked",
      },
      {
        label: "Families testable",
        value: universe.data ? String(universe.data.events.length) : "—",
        note: universe.data ? "mutually exclusive baskets read live" : "not read on this section",
      },
      {
        label: "Solver",
        value: solver?.engine ?? "—",
        note: solver?.engine ? "the engine the certificate is produced by" : "not reported in this read",
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
  const warmSection = useCallback((next: CoherenceSection) => {
    for (const url of SECTION_READS[next]) warmCoherenceRead(url);
  }, []);

  return (
    <div className="coherence-plane">
      <PageHead
        kicker="Coherence"
        title="Prices as probabilities, tested for coherence"
        description={
          <>
            Where a family of prices admits no probability measure, the failure hands back a portfolio that wins in
            every state. This tab is that test and what survives it: the certificate, the cost that eats the edge, the
            distance from coherent over time, and whether the prices were right once settled.
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
        onIntent={warmSection}
        secondary={["lessons"]}
        active={active}
      />

      <WorkspaceSubtabPanel workspaceId="coherence" tabId="certificate" activeId={section}>
        <CertificatePane events={universe.data?.events ?? []} active={active && section === "certificate"} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="coherence" tabId="fees" activeId={section}>
        <FeesSection active={active && section === "fees"} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="coherence" tabId="combos" activeId={section}>
        <CombosPane active={active && section === "combos"} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="coherence" tabId="index" activeId={section}>
        <IndexPane active={active && section === "index"} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="coherence" tabId="calibration" activeId={section}>
        <CalibrationPane active={active && section === "calibration"} />
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
