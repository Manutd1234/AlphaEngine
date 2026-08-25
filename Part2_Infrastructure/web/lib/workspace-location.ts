"use client";

/**
 * What the address bar says, and who writes it.
 *
 * Split out of `lib/use-workspace-routing.ts` on 2026-08-26, when the third
 * hash segment took that file past the 400-line ceiling. The seam is a real
 * one rather than a convenient line: everything here answers "what is this
 * location, and who updates it", and everything left behind answers "how does
 * the reader move" — the tab switch, the tour, the scroll container, what has
 * been visited. It is the same cut `use-rail-sections.ts` made when the ninth
 * tab arrived, one concern further along.
 *
 * TWO FUNCTIONS, AND THEY ARE THE TWO DIRECTIONS. `hashFor` reads the live
 * refs and says what the URL should be; `viewWriter` puts a view press into
 * the URL. Reading an address without writing one back is exactly half a
 * feature, and it is the half that shipped first: `#markets/fees/comparison`
 * opened Fees on its Ablation, and then pressing "Replay table" left the hash
 * still saying "comparison". A copied link was stale the moment a reader
 * touched anything — which is the copy-link/reload desync `navigate` already
 * carries a comment about, one level down.
 *
 * NEITHER IS OBSERVABLE FROM `npm test`. There is no DOM in that suite, so no
 * assertion there can watch a button press fail to reach the address bar; the
 * defect above was found in headless Chrome and is pinned structurally in
 * `workspace-routing-sections.test.ts` afterwards. That is the same shape as
 * `scripts/figure-arrival-measure.mjs` — behaviour the suite can only guard by
 * reading the writer, once a browser has said the writer is right.
 */

import { useCallback, type MutableRefObject } from "react";

import type { WorkspaceView } from "@/components/WorkspaceHeader";
import { viewsFor } from "@/lib/section-views";

export interface LocationRefs {
  /** Live section per workspace. */
  sectionByViewRef: MutableRefObject<Record<WorkspaceView, string>>;
  /** Live view per section, for the tabs that have views. */
  viewBySectionRef: MutableRefObject<Record<string, string>>;
  /** The tab in front, so a background panel cannot rewrite the address bar. */
  viewRef: MutableRefObject<WorkspaceView>;
}

/**
 * The full location as a hash — tab, section, and the view where the tab has
 * one.
 *
 * One builder for every writer. They each spelled `${view}/${section}` by hand,
 * and a third segment added to three of the four would be the desync above.
 * `viewsFor` is empty for a tab that declares no views, so those tabs keep
 * writing exactly two segments and every link already in the world resolves.
 */
export function useHashFor({ sectionByViewRef, viewBySectionRef }: LocationRefs) {
  return useCallback((tab: WorkspaceView) => {
    const section = sectionByViewRef.current[tab];
    if (!viewsFor(tab, section).length) return `${tab}/${section}`;
    const at = viewBySectionRef.current[section];
    return at ? `${tab}/${section}/${at}` : `${tab}/${section}`;
  }, [sectionByViewRef, viewBySectionRef]);
}

/**
 * A view press, and the URL that has to follow it.
 *
 * `replaceState`, not `push`, and that is a decision rather than a default. A
 * section change pushes because it is somewhere the reader went and Back should
 * return from it. A view is a lens on the section they are already in, and
 * pushing would make Back step through every button press on the way out of a
 * tab — twenty-five of them on the Prices rail. Views were absent from history
 * entirely before this, so replacing keeps that behaviour exactly while making
 * the URL truthful. Verified in a browser: pressing two views in a row leaves
 * `history.length` where it started.
 */
export function useViewWriter(
  { viewRef }: LocationRefs,
  setMarketsView: (section: string, view: string) => void,
) {
  return useCallback((section: string, next: string) => {
    setMarketsView(section, next);
    if (typeof window === "undefined" || viewRef.current !== "markets") return;
    const url = new URL(window.location.href);
    url.hash = `markets/${section}/${next}`;
    window.history.replaceState({}, "", url);
  }, [viewRef, setMarketsView]);
}
