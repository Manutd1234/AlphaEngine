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
  markets: "universe",
  coherence: "certificate",
};

/**
 * Sections that changed tab, and the tab they went to.
 *
 * `LEGACY_VIEWS` above retires a whole workspace; this retires a location
 * inside one, which the split of the Kalshi engine into Markets and Coherence
 * needed and nothing before it did. `#coherence/books` was a public deep link
 * for as long as that rail carried Books, and without this the section is one
 * `lib/sections` no longer defines for `coherence` — so `readLocation` would
 * reset it to that tab's default and the reader would land on the Dutch-book
 * certificate while the URL still said Books. Green, plausible, and wrong.
 *
 * Keyed by the workspace the URL names, then by the section it names. A
 * section the named tab STILL has always wins, so an id that later appears on
 * both rails resolves to the tab the link actually asked for.
 */
export const RELOCATED_SECTIONS: Record<string, Record<string, WorkspaceView>> = {
  coherence: {
    universe: "markets",
    books: "markets",
    lattice: "markets",
    shell: "markets",
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
    const hashView = workspace as WorkspaceView;
    if (VIEWS.includes(hashView)) {
      // Every second-level rail in the workspace is a real location: a link
      // into "walk-forward evidence" survives being sent to someone, and Back
      // steps through sections instead of leaving the tab entirely. A section
      // this workspace does not have is looked up in `RELOCATED_SECTIONS`
      // first, and only then reset to the tab default — otherwise a link into
      // a section that merely MOVED lands somewhere nobody named.
      const own = applier[hashView](nestedSection ?? "");
      const moved = own ? null : RELOCATED_SECTIONS[workspace]?.[nestedSection ?? ""] ?? null;
      const landing = moved ?? hashView;
      setView(landing);
      const apply = own
        ?? applier[landing](nestedSection ?? "")
        ?? applier[landing](DEFAULT_SECTION[landing]);
      apply?.();
    } else if (LEGACY_VIEWS[workspace]) {
      setView(LEGACY_VIEWS[workspace]);
    }
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
