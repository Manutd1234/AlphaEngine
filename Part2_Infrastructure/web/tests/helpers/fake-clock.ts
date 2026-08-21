/**
 * A clock the test advances by hand, for driving `PollingController`.
 *
 * This harness is the reason the polling machine is a class rather than a
 * hook: none of the fourteen hand-rolled loops it replaced was ever
 * unit-tested, because none of them could be. Injecting the environment —
 * timers, the hidden flag, the visibility subscription — is what makes the
 * four decisions the loop encodes assertable at all.
 *
 * It lives here, in one place, rather than being copied beside each suite.
 * The polling contract is split across `polling-visibility`,
 * `polling-backoff` and `polling-lifecycle`; if each carried its own copy of
 * the clock, the four decisions could start disagreeing about what "advance"
 * or "hidden" means, and the suites would keep passing while doing so.
 *
 * No real timers, so no waiting and no flake: `advance` fires everything due
 * in time order, settling promises between ticks so a tick that awaits is
 * observed to have finished before the next one is considered.
 */

import type { PollingEnvironment } from "../../lib/polling";

export interface FakeClock {
  /** The injectable environment `PollingController` takes. */
  environment: PollingEnvironment;
  /** Mutable visibility, for tests that flip it without notifying. */
  state: { hidden: boolean };
  /** Advance time, firing everything due, one settle per timer. */
  advance(ms: number): Promise<void>;
  /** Flip visibility AND notify the subscribers, as the browser would. */
  setHidden(value: boolean): Promise<void>;
  /** How many timers are outstanding — zero means the loop cannot resume. */
  pending(): number;
}

/** A clock the test advances by hand. No timers, no waiting. */
export function fakeClock({ hidden = false } = {}): FakeClock {
  let now = 0;
  let nextHandle = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  const listeners = new Set<() => void>();
  const state = { hidden };

  const environment: PollingEnvironment = {
    setTimeout: (handler, ms) => {
      const handle = nextHandle++;
      timers.set(handle, { at: now + ms, run: handler });
      return handle;
    },
    clearTimeout: (handle) => void timers.delete(handle),
    isHidden: () => state.hidden,
    onVisibilityChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return {
    environment,
    state,
    /** Advance time, firing everything due, one settle per timer. */
    async advance(ms: number) {
      const target = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [handle, timer] = due;
        timers.delete(handle);
        now = timer.at;
        timer.run();
        await Promise.resolve();
        await Promise.resolve();
      }
      now = target;
    },
    async setHidden(value: boolean) {
      state.hidden = value;
      for (const listener of listeners) listener();
      await Promise.resolve();
      await Promise.resolve();
    },
    pending: () => timers.size,
  };
}
