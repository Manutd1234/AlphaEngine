"use client";

/**
 * Reads a tab's other sections before the reader asks for one.
 *
 * The rail's `onIntent` covers a pointer crossing a tab, which is the common
 * case and the cheap one. It covers nothing for a reader who arrives by
 * keyboard, by deep link, or by clicking a tab they were already over — and on
 * this tab a cold section is not a flicker, it is seconds of "Reading the
 * exchange…" because the reads really are live ones.
 *
 * So the whole rail is swept once the tab is on screen: idle first, then one
 * URL at a time. Both halves matter.
 *
 * **Idle**, because the section the reader actually opened is fetching in the
 * same moment, and a sweep that raced it would make the visible section slower
 * to serve the invisible ones.
 *
 * **One at a time**, because the exchange's budget is the thing being spent.
 * The gateway's coherence bucket refills at 50 tokens a second and a default
 * request costs 10, so five a second is the ceiling it sets itself; a rail
 * fired in parallel would spend a whole tab's allowance in one frame and leave
 * the section the reader is on queuing behind its own neighbours.
 *
 * Nothing here reports anything. A warm has no reader — the pane that arrives
 * later runs its own read and reports that one.
 */

import { useEffect } from "react";

import { warmCoherenceRead } from "./use-coherence";

/**
 * Gap between warms. Comfortably inside the five-a-second the gateway budgets,
 * and it finishes a rail in about two seconds — faster than a reader can
 * finish the section they are on.
 */
export const WARM_STAGGER_MS = 600;

export function useSectionWarming<T extends string>(
  reads: Record<T, readonly string[]>,
  active: boolean,
): void {
  useEffect(() => {
    if (!active) return;
    // Deduplicated across sections: Universe and Lattice read the same
    // families, and warming that URL twice is one wasted request against a
    // budget this exists to respect.
    const urls = [...new Set(Object.values<readonly string[]>(reads).flat())];
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let index = 0;

    const step = () => {
      if (cancelled || index >= urls.length) return;
      // A URL already answered recently, or already in flight for the section
      // on screen, is skipped inside `warm` rather than here — so the sweep
      // costs nothing on a tab that is merely being revisited.
      warmCoherenceRead(urls[index]);
      index += 1;
      timer = setTimeout(step, WARM_STAGGER_MS);
    };

    if ("requestIdleCallback" in window) {
      const handle = window.requestIdleCallback(() => { if (!cancelled) step(); }, { timeout: 3000 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback(handle);
        clearTimeout(timer);
      };
    }
    timer = setTimeout(step, 1200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [reads, active]);
}
