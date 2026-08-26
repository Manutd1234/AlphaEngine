/**
 * One command-palette entry per addressable VIEW, generated from the table.
 *
 * The palette reads its sections from `lib/sections.ts` so a renamed section
 * cannot leave a stale command behind, and it read nothing below a section: a
 * reader who could reach Proofs → Coherence test → Proof by a press could not
 * find it by name. Views are addresses now (`lib/section-views.ts`), so they
 * are commands — one per NON-DEFAULT view, because the section's own entry
 * already opens the default and two rows that open the same place are noise.
 *
 * Ids carry a `view-` prefix so `workspace-commands-unique`'s count of `sec-`
 * entries — one per rail section, the shape a nesting bug once broke — stays
 * exactly what it was. Labels follow the nav row's word for the tab ("Proofs",
 * "Markets") for the reason `buildCommands` records: a reader searches for the
 * word they can see.
 */

import type { WorkspaceView } from "@/components/WorkspaceHeader";
import { COHERENCE_SECTIONS, MARKETS_SECTIONS, type CoherenceSection, type MarketsSection } from "@/lib/sections";
import { defaultView, locationHash, viewsFor } from "@/lib/section-views";
import { NAV_ITEMS } from "@/lib/workspace-nav";
import type { Command } from "@/components/header/CommandBar";

export interface ViewCommandDeps {
  navigate: (view: WorkspaceView, replace?: boolean, detail?: { apply: () => void; hash: string }) => void;
  setMarketsSection: (section: MarketsSection) => void;
  setCoherenceSection: (section: CoherenceSection) => void;
  setSectionView: (tab: WorkspaceView, section: string, view: string) => void;
}

export function viewCommands({ navigate, setMarketsSection, setCoherenceSection, setSectionView }: ViewCommandDeps): Command[] {
  const rails: Array<[WorkspaceView, ReadonlyArray<{ id: string; label: string }>, (id: string) => void]> = [
    ["markets", MARKETS_SECTIONS, (id) => setMarketsSection(id as MarketsSection)],
    ["coherence", COHERENCE_SECTIONS, (id) => setCoherenceSection(id as CoherenceSection)],
  ];
  const out: Command[] = [];
  for (const [tab, rail, setSection] of rails) {
    const word = NAV_ITEMS.find((item) => item.id === tab)?.label ?? tab;
    for (const section of rail) {
      for (const [id, label] of viewsFor(tab, section.id)) {
        if (id === defaultView(tab, section.id)) continue;
        out.push({
          id: `view-${tab}-${section.id}-${id}`,
          label: `${word} → ${section.label} → ${label}`,
          category: "View",
          action: () => navigate(tab, false, {
            apply: () => { setSection(section.id); setSectionView(tab, section.id, id); },
            hash: locationHash(tab, section.id, id),
          }),
        });
      }
    }
  }
  return out;
}
