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

export interface WarmSequenceOptions {
  signal?: AbortSignal;
  /** URLs promoted by focus, hover or the visible section. */
  priority?: readonly string[];
  pause?: () => Promise<void>;
}

/** Promise-returning queue: priority first, measured concurrency exactly one. */
export async function warmSequentially(
  urls: readonly string[],
  task: (url: string, signal?: AbortSignal) => Promise<void>,
  options: WarmSequenceOptions = {},
): Promise<void> {
  const unique = [...new Set(urls)];
  const promoted = new Set(options.priority ?? []);
  const ordered = [
    ...unique.filter((url) => promoted.has(url)),
    ...unique.filter((url) => !promoted.has(url)),
  ];
  for (let index = 0; index < ordered.length; index += 1) {
    if (options.signal?.aborted) return;
    await task(ordered[index], options.signal);
    if (index < ordered.length - 1) await options.pause?.();
  }
}

function stagger(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, WARM_STAGGER_MS);
    signal.addEventListener("abort", done, { once: true });
  });
}

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
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = () => {
      void warmSequentially(urls, warmCoherenceRead, {
        signal: controller.signal,
        pause: () => stagger(controller.signal),
      });
    };

    if ("requestIdleCallback" in window) {
      const handle = window.requestIdleCallback(start, { timeout: 3000 });
      return () => {
        controller.abort();
        window.cancelIdleCallback(handle);
        clearTimeout(timer);
      };
    }
    timer = setTimeout(start, 1200);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [reads, active]);
}
