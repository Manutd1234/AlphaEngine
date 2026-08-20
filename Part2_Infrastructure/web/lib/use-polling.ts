"use client";

/**
 * `PollingController` for React.
 *
 * The machine is deliberately not a hook (see lib/polling.ts) so it can be
 * unit-tested against a fake clock. This is the thin part: keep one controller
 * for the component's life, hand it the latest callback without restarting the
 * loop, and stop it on unmount.
 *
 * The "latest callback" bit is the one that matters. Every hand-rolled loop in
 * this codebase put its fetch in the effect's dependency array, so a callback
 * that changed identity on render restarted the timer — and `ExecutionCockpit`
 * records what that costs: its `failures` counter was a dependency, so a failed
 * probe re-ran the effect, which fired an immediate refresh, which meant the
 * geometric backoff it had carefully computed was never once reached.
 */

import { useEffect, useRef } from "react";

import { PollingController, type PollingOptions } from "@/lib/polling";

export interface UsePollingOptions extends Omit<PollingOptions, "tick"> {
  tick: () => void | Promise<void>;
  /** Stop the loop without unmounting — a closed pane, an unconfigured desk. */
  enabled?: boolean;
}

export function usePolling({ tick, enabled = true, intervalMs, ...rest }: UsePollingOptions): void {
  const latest = useRef(tick);
  latest.current = tick;

  const options = useRef({ intervalMs, ...rest });
  options.current = { intervalMs, ...rest };

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;
    const loop = new PollingController({
      ...options.current,
      intervalMs,
      // Reads through the ref, so the loop is never restarted by a callback
      // whose identity changed on render.
      tick: () => latest.current(),
    });
    loop.start();
    return () => loop.stop();
  }, [enabled, intervalMs]);
}
