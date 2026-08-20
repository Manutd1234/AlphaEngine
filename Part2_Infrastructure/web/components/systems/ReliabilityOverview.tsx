"use client";

/**
 * Triage landing view for the Reliability workspace.
 *
 * ConsoleChrome owns the one status summary. This section starts where a
 * compact strip should stop: active symptoms, evidence boundaries and the next
 * safe investigation step. It deliberately does not repeat golden signals or
 * the provider table that already lives in Services & Circuits.
 *
 * The section is one derivation in two locations, and this file is now the
 * seam between them rather than both halves of it. `attention` is triage and
 * the incident path; `planes` is what the system depends on and what the
 * snapshot can prove — the tab was a single screen of five stacked
 * card-sections before the split, and this file was 760 lines before it passed
 * the ceiling a second time.
 *
 * Each half is CONDITIONALLY MOUNTED, not `hidden`. The halves used to share
 * one component so both derived everything on every render; now each derives
 * only its own figures, from the same shared health snapshot, so they still
 * cannot disagree — and the half that is not on screen holds no
 * ResizeObserver, no socket and no state.
 */

import ReliabilityAttention from "@/components/systems/ReliabilityAttention";
import ReliabilityPlanes from "@/components/systems/ReliabilityPlanes";
import type { SystemHealthView } from "@/lib/use-system-health";

export type ReliabilityDrilldown = "services" | "events" | "controls";

interface ReliabilityOverviewProps {
  view: SystemHealthView;
  onOpenSection: (section: ReliabilityDrilldown) => void;
  onOpenData: () => void;
  /** `attention` is triage and the incident path; `planes` is what the system
   *  depends on and what the snapshot can prove. */
  part?: "attention" | "planes";
}

export default function ReliabilityOverview({
  view,
  onOpenSection,
  onOpenData,
  part = "attention",
}: ReliabilityOverviewProps) {
  if (part === "planes") {
    return <ReliabilityPlanes view={view} onOpenSection={onOpenSection} onOpenData={onOpenData} />;
  }
  return <ReliabilityAttention view={view} onOpenSection={onOpenSection} onOpenData={onOpenData} />;
}
