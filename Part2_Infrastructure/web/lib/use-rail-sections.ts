"use client";

/**
 * Where the reader is inside each tab, and how a URL puts them there.
 *
 * Split out of `lib/use-workspace-routing.ts` when the ninth tab arrived and
 * that file reached its length ceiling. The split is along a real seam rather
 * than at a convenient line: everything here answers "which section of which
 * tab", and everything left behind answers "how does the reader move" —
 * navigation, history, the tour, the scroll container, what has been visited.
 *
 * One rule holds this file together: a tab's section state, its entry in the
 * live-section ref, and its entry in the applier table must all arrive
 * together. Two of the three is a tab that routes but does not restore, or one
 * that restores to a section it never renders — both of which look like a
 * working tab until someone follows a link into it.
 *
 * The hooks here are called unconditionally and in a fixed order, so lifting
 * them out cannot change how many hooks the workspace runs on a given render.
 * `tests/workspace-routing-hook-order.test.ts` is the guard on that.
 */

import { useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import type { WorkspaceView } from "@/components/WorkspaceHeader";
import {
  COHERENCE_SECTION_IDS,
  DIFFUSION_SECTION_IDS,
  DATA_SECTION_IDS,
  DEVELOPER_SECTION_IDS,
  EXECUTION_SECTION_IDS,
  MARKETS_SECTION_IDS,
  OVERVIEW_SECTION_IDS,
  PORTFOLIO_SECTION_IDS,
  RELIABILITY_SECTION_IDS,
  RESEARCH_SECTION_IDS,
  RISK_SECTION_IDS,
  type CoherenceSection,
  type DiffusionSection,
  type DataSection,
  type DeveloperSection,
  type ExecutionSection,
  type MarketsSection,
  type OverviewSection,
  type PortfolioSection,
  type ReliabilitySection,
  type ResearchSection,
  type RiskSection,
} from "@/lib/sections";
import { DEFAULT_SECTION, railSection, type SectionApplier } from "@/lib/workspace-hash";

export interface RailSections {
  overviewSection: OverviewSection;
  researchSection: ResearchSection;
  executionSection: ExecutionSection;
  dataSection: DataSection;
  reliabilitySection: ReliabilitySection;
  developerSection: DeveloperSection;
  marketsSection: MarketsSection;
  coherenceSection: CoherenceSection;
  diffusionSection: DiffusionSection;
  riskSection: RiskSection;
  portfolioSection: PortfolioSection;
  setOverviewSection: Dispatch<SetStateAction<OverviewSection>>;
  setResearchSection: Dispatch<SetStateAction<ResearchSection>>;
  setExecutionSection: Dispatch<SetStateAction<ExecutionSection>>;
  setDataSection: Dispatch<SetStateAction<DataSection>>;
  setReliabilitySection: Dispatch<SetStateAction<ReliabilitySection>>;
  setDeveloperSection: Dispatch<SetStateAction<DeveloperSection>>;
  setMarketsSection: Dispatch<SetStateAction<MarketsSection>>;
  setCoherenceSection: Dispatch<SetStateAction<CoherenceSection>>;
  setDiffusionSection: Dispatch<SetStateAction<DiffusionSection>>;
  setRiskSection: Dispatch<SetStateAction<RiskSection>>;
  setPortfolioSection: Dispatch<SetStateAction<PortfolioSection>>;
  /** Live section per workspace, readable from handlers created once. */
  sectionByViewRef: MutableRefObject<Record<WorkspaceView, string>>;
  /** Does this workspace have a section by this name, and how is it applied. */
  applier: Record<WorkspaceView, SectionApplier>;
}

export function useRailSections(): RailSections {
  const [overviewSection, setOverviewSection] = useState<OverviewSection>("loop");
  const [researchSection, setResearchSection] = useState<ResearchSection>("summary");
  const [executionSection, setExecutionSection] = useState<ExecutionSection>("trade");
  const [dataSection, setDataSection] = useState<DataSection>("overview");
  const [reliabilitySection, setReliabilitySection] = useState<ReliabilitySection>("overview");
  const [developerSection, setDeveloperSection] = useState<DeveloperSection>("overview");
  const [marketsSection, setMarketsSection] = useState<MarketsSection>("universe");
  // Not "universe" any more: that section is on the Prices rail, and this tab
  // (`coherence`, labelled "Proofs") opens on the test it is named for. The
  // two states below are per-TAB, so a reader who moves inside Prices and
  // comes back to Proofs finds the section they left rather than a default.
  const [coherenceSection, setCoherenceSection] = useState<CoherenceSection>("certificate");
  const [diffusionSection, setDiffusionSection] = useState<DiffusionSection>("arm");
  // Risk and Portfolio kept these internally, which made them the only two
  // steppers in the workspace that a link could not address: `#risk/model`
  // opened the tab on step 1. Lifted here so they route exactly like the other
  // seven — pushed on change, and restored by `readLocation` on back/forward.
  const [riskSection, setRiskSection] = useState<RiskSection>("limits");
  const [portfolioSection, setPortfolioSection] = useState<PortfolioSection>("overview");

  /**
   * A ref, not state, because `navigate` must see the CURRENT section at click
   * time to write a truthful hash — its useCallback would otherwise capture the
   * mount-time values forever.
   */
  const sectionByViewRef = useRef<Record<WorkspaceView, string>>({ ...DEFAULT_SECTION });
  sectionByViewRef.current = {
    overview: overviewSection,
    research: researchSection,
    live: executionSection,
    portfolio: portfolioSection,
    risk: riskSection,
    data: dataSection,
    reliability: reliabilitySection,
    developer: developerSection,
    markets: marketsSection,
    diffusion: diffusionSection,
    coherence: coherenceSection,
  };

  /**
   * One table, read by both `readLocation` and `openSection`.
   *
   * They ask the same question and answered it in two hand-written switches
   * before, so a renamed rail could be handled one way by the URL and another
   * by a cross-link. The setters are stable, so this is built once.
   */
  const applier = useMemo<Record<WorkspaceView, SectionApplier>>(() => {
    const bind = <T extends string>(ids: readonly T[], set: (id: T) => void): SectionApplier =>
      (section) => {
        const id = railSection(ids, section);
        return id === null ? null : () => set(id);
      };
    return {
      overview: bind(OVERVIEW_SECTION_IDS, setOverviewSection),
      research: bind(RESEARCH_SECTION_IDS, setResearchSection),
      live: bind(EXECUTION_SECTION_IDS, setExecutionSection),
      portfolio: bind(PORTFOLIO_SECTION_IDS, setPortfolioSection),
      risk: bind(RISK_SECTION_IDS, setRiskSection),
      data: bind(DATA_SECTION_IDS, setDataSection),
      reliability: bind(RELIABILITY_SECTION_IDS, setReliabilitySection),
      developer: bind(DEVELOPER_SECTION_IDS, setDeveloperSection),
      markets: bind(MARKETS_SECTION_IDS, setMarketsSection),
      coherence: bind(COHERENCE_SECTION_IDS, setCoherenceSection),
      diffusion: bind(DIFFUSION_SECTION_IDS, setDiffusionSection),
    };
  }, []);

  return {
    overviewSection, researchSection, executionSection, dataSection, reliabilitySection,
    developerSection, marketsSection, coherenceSection, diffusionSection, riskSection, portfolioSection,
    setOverviewSection, setResearchSection, setExecutionSection, setDataSection,
    setReliabilitySection, setDeveloperSection, setMarketsSection, setCoherenceSection, setDiffusionSection, setRiskSection,
    setPortfolioSection, sectionByViewRef, applier,
  };
}
