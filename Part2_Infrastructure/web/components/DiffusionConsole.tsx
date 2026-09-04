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
 * It had also stopped fitting. Before extraction, four groups over eleven views
 * were a rail's worth of subject behind one section's button, and had grown a
 * THIRD switcher level to hold the findings — carried in
 * `coherence-sections.test.ts` as a named exemption because there was nowhere
 * else for it to go. The current tab has seven sections and sixteen addressable
 * views; each section has one rail row and at most one view row, so the
 * exemption is gone.
 *
 * THE TAB ID IS `diffusion`, WHICH WAS A SECTION ID. `#coherence/diffusion` and
 * `#coherence/findings` are links someone holds, and both cross tabs now — the
 * one move `RELOCATED_SECTIONS` cannot stop being needed for, because the URL
 * is wrong about the TAB and only a lookup can say so.
 *
 * READS ARE GATED ON THE SECTIONS THAT DRAW THEM. `arm` and `meetings` share
 * the cached absorption ledger; `episodes` owns the violation, status and index
 * reads; `findings` owns its study read. `model`, `instrument` and `sandbox`
 * read nothing at all because their views compute in the browser from
 * `lib/coherence/diffusion-model` — a gateway call there would contradict what
 * those sections demonstrate.
 */

import { useCallback, useMemo, useState } from "react";

import PageHead from "@/components/workspace/PageHead";
import WorkspaceSubtabs, { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
import FreshnessStamp from "@/components/workspace/FreshnessStamp";
import ArmSection from "@/components/coherence/diffusion/ArmSection";
import type { ArmView } from "@/components/coherence/diffusion/ArmSection";
import EpisodesSection from "@/components/coherence/diffusion/EpisodesSection";
import type { EpisodeView } from "@/components/coherence/diffusion/EpisodesSection";
import FindingsSection from "@/components/coherence/diffusion/FindingsSection";
import type { FindingsView } from "@/components/coherence/diffusion/FindingsPane";
import InstrumentSection from "@/components/coherence/diffusion/InstrumentSection";
import MeetingsSection from "@/components/coherence/diffusion/MeetingsSection";
import type { MeetingsView } from "@/components/coherence/diffusion/MeetingsSection";
import ModelSection from "@/components/coherence/diffusion/ModelSection";
import SandboxSection from "@/components/coherence/diffusion/SandboxSection";
import type { SandboxView } from "@/components/coherence/diffusion/SandboxSection";
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
  views: Record<string, string>;
  onViewChange: (section: string, view: string) => void;
  section: DiffusionSection;
  onSectionChange: (section: DiffusionSection) => void;
  /** False while another tab is in front: every poll here is gated on it. */
  active?: boolean;
}

function dateFromNanoseconds(value: number | null | undefined): Date | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return new Date(value / 1_000_000);
}

function DataModeStamp({ label, detail }: { label: string; detail: string }) {
  return (
    <span className="freshness-stamp">
      <i aria-hidden />
      <span><strong>{label}</strong></span>
      <small>{detail}</small>
    </span>
  );
}

export default function DiffusionConsole({
  section, onSectionChange, views, onViewChange, active = true,
}: DiffusionConsoleProps) {
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
    if (section === "episodes") {
      const recorder = status.data?.recorder;
      return [
        {
          label: "Live recorder",
          value: recorder == null ? "—" : recorder.running ? "running" : recorder.configured ? "stopped" : "not configured",
          note: recorder ? `fixed cadence every ${recorder.poll_seconds} seconds; ${recorder.consecutive_failures} consecutive failures` : "recorder state has not arrived",
        },
        {
          label: "Series observed",
          value: recorder == null ? "—" : String(recorder.series_seen.length),
          note: "live Kalshi series seen by this recorder process",
        },
        {
          label: "Index window",
          value: index.data == null ? "—" : `${index.data.points.length} points`,
          note: "latest recorded coherence readings, not a historical first page",
        },
      ];
    }

    if (section === "model" || section === "instrument" || section === "sandbox") {
      return [
        { label: "Data mode", value: "browser-computed", note: "reference formulas in this bundle; no market-data claim" },
        { label: "Update", value: "immediate", note: "recomputed whenever an input changes" },
        { label: "Live prices", value: "not read", note: "these sections demonstrate the estimator, not a venue feed" },
      ];
    }

    if (section === "findings") {
      return [
        { label: "Data mode", value: "recorded study", note: "the study API is checked while this section is open" },
        { label: "Refresh", value: "20 seconds", note: "new backend findings appear without reloading the page" },
        { label: "Live prices", value: "not used", note: "findings are out-of-sample historical evidence" },
      ];
    }

    const runs = absorption.data?.state === "ok" ? absorption.data.runs : null;
    const hasControls = runs ? runs.some((run) => run.controls_used > 0) : null;
    return [
      {
        label: "Runs recorded",
        value: runs == null ? "—" : String(runs.length),
        note: runs == null ? "not read on this section" : "recorded stage windows, including refusals",
      },
      {
        label: "Control arm",
        value: hasControls == null ? "—" : hasControls ? "matched windows" : "configured, empty",
        note: hasControls
          ? "quiet half-hours the same estimator is run over"
          : hasControls === false
            ? "no matched control window has been recorded"
            : "not read on this section",
      },
      {
        label: "Estimator",
        value: "in the browser",
        note: "the estimator's own arithmetic, computed here rather than fetched",
      },
    ];
  }, [absorption.data, index.data, section, status.data]);

  const recorderPollMs = status.data?.recorder.poll_seconds
    ? status.data.recorder.poll_seconds * 1_000
    : 60_000;
  const headerAction = section === "episodes" ? (
    <FreshnessStamp
      updatedAt={dateFromNanoseconds(status.data?.recorder.last_poll_ts_ns)}
      pollMs={recorderPollMs}
      paused={!active}
      label="Live recorder"
      transport="poll"
    />
  ) : section === "arm" || section === "meetings" ? (
    <FreshnessStamp
      updatedAt={absorption.updatedAt}
      pollMs={COHERENCE_POLL_MS}
      paused={!active}
      label="Study API checked"
      transport="poll"
    />
  ) : section === "findings" ? (
    <DataModeStamp label="Recorded study" detail="API-polled every 20 s while open" />
  ) : (
    <DataModeStamp label="Browser-computed" detail="updates immediately; no API read" />
  );

  const openSection = (next: DiffusionSection) => {
    onSectionChange(next);
    requestAnimationFrame(() => document.getElementById(`diffusion-subtab-${next}`)?.focus());
  };
  const warmSection = useCallback((next: DiffusionSection) => {
    for (const url of SECTION_READS[next]) warmCoherenceRead(url);
  }, []);
  const changeArmView = useCallback(
    (next: ArmView) => onViewChange("arm", next),
    [onViewChange],
  );
  const changeMeetingsView = useCallback(
    (next: MeetingsView) => onViewChange("meetings", next),
    [onViewChange],
  );
  const changeEpisodeView = useCallback(
    (next: EpisodeView) => onViewChange("episodes", next),
    [onViewChange],
  );
  const changeSandboxView = useCallback(
    (next: SandboxView) => onViewChange("sandbox", next),
    [onViewChange],
  );
  const changeFindingsView = useCallback(
    (next: FindingsView) => onViewChange("findings", next),
    [onViewChange],
  );

  return (
    <div className="coherence-plane diffusion-plane">
      <PageHead
        kicker="Diffusion"
        title="How fast information reaches the price"
        description="Both arms estimate when the move is finished against matched no-news windows in which no announcement occurred."
        actions={headerAction}
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
        <ArmSection data={absorption.data} error={absorption.error}
                    view={views.arm as ArmView} onView={changeArmView} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="diffusion" tabId="meetings" activeId={section}>
        <MeetingsSection data={absorption.data} error={absorption.error}
                         view={views.meetings as MeetingsView} onView={changeMeetingsView} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="diffusion" tabId="episodes" activeId={section}>
        <EpisodesSection data={episodes.data} error={episodes.error} status={status.data} index={index.data}
                         view={views.episodes as EpisodeView} onView={changeEpisodeView} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="diffusion" tabId="model" activeId={section}>
        <ModelSection />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="diffusion" tabId="instrument" activeId={section}>
        <InstrumentSection />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="diffusion" tabId="sandbox" activeId={section}>
        <SandboxSection view={views.sandbox as SandboxView} onView={changeSandboxView} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="diffusion" tabId="findings" activeId={section}>
        <FindingsSection active={active && section === "findings"}
                         view={views.findings as FindingsView} onView={changeFindingsView} />
      </WorkspaceSubtabPanel>
    </div>
  );
}
