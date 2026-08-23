"use client";

/**
 * Warms the three lazily-loaded console chunks.
 *
 * Data, Reliability and Developer are the heaviest subtrees on the desk and
 * none of them is needed for first paint, so `page.tsx` loads them with
 * `next/dynamic`. This is the other half of that decision: without it the
 * first click on one of those tabs pays the download, and the loading box —
 * sized to hold a panel-shaped rectangle so nothing shifts — is what the
 * reader sees instead of the console.
 *
 * A prefetch is a hint, not a dependency. Failures here surface nothing and
 * the tab's own loading box covers the cold case.
 */

import { useCallback, useEffect } from "react";

import type { WorkspaceView } from "@/components/WorkspaceHeader";

const load = {
  data: () => import("@/components/DataConsole"),
  reliability: () => import("@/components/ReliabilityConsole"),
  developer: () => import("@/components/DeveloperConsole"),
  coherence: () => import("@/components/CoherenceConsole"),
};

/** Returns the hover/focus warm-up handler; the idle warm-up runs on its own. */
export function useConsolePrefetch(): (next: WorkspaceView) => void {
  useEffect(() => {
    const prefetch = () => {
      void load.data();
      void load.reliability();
      void load.developer();
    };
    if ("requestIdleCallback" in window) {
      const handle = window.requestIdleCallback(prefetch, { timeout: 4000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = setTimeout(prefetch, 1500);
    return () => clearTimeout(timer);
  }, []);

  // Idle usually wins this race. When it does not — a busy machine, which is
  // the one where a loading box is most visible — a pointer crossing the tab
  // has already started the download by the time the click lands. Import is
  // idempotent and cached, so a hover after the idle warm-up costs nothing.
  return useCallback((next: WorkspaceView) => {
    if (next === "data" || next === "reliability" || next === "developer" || next === "coherence") void load[next]();
  }, []);
}
