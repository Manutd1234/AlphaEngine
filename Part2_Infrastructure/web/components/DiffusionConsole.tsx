"use client";

/**
 * Diffusion — how fast anything the market did not know reaches the price.
 *
 * A TAB SINCE 2026-08-25, and the argument for that is what it is NOT. Every
 * section of Proofs argues from one poll of the exchange: does this family's
 * prices admit a probability, what portfolio does the failure hand back, how
 * far from coherent are the quotes right now. This argues from a recorded
 * research panel — two hundred runs, a control arm of matched windows with no
 * news in them, an out-of-sample verdict — and answers a question about
 * DURATION rather than about what a price implies. It shared a rail with the
 * coherence engine because both are research, which is a category rather than a
 * question.
 *
 * It had also stopped fitting. Four groups over eleven views is a rail's worth
 * of subject behind one section's button, and it had grown a THIRD switcher
 * level to hold the findings — carried in `coherence-sections.test.ts` as a
 * named exemption because there was nowhere else for it to go. There is now:
 * four sections, one control row each, and the exemption is deleted.
 *
 * THE TAB ID IS `diffusion`, WHICH WAS A SECTION ID. `#coherence/diffusion` and
 * `#coherence/findings` are links someone holds, and both cross tabs now — the
 * one move `RELOCATED_SECTIONS` cannot stop being needed for, because the URL
 * is wrong about the TAB and only a lookup can say so.
 *
 * TWO READS, EACH GATED ON THE ONE SECTION THAT DRAWS IT. `arm` is the
 * absorption ledger and `episodes` the violation tape; `model` reads nothing at
 * all, because every view in it computes in the browser from
 * `lib/coherence/diffusion-model` — which is the point that group makes, and a
 * gateway call there would contradict it. `findings` owns its own read.
 */

import { useCallback, useMemo, useState } from "react";

import PageHead from "@/components/workspace/PageHead";
import WorkspaceSubtabs, { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
import FreshnessStamp from "@/components/workspace/FreshnessStamp";
import ArmSection from "@/components/coherence/diffusion/ArmSection";
import EpisodesSection from "@/components/coherence/diffusion/EpisodesSection";
import FindingsSection from "@/components/coherence/diffusion/FindingsSection";
import InstrumentSection from "@/components/coherence/diffusion/InstrumentSection";
import MeetingsSection from "@/components/coherence/diffusion/MeetingsSection";
import ModelSection from "@/components/coherence/diffusion/ModelSection";
import SandboxSection from "@/components/coherence/diffusion/SandboxSection";
import { DIFFUSION_SECTIONS, type DiffusionSection } from "@/lib/sections";
import { absorptionRoute, episodesRoute, findingsRoute, indexRoute, statusRoute } from "@/lib/coherence/routes";
import { COHERENCE_POLL_MS, useCoherenceRead, warmCoherenceRead } from "@/lib/coherence/use-coherence";
import type { AbsorptionRead } from "@/components/coherence/diffusion/types";
import type { CoherenceEpisodes, CoherenceIndexSeries, CoherenceStatus } from "@/lib/coherence/types";
import { useSectionWarming } from "@/lib/coherence/use-section-warming";

export { type DiffusionSection } from "@/lib/sections";

/**
 * What each section asks for the moment it opens.
 *
 * THREE EMPTY LISTS, and each is a decision rather than an oversight, which is
 * why each is stated here in its own words rather than sharing one sentence.
 *
 * `model` draws the seven measurement cards from a literal in this bundle.
 * `instrument` draws the six instrument cards from
 * the same literal in this bundle.
 * `sandbox` is the half-life crossing, the simulated path and the spectrum,
 * computed on a slider a reader moves.
 *
 * Each computes in the browser from `lib/coherence/diffusion-model`, the
 * TypeScript port a committed parity fixture holds to the Python reference —
 * and the reason those sections exist is to show that the closed form ships
 * before the model does, so a gateway call in any of the three would contradict
 * what they demonstrate.
 *
 * `arm` and `meetings` NAME THE SAME URL, and that is free rather than
 * wasteful: `read-cache.ts` holds one payload per URL and joins a read already
 * in flight, and `useSectionWarming` de-duplicates the sweep. So the second
 * section spends no request and opens warm off the first.
 */
const SECTION_READS: Record<DiffusionSection, readonly string[]> = {
  arm: [absorptionRoute()],
  meetings: [absorptionRoute()],
  episodes: [episodesRoute(), statusRoute(), indexRoute()],
  model: [],
  instrument: [],
  sandbox: [],
  findings: [findingsRoute()],
};

export interface DiffusionConsoleProps {
  section: DiffusionSection;
  onSectionChange: (section: DiffusionSection) => void;
  /** False while another tab is in front: every poll here is gated on it. */
  active?: boolean;
}

export default function DiffusionConsole({ section, onSectionChange, active = true }: DiffusionConsoleProps) {
  const absorption = useCoherenceRead<AbsorptionRead>(
    absorptionRoute(),
    active && (section === "arm" || section === "meetings"),
  );
  const episodes = useCoherenceRead<CoherenceEpisodes>(episodesRoute(), active && section === "episodes");
  // The recorder's own state, read beside the tape. An empty tape is the LIVE
  // case on most deployments, and "nothing has closed yet" is a report rather
  // than an absence only if the watch behind it can be counted.
  const status = useCoherenceRead<CoherenceStatus>(statusRoute(), active && section === "episodes");
  // The coherence index is the PRECURSOR the episode ledger is downstream of:
  // live where that ledger is empty, and the honest answer to why it is empty.
  const index = useCoherenceRead<CoherenceIndexSeries>(indexRoute(), active && section === "episodes");

  useSectionWarming(SECTION_READS, active);

  const metrics = useMemo(() => {
    const runs = absorption.data?.runs?.length ?? null;
    return [
      {
        label: "Runs recorded",
        value: runs == null ? "—" : String(runs),
        note: runs == null ? "not read on this section" : "announcement windows with a measured stage",
      },
      {
        label: "Control arm",
        value: absorption.data ? "matched windows" : "—",
        note: "quiet half-hours the same estimator is run over",
      },
      {
        label: "Estimator",
        value: "in the browser",
        note: "the estimator's own arithmetic, computed here rather than fetched",
      },
    ];
  }, [absorption.data]);

  const openSection = (next: DiffusionSection) => {
    onSectionChange(next);
    requestAnimationFrame(() => document.getElementById(`diffusion-subtab-${next}`)?.focus());
  };
  const warmSection = useCallback((next: DiffusionSection) => {
    for (const url of SECTION_READS[next]) warmCoherenceRead(url);
  }, []);

  return (
    <div className="coherence-plane diffusion-plane">
      <PageHead
        kicker="Diffusion"
        title="How fast information reaches the price"
        description="Both arms measure how long until the move is finished, against a control of matched windows in which nothing happened."
        actions={
          <FreshnessStamp updatedAt={absorption.updatedAt} pollMs={COHERENCE_POLL_MS} paused={!active} transport="poll" />
        }
        metrics={metrics}
      />

      <WorkspaceSubtabs
        workspaceId="diffusion"
        label="Diffusion sections"
        tabs={DIFFUSION_SECTIONS}
        activeId={section}
        onChange={openSection}
        onIntent={warmSection}
        secondary={["model", "instrument", "sandbox"]}
        active={active}
      />

      <WorkspaceSubtabPanel workspaceId="diffusion" tabId="arm" activeId={section}>
        <ArmSection data={absorption.data} error={absorption.error} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="diffusion" tabId="meetings" activeId={section}>
        <MeetingsSection data={absorption.data} error={absorption.error} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="diffusion" tabId="episodes" activeId={section}>
        <EpisodesSection data={episodes.data} error={episodes.error} status={status.data} index={index.data} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="diffusion" tabId="model" activeId={section}>
        <ModelSection />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="diffusion" tabId="instrument" activeId={section}>
        <InstrumentSection />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="diffusion" tabId="sandbox" activeId={section}>
        <SandboxSection />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="diffusion" tabId="findings" activeId={section}>
        <FindingsSection active={active && section === "findings"} />
      </WorkspaceSubtabPanel>
    </div>
  );
}
