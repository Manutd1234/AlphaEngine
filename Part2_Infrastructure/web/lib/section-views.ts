/**
 * The views inside a section, and the third segment of the hash that names one.
 *
 * `lib/sections.ts` is the single source for the rails: which sections a tab
 * has, in what order, under what label. This is the level below it — which
 * VIEWS a section draws — and it exists for the same reason that file does. The
 * eight Prices sections carry twenty-five views between them, and seventeen of
 * those were component state: not in the URL, not in the command palette, and
 * not walked by `scripts/desk-sweep.mjs`, whose count was 70 rather than the
 * number of destinations a reader can actually reach. A view could break and
 * stay broken with every suite green, because nothing could open it.
 *
 * THE THIRD SEGMENT IS OPAQUE TO THE ROUTER. `followLocation` carries the
 * string and hands it to the tab; the TAB resolves it. This is cheap
 * future-proofing rather than a response to a case that exists: every consumer
 * on the desk today — the eight Prices sections and the five Diffusion ones —
 * is ONE picker over FLAT views, which a router that understood the segment
 * itself would model perfectly well. It is written this way because the router
 * gains nothing from knowing, and a tab that later wants a different meaning
 * changes its own table instead of this module.
 *
 * IT IS NOT WRITTEN THIS WAY BECAUSE OF `FindingsPane`, and the correction is
 * recorded because the wrong version was nearly committed. That pane was cited
 * as three views nested inside one section; it is `useState<"plot" | "table" |
 * "instrument">` at `FindingsPane.tsx:69` — a flat three-way picker,
 * structurally identical to `ArmSection`, fully expressed by
 * `#diffusion/findings/plot`. The nesting it once had was deliberately removed
 * on 2026-08-25, so a `<view>.<sub>` vocabulary would have put back into the
 * URL exactly the third control level the tree had just finished deleting.
 * What IS unusual about that pane is orthogonal: its switcher lives in a folded
 * pane rather than on the parent's row, which `coherence-sections.test.ts`
 * carries as a named exemption.
 *
 * SO A TAB THAT DECLARES NOTHING HERE IS UNTOUCHED. `railView` answers `null`
 * for it, `followLocation` skips the view step, and every existing link behaves
 * exactly as it did. Prices is the first adopter; Diffusion has five sections
 * carrying local view state and is the intended second, and designing against
 * both is what stops this becoming a Prices-shaped rule that the next tab has
 * to escape.
 *
 * THE DEFAULT IS THE FIRST VIEW LISTED. Not a separate field, because two
 * places to say the same thing is two places to disagree, and the failure is
 * silent: the switcher opens on one view and the URL says another. The order
 * here is the order the buttons are pressed in, so the first entry is what a
 * reader lands on either way.
 *
 * WHAT MUST NOT BREAK. A bare `#markets/fees` still opens Fees. An unknown or
 * stale view falls back to the section's own default rather than to a blank
 * pane. A section never accepts a sibling's view id — `reading` is a real view
 * of both Settlement and Shell, and they are different places. Each of those is
 * a link somebody may already hold, and a third segment that could strand a
 * two-segment link would be a worse defect than the one it fixes.
 */

import type { WorkspaceView } from "@/components/WorkspaceHeader";
import { LESSON_GROUPS } from "@/lib/coherence/lessons";

/** A view's URL id and the word on its button, in the order they are pressed. */
export type SectionViewDef = readonly [id: string, label: string];

/**
 * Prices, section by section.
 *
 * Every id here is what the section's own switcher already uses, so nothing is
 * renamed into existence: these strings were component state yesterday and are
 * addresses today. `section-views.test.ts` reads each owning component and
 * fails if a declared default drifts from the one the component opens on.
 */
const MARKETS_VIEWS = {
  universe: [["baskets", "Baskets"], ["families", "Families"]],
  settlement: [["reading", "Index"], ["formation", "Formation"], ["pending", "Pending"]],
  books: [["ladder", "Ladder"], ["identity", "Identity"], ["history", "History"]],
  // The id is `dispersion` and the label is "Makers", which is house practice on
  // this rail rather than drift — `live` renders "Execution", `activity` renders
  // "Blotter". Its two view ids keep the same split.
  dispersion: [["quotes", "Dispersion"], ["channel", "Channel"]],
  lattice: [["survival", "Survival"], ["mass", "Mass"], ["moments", "Moments"]],
  stake: [["plan", "Plan"], ["capital", "Capital"], ["method", "Method"], ["family", "All outcomes"]],
  fees: [["example", "Worked example"], ["shape", "Cost shape"], ["comparison", "Ablation"], ["table", "Replay table"]],
  // TWO SINCE 2026-08-26. `reading` merged into `tree` (selecting a file was
  // already switching the view for the reader) and `commands` onto `layout`
  // (both read nothing and answer what the filesystem IS). Neither id is
  // reachable now, and neither needs an entry anywhere: `railView` falls back
  // to the section's default for a view it does not have, so `#markets/shell/
  // commands` opens Map — the section that absorbed it — rather than nothing.
  shell: [["layout", "Map"], ["tree", "Browse"]],
} as const satisfies Record<string, readonly SectionViewDef[]>;

/**
 * Proofs, section by section — the second adopter, 2026-08-26.
 *
 * Every id is the string the section's own `useState` used to hold, so nothing
 * is renamed into existence; the labels are the ones `coherence-sections`
 * pins. `portfolio` declares none: Basket is single-view until its redo, and
 * `section-views.test.ts` names it so. Lessons' six ids come from the data —
 * the four slices are `LESSON_GROUPS`, and the two views ABOUT the catalogue
 * follow them, in the order the row presses.
 */
const COHERENCE_VIEWS = {
  certificate: [["verdict", "Verdict"], ["proof", "Proof"], ["prices", "Prices"]],
  portfolio: [["cover", "Cover"], ["basket", "Basket"], ["size", "Size"]],
  combos: [["bands", "Bands"], ["parlays", "Parlays"], ["bounds", "Bounds"]],
  index: [["series", "By poll"], ["families", "By family"]],
  calibration: [["score", "Score"], ["bands", "Bands"]],
  corpus: [["composition", "Composition"], ["trend", "Score trend"]],
  lessons: [
    ...LESSON_GROUPS.map((group) => [group.id, group.label] as const),
    ["coverage", "Coverage"],
    ["states", "Episode states"],
  ],
} as const satisfies Record<string, readonly SectionViewDef[]>;

/**
 * Where the default is NOT the first view listed, and why.
 *
 * Lessons puts its four curriculum slices first in the row — "segregate the
 * content better", the reader's own 2026-08-26 reorder — and still opens on
 * Coverage, the map of the catalogue. The doctrine above ("the default is the
 * first listed") exists so two places cannot disagree; an exception written
 * down beside the table is one place, and the test pins the exception and its
 * id so a future reorder cannot move the landing view by accident. The table
 * describes the desk; it does not legislate it.
 */
const DEFAULTS: Partial<Record<WorkspaceView, Record<string, string>>> = {
  coherence: { lessons: "coverage" },
};

/**
 * Every tab that has taught the hash about its views.
 *
 * Two entries. A tab joins by adding its table and nothing else — the router,
 * the sweep and the palette all read this rather than a list of their own,
 * which is the drift `lib/sections.ts` was written to end one level up.
 */
export const VIEWS_BY_TAB: Partial<Record<WorkspaceView, Record<string, readonly SectionViewDef[]>>> = {
  markets: MARKETS_VIEWS,
  coherence: COHERENCE_VIEWS,
};

/** The views a section draws, or empty when the tab has declared none. */
export function viewsFor(tab: WorkspaceView | string, section: string): readonly SectionViewDef[] {
  return VIEWS_BY_TAB[tab as WorkspaceView]?.[section] ?? [];
}

/** The view a section opens on: the first one listed unless `DEFAULTS` says otherwise, or null if it has none. */
export function defaultView(tab: WorkspaceView | string, section: string): string | null {
  const views = viewsFor(tab, section);
  if (!views.length) return null;
  const named = DEFAULTS[tab as WorkspaceView]?.[section];
  return named && views.some(([id]) => id === named) ? named : views[0][0];
}

/**
 * The hash for a location — two segments when the tab has no views for the
 * section OR the view is the section's default, three otherwise.
 *
 * THE ONE WRITER. Four hand-spelled templates existed before this and a third
 * segment added to three of them was the copy-link/reload desync
 * `workspace-routing-sections` guards. A default view writes NO third segment
 * on purpose: every two-segment link already in the world stays canonical, and
 * a reader pressing back to the default gets the address they started from.
 */
export function locationHash(tab: WorkspaceView | string, section: string, view?: string | null): string {
  const views = viewsFor(tab, section);
  if (!views.length || !view || view === defaultView(tab, section) || !views.some(([id]) => id === view)) {
    return `${tab}/${section}`;
  }
  return `${tab}/${section}/${view}`;
}

/**
 * The view a hash segment names, the section's default when it names none of
 * them, or null when this tab does not do views at all.
 *
 * Three answers rather than two, and the third is what keeps every other tab
 * working: `null` means "I have nothing to say about views here", so the caller
 * leaves the section's own state alone. Falling back to a default for a tab
 * with no views would be inventing one.
 */
export function railView(
  tab: WorkspaceView | string,
  section: string,
  view: string | undefined,
): string | null {
  const views = viewsFor(tab, section);
  if (!views.length) return null;
  return views.some(([id]) => id === view) ? (view as string) : (defaultView(tab, section) as string);
}
