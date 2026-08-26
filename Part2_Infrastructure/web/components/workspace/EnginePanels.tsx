"use client";

/**
 * The Kalshi engine's three tab panels — Quotes, Proofs, Diffusion.
 *
 * Split out of `WorkspacePanels.tsx` on 2026-08-25, when Diffusion became the
 * eleventh tab and that file stood at 399 of the four-hundred-line ceiling. The
 * seam is one the desk already draws everywhere else: eight tabs are the
 * decision loop a role walks, and these three are the engine that argues about
 * an exchange. `desk-sweep-plan.mjs` groups them this way, `sections.ts` keeps
 * their rails together as `ENGINE_SECTIONS`, and the density partials are cut
 * on the same line.
 *
 * Every panel keeps the shape the other eight have and it is load-bearing in
 * two ways. It renders only once VISITED — so a reader who never opens
 * Diffusion never pays for its chunk — and it stays mounted behind `hidden`
 * afterwards, which is what makes in-pane view state survive a tab switch. A
 * reader who picks a family on Proofs, reads Quotes, and comes back finds the
 * family they picked.
 */

import NextStepFooter from "@/components/common/NextStepFooter";
import { CoherenceTab, DiffusionTab, MarketsTab } from "./lazy-panels";
import type { WorkspaceView } from "@/lib/workspace-nav";
import type { CoherenceSection, DiffusionSection, MarketsSection } from "@/lib/sections";

export interface EnginePanelsProps {
  view: WorkspaceView;
  /** Which tabs have ever been opened; a tab renders nothing until it is in here. */
  visited: Set<string>;
  // The section UNIONS, not `string`. A panel handed a widened setter would
  // accept an id its own rail does not have, which is the one mistake the rail
  // types exist to make impossible.
  marketsSection: MarketsSection;
  /** Which view each section is standing on, per view-declaring tab, keyed by section id. */
  sectionViews: Record<string, Record<string, string>>;
  setSectionView: (tab: WorkspaceView, section: string, view: string) => void;
  coherenceSection: CoherenceSection;
  diffusionSection: DiffusionSection;
  changeMarketsSection: (section: MarketsSection) => void;
  changeCoherenceSection: (section: CoherenceSection) => void;
  changeDiffusionSection: (section: DiffusionSection) => void;
  openSection: (view: WorkspaceView, section?: string) => void;
}

export default function EnginePanels({
  view,
  visited,
  marketsSection,
  sectionViews,
  setSectionView,
  coherenceSection,
  diffusionSection,
  changeMarketsSection,
  changeCoherenceSection,
  changeDiffusionSection,
  openSection,
}: EnginePanelsProps) {
  return (
    <>
      {(view === "markets" || visited.has("markets")) && (
        <section id="panel-markets" role="tabpanel" aria-labelledby="tab-markets" className="view-panel" hidden={view !== "markets"}>
          <MarketsTab
            section={marketsSection}
            onSectionChange={changeMarketsSection}
            views={sectionViews.markets ?? {}}
            onViewChange={(section, next) => setSectionView("markets", section, next)}
            active={view === "markets"}
          />
          <NextStepFooter currentView="markets" currentSection={marketsSection} onNavigate={openSection} />
        </section>
      )}

      {(view === "coherence" || visited.has("coherence")) && (
        <section id="panel-coherence" role="tabpanel" aria-labelledby="tab-coherence" className="view-panel" hidden={view !== "coherence"}>
          <CoherenceTab
            section={coherenceSection}
            onSectionChange={changeCoherenceSection}
            views={sectionViews.coherence ?? {}}
            onViewChange={(section, next) => setSectionView("coherence", section, next)}
            onOpenSection={openSection}
            active={view === "coherence"}
          />
          <NextStepFooter currentView="coherence" currentSection={coherenceSection} onNavigate={openSection} />
        </section>
      )}

      {(view === "diffusion" || visited.has("diffusion")) && (
        <section id="panel-diffusion" role="tabpanel" aria-labelledby="tab-diffusion" className="view-panel" hidden={view !== "diffusion"}>
          <DiffusionTab
            section={diffusionSection}
            onSectionChange={changeDiffusionSection}
            active={view === "diffusion"}
          />
          <NextStepFooter currentView="diffusion" currentSection={diffusionSection} onNavigate={openSection} />
        </section>
      )}
    </>
  );
}
