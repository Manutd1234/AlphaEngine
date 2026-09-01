/**
 * The views inside a section, and the third segment of the hash that names one.
 *
 * `lib/sections.ts` is the single source for the rails: which sections a tab
 * has, in what order, under what label. This is the level below it — which
 * VIEWS a section draws — and it exists for the same reason that file does. The
 * quantitative engine registers **71** views: Markets 26, Proofs 29 and
 * Diffusion 16. Before this table, many were component state: not in the URL,
 * command palette or `scripts/desk-sweep.mjs`, whose 70 rail sections are only
 * one level of the destination graph. A view could break and stay broken with
 * every suite green because nothing could open it.
 *
 * THE THIRD SEGMENT IS OPAQUE TO THE ROUTER. `followLocation` carries the
 * string and hands it to the tab; the TAB resolves it. This is cheap
 * future-proofing rather than a response to nested routing: current consumers
 * across Research, Markets, Proofs and all seven Diffusion sections use flat
 * view ids. It is written this way because the router gains nothing from
 * knowing their meaning, and a tab can change its own table without changing
 * the router.
 *
 * IT IS NOT WRITTEN THIS WAY BECAUSE OF `FindingsPane`, and the correction is
 * recorded because the wrong version was nearly committed. That pane has a
 * flat three-way controlled picker, structurally identical to `ArmSection` and
 * fully expressed by `#diffusion/findings/plot`. The nesting it once had was
 * deliberately removed on 2026-08-25, so a `<view>.<sub>` vocabulary would
 * have put back into the URL exactly the third control level the tree had just
 * finished deleting.
 * What IS unusual about that pane is orthogonal: its switcher lives in a folded
 * pane rather than on the parent's row, which `coherence-sections.test.ts`
 * carries as a named exemption.
 *
 * SO A TAB THAT DECLARES NOTHING HERE IS UNTOUCHED. `railView` answers `null`
 * for it, `followLocation` skips the view step, and every existing link behaves
 * exactly as it did. Markets, Proofs, Diffusion and Research all use the same
 * contract; designing against all four stops this becoming a Markets-shaped
 * rule that the next tab has to escape.
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
 * Research keeps its published Summary section while making its two jobs
 * explicit. Results stays first so every existing two-segment link remains the
 * canonical result view; Setup alone earns the optional third segment.
 */
export const RESEARCH_SUMMARY_VIEWS = [
  ["results", "Results"],
  ["setup", "Setup"],
] as const satisfies readonly SectionViewDef[];

/** Presentation-only tabs inside Setup; they do not add another URL level. */
export const RESEARCH_SETUP_VIEWS = [
  ["core", "Core parameters"],
  ["adjustments", "Adjustments"],
] as const satisfies readonly SectionViewDef[];

const RESEARCH_VIEWS = {
  summary: RESEARCH_SUMMARY_VIEWS,
} as const satisfies Record<string, readonly SectionViewDef[]>;

/**
 * Markets, section by section — 26 views across eight rail sections.
 *
 * Every id here is what the section's own switcher already uses, so nothing is
 * renamed into existence: these strings began as component state and are now
 * addresses. `section-views.test.ts` reads each owning component and
 * fails if a declared default drifts from the one the component opens on.
 */
const MARKETS_VIEWS = {
  universe: [["baskets", "Basket pricing"], ["positions", "Positions"], ["families", "Families"]],
  settlement: [["reading", "Index"], ["formation", "Formation"], ["pending", "Pending"]],
  books: [["ladder", "Ladder"], ["identity", "Identity"], ["history", "History"]],
  // The id is `dispersion` and the label is "Makers", which is house practice on
  // this rail rather than drift — `live` renders "Execution", `activity` renders
  // "Blotter". Its two view ids keep the same split.
  dispersion: [["quotes", "Dispersion"], ["channel", "REST poll"]],
  lattice: [["survival", "Survival"], ["mass", "Mass"], ["moments", "Moment shape"], ["support", "Moment support"]],
  stake: [["plan", "Plan"], ["capital", "Capital"], ["method", "Method"], ["family", "All outcomes"]],
  fees: [["example", "Worked example"], ["shape", "Cost shape"], ["comparison", "Ablation"], ["table", "Replay table"]],
  // THREE SINCE 2026-08-31. `reading` merged into `tree` (selecting a file was
  // already switching the view for the reader) and `commands` onto `layout`
  // (both read nothing and answer what the filesystem IS). Neither id is
  // reachable now, and neither needs an entry anywhere: `railView` falls back
  // to the section's default for a view it does not have, so `#markets/shell/
  // commands` opens Map — the section that absorbed it — rather than nothing.
  // The former Map now separates the namespace from the collateral decision;
  // both remain static views over the same bounded root read.
  shell: [["layout", "Namespace"], ["route", "Routing"], ["tree", "Browse"]],
} as const satisfies Record<string, readonly SectionViewDef[]>;

/**
 * Proofs, section by section — 29 views across seven rail sections.
 *
 * Every id is the string the section's own `useState` used to hold, so nothing
 * is renamed into existence; the labels are the ones `coherence-sections`
 * pins. Basket now declares Cover, Basket and Size. Lessons' six ids come from
 * the data — the four slices are `LESSON_GROUPS`, and the two views ABOUT the
 * catalogue follow them, in the order the row presses.
 */
const COHERENCE_VIEWS = {
  certificate: [
    ["verdict", "Verdict"],
    ["proof", "Proof"],
    ["checks", "Checks"],
    ["prices", "Prices"],
    ["sizes", "Sizes"],
  ],
  portfolio: [["cover", "Cover"], ["basket", "Basket"], ["size", "Size"]],
  combos: [["bands", "Ranges"], ["parlays", "Test quote"], ["inputs", "Leg prices"], ["legs", "Test legs"], ["bounds", "Checks"]],
  index: [["series", "By poll"], ["families", "By family"]],
  calibration: [["score", "Overview"], ["decomposition", "Equation"], ["components", "Component scale"], ["measures", "Measures"], ["reliability", "Reliability"], ["bands", "Bands"]],
  corpus: [["composition", "Composition"], ["trend", "Score trend"]],
  lessons: [
    ...LESSON_GROUPS.map((group) => [group.id, group.label] as const),
    ["coverage", "Coverage"],
    ["states", "Episode states"],
  ],
} as const satisfies Record<string, readonly SectionViewDef[]>;

/**
 * Diffusion's complete sixteen-destination surface.
 *
 * Measurement and Instrument each have one structural landing. They still
 * belong here: a one-view row gives the router, sweep and command inventory a
 * complete destination count without drawing a one-option switcher.
 */
const DIFFUSION_VIEWS = {
  arm: [["absorption", "Absorption"], ["floor", "Control"], ["clocks", "Clocks"]],
  meetings: [["table", "Meeting by meeting"], ["calendar", "Calendar"], ["mechanism", "Mechanism"]],
  episodes: [["survival", "Survival"], ["episodes", "Episodes"]],
  model: [["measurement", "Measurement"]],
  instrument: [["instrument", "Instrument"]],
  sandbox: [["halflife", "Half-life"], ["simulator", "Simulator"], ["spectrum", "Spectrum"]],
  findings: [["plot", "Effect plot"], ["table", "Findings table"], ["instrument", "Instrument"]],
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
 * Four entries: Research, Markets, Proofs and Diffusion. A tab joins by adding
 * its table and nothing else — the router, sweep and palette all read this
 * rather than lists of their own, which is the drift `lib/sections.ts` was
 * written to end one level up.
 */
export const VIEWS_BY_TAB: Partial<Record<WorkspaceView, Record<string, readonly SectionViewDef[]>>> = {
  research: RESEARCH_VIEWS,
  markets: MARKETS_VIEWS,
  coherence: COHERENCE_VIEWS,
  diffusion: DIFFUSION_VIEWS,
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
