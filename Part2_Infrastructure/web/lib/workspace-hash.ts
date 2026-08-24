/**
 * The workspace's URL vocabulary.
 *
 * Which tabs a hash may name, which retired hash still resolves to a live tab,
 * how a section id is checked against the rail that owns it, how the remembered
 * location is restored, and how a hash is read back onto the rails. Lifted out
 * of `app/dashboard/page.tsx` with `useWorkspaceRouting`; this half is the part
 * that touches no React state of its own, so it can be read (and asserted on)
 * without a component around it.
 */

import { NAV_ITEMS, type WorkspaceView } from "@/components/WorkspaceHeader";
import { WORKSPACE_LOCATION_KEY } from "@/lib/user-prefs";

export const VIEWS: WorkspaceView[] = NAV_ITEMS.map((item) => item.id);

/**
 * The console used to be one "Systems" tab. Anyone holding a link to it lands on
 * reliability, which is the half that answers "is it up" — the question someone
 * following a saved systems link is most likely asking.
 *
 * `markets` left this table on 2026-08-24 and came back the same day as a live
 * tab, which is the whole reason ids are never invented lightly: it was retired
 * here for the hours the Kalshi engine was one tab, and reusing the id rather
 * than minting a third one means the retirement simply ended. Nothing else has
 * ever been retired.
 */
export const LEGACY_VIEWS: Record<string, WorkspaceView> = {
  systems: "reliability",
};

/**
 * The section every workspace opens on when the hash names none, or names one
 * that workspace does not have. Also the seed for the live-section ref, so the
 * two cannot disagree about where a never-visited tab is standing.
 */
export const DEFAULT_SECTION: Record<WorkspaceView, string> = {
  overview: "loop",
  research: "summary",
  live: "trade",
  portfolio: "overview",
  risk: "limits",
  data: "overview",
  reliability: "overview",
  developer: "overview",
  // Prices opens on the reading everything else follows from, which is also
  // where the one-tab engine always opened. Proofs opens on the test it is
  // named for — `universe` is not on that rail at all any more.
  markets: "universe",
  coherence: "certificate",
};

/**
 * Every id a URL may still name that is no longer a section of the tab it names,
 * and the tab AND section that carry it now.
 *
 * THIS TABLE IS THE COST OF FIVE RESTRUCTURES IN ONE DAY, paid once so that no
 * link ever paid it. It has been a cross-tab table (the split), a same-tab one
 * (`DEMOTED_SECTIONS`, after the merge), and is cross-tab again now that the
 * ten sections are divided over Prices and Proofs. Every version answered the
 * same question and only this one answers it in full: a hash names a workspace
 * AND a section, and after the split of 2026-08-24 an id can lose either.
 *
 * THREE KINDS OF ENTRY LIVE HERE, and the third is why a same-tab table would
 * not do:
 *
 *  1. IDS THAT STOPPED BEING SECTIONS. Seven of them: `settlement`,
 *     `dispersion`, `portfolio`, `ablation` and `findings` were rail sections
 *     for a few hours during the promotion pass, and `index` and `combos` were
 *     PUBLISHED on `origin/main` before the consolidation folded them into the
 *     sections that answer the same question. A view is component state and is
 *     not addressable (CLAUDE.md says so), so without this a link lands on a
 *     rail default while the URL still says Settlement — green, plausible, and
 *     wrong. `stake` was an eighth and is not one any more: the fifth
 *     restructure gave it its own rail entry back, so its only remaining
 *     entry is a tab move.
 *  2. IDS THAT MOVED TAB. `universe`, `books`, `lattice`, `stake`, `fees` and
 *     `shell` are Prices sections now, and `#coherence/universe` is a link
 *     `origin/main` published. It must cross to the `markets` workspace, not 404 and not open
 *     Proofs on its default.
 *  3. IDS THAT DID BOTH. `settlement` under `#coherence/` has to become
 *     `markets/universe`: its section is gone AND its tab changed. Two lookups
 *     would have to agree; one table cannot disagree with itself.
 *
 * WHAT THIS CANNOT DO, recorded because it is the cost the reader accepted
 * rather than an oversight: it resolves to a SECTION and stops there. The view
 * inside is component state with no name in the URL, so `#coherence/combos`
 * opens Dutch book on its own landing view rather than on Parlays. Naming a
 * view in the hash would need every console to accept an initial view;
 * addressability is exactly what the consolidation spent.
 *
 * Keyed by the workspace the URL NAMES, then by the id it names. A section the
 * named rail STILL has always wins, so an entry here can never shadow a live
 * id; `readLocation` only consults it after that rail has said no.
 */
export interface RelocatedSection {
  readonly view: WorkspaceView;
  readonly section: string;
}

export const RELOCATED_SECTIONS: Record<string, Record<string, RelocatedSection>> = {
  coherence: {
    // Moved tab: five reading sections are Prices now. Four of the five were
    // published under `#coherence/`.
    universe: { view: "markets", section: "universe" },
    books: { view: "markets", section: "books" },
    lattice: { view: "markets", section: "lattice" },
    fees: { view: "markets", section: "fees" },
    shell: { view: "markets", section: "shell" },
    // Stopped being sections AND changed tab with their carrier.
    settlement: { view: "markets", section: "universe" },
    dispersion: { view: "markets", section: "books" },
    ablation: { view: "markets", section: "fees" },
    // `stake` moved tab and is a SECTION again, so this entry points at the
    // section that carries the subject rather than at the one that briefly
    // absorbed it. It stays in the table because the URL still names the old
    // tab: `#coherence/stake` has to reach `markets/stake`.
    stake: { view: "markets", section: "stake" },
    // Stopped being sections; their carrier stayed on this tab.
    portfolio: { view: "coherence", section: "certificate" },
    combos: { view: "coherence", section: "certificate" },
    index: { view: "coherence", section: "calibration" },
    findings: { view: "coherence", section: "diffusion" },
  },
  // The promotion pass gave the `markets` tab two sections it no longer has.
  // Unpushed and alive for hours, but the ids cost two lines and a link made
  // that morning is still a link someone made.
  //
  // `markets/stake` was the third and its entry is RETIRED rather than
  // re-pointed: `stake` is on this rail again, `readLocation` asks the rail
  // before it asks this table, so the entry could never be reached — and an
  // entry that cannot be reached is a lookup table claiming a move that was
  // undone.
  markets: {
    settlement: { view: "markets", section: "universe" },
    dispersion: { view: "markets", section: "books" },
  },
};

/**
 * Narrows a section id to one workspace's rail, or null when it does not belong
 * to it.
 *
 * `readLocation` already resets an unrecognised id to the workspace default, so
 * a cross-link naming a renamed section would land somewhere nobody chose while
 * the URL claimed otherwise. Falling back to the plain tab switch instead keeps
 * the two agreeing.
 */
export function railSection<T extends string>(ids: readonly T[], section: string): T | null {
  return (ids as readonly string[]).includes(section) ? (section as T) : null;
}

/**
 * Puts the remembered location back in the URL, if there is one and the URL is
 * asking for nothing itself.
 *
 * An empty hash is the only case a stored location may fill. A deep link is an
 * explicit request, and a shared URL that resolved differently per visitor
 * would be worse than not remembering at all. `replaceState`, never a push, so
 * Back still leaves the app rather than stepping through a restore nobody made.
 */
export function restoreRememberedLocation(): void {
  if (!window.location.hash.slice(1)) {
    try {
      const stored: unknown = JSON.parse(window.localStorage.getItem(WORKSPACE_LOCATION_KEY) ?? "null");
      const remembered = (stored as { view?: string } | null)?.view;
      if (remembered && VIEWS.includes(remembered as WorkspaceView)) {
        const sections = (stored as { sections?: Record<string, string> }).sections ?? {};
        const section = sections[remembered];
        window.history.replaceState({}, "", `#${remembered}${section ? `/${section}` : ""}`);
      }
    } catch {
      // A malformed or blocked entry simply leaves the default view.
    }
  }
}

/** Applies a section id to its rail, or reports that the rail has no such id. */
export type SectionApplier = (section: string) => (() => void) | null;

/**
 * Puts the URL's hash on screen, now and on every later move through it.
 *
 * One parser serves all three arrivals — the first paint, Back/Forward, and a
 * hash typed into the address bar — so a shared link, a reload and a history
 * step can never resolve to different screens. `restoreRememberedLocation`
 * runs first because it may fill an empty hash, which is then read like any
 * other. Returns the unsubscribe, so the caller's effect owns the listeners.
 */
export function followLocation(
  applier: Record<WorkspaceView, SectionApplier>,
  setView: (next: WorkspaceView) => void,
): () => void {
  const readLocation = () => {
    const [workspace, nestedSection] = window.location.hash.slice(1).split("/");
    const named = nestedSection ?? "";
    // A retired workspace resolves to the tab that absorbed it BEFORE the
    // section is read, so a retired hash keeps its section instead of being a
    // bare tab switch. `LEGACY_VIEWS` used to set the view and drop whatever
    // followed the slash.
    const hashView = VIEWS.includes(workspace as WorkspaceView)
      ? (workspace as WorkspaceView)
      : LEGACY_VIEWS[workspace] ?? null;
    if (!hashView) return;
    // Every second-level rail in the workspace is a real location: a link into
    // "walk-forward evidence" survives being sent to someone, and Back steps
    // through sections instead of leaving the tab entirely. THREE TRIES, IN
    // THIS ORDER, and the order is the whole contract — asked before the rail,
    // the table could shadow a live id; asked after the default, it would never
    // run:
    //
    //   1. the id the rail the hash NAMED still has;
    //   2. the tab and section that CARRY a relocated id, which since the split
    //      of 2026-08-24 may be a different tab — so this branch sets the view
    //      as well, and it is the only one that can;
    //   3. the named tab's own default.
    const onRail = applier[hashView](named);
    if (onRail) {
      setView(hashView);
      onRail();
      return;
    }
    const moved = RELOCATED_SECTIONS[hashView]?.[named];
    const relocated = moved ? applier[moved.view](moved.section) : null;
    if (moved && relocated) {
      setView(moved.view);
      relocated();
      return;
    }
    setView(hashView);
    applier[hashView](DEFAULT_SECTION[hashView])?.();
  };
  restoreRememberedLocation();
  readLocation();
  window.addEventListener("popstate", readLocation);
  window.addEventListener("hashchange", readLocation);
  return () => {
    window.removeEventListener("popstate", readLocation);
    window.removeEventListener("hashchange", readLocation);
  };
}
