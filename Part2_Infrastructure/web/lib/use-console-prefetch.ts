"use client";

/**
 * Warms the lazily-loaded console chunks.
 *
 * Data, Reliability, Developer, Markets and Coherence are the heaviest subtrees on the desk and
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
  markets: () => import("@/components/MarketsConsole"),
  coherence: () => import("@/components/CoherenceConsole"),
  // The sixth, and it was missing for as long as the tab has existed. Diffusion
  // arrived chunk-split like its five neighbours and was never added here, so
  // it was the one console on the desk whose first click still paid for its own
  // download behind the skeleton. Invisible to anyone whose chunk is already
  // cached, which is everybody who built it.
  diffusion: () => import("@/components/DiffusionConsole"),
};

export type ConsoleChunkLoader = () => Promise<unknown>;

/**
 * Warm one cold workspace chunk at a time.
 *
 * Starting every dynamic import in one idle callback makes the split nominal:
 * six downloads, parses and module evaluations compete with the first console
 * the reader is actually using. Awaiting each import preserves the warm-cache
 * benefit without turning an idle hint into a foreground burst. A failed hint
 * never blocks the rest; the destination's own dynamic boundary still owns the
 * visible retry/loading state.
 */
export async function warmConsoleChunksSequentially(
  loaders: readonly ConsoleChunkLoader[],
  signal?: AbortSignal,
): Promise<void> {
  for (const warm of loaders) {
    if (signal?.aborted) return;
    try {
      await warm();
    } catch {
      // Prefetch is optional. A cold click retries through next/dynamic.
    }
  }
}

/** Returns the hover/focus warm-up handler; the idle warm-up runs on its own. */
export function useConsolePrefetch(): (next: WorkspaceView) => void {
  useEffect(() => {
    const controller = new AbortController();
    // All six, but sequentially. Markets, Coherence and Diffusion were each
    // added after the original warm map; they still belong in the idle queue,
    // just not as one six-request burst.
    const prefetch = () => {
      void warmConsoleChunksSequentially(Object.values(load), controller.signal);
    };
    if ("requestIdleCallback" in window) {
      const handle = window.requestIdleCallback(prefetch, { timeout: 4000 });
      return () => {
        controller.abort();
        window.cancelIdleCallback(handle);
      };
    }
    const timer = setTimeout(prefetch, 1500);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);

  // Idle usually wins this race. When it does not — a busy machine, which is
  // the one where a loading box is most visible — a pointer crossing the tab
  // has already started the download by the time the click lands. Import is
  // idempotent and cached, so a hover after the idle warm-up costs nothing.
  return useCallback((next: WorkspaceView) => {
    if (next in load) void load[next as keyof typeof load]();
  }, []);
}
