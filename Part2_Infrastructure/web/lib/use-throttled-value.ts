"use client";

/**
 * One repaint per interval, for a figure that changes faster than it reads.
 * =========================================================================
 *
 * The header's decision p99, the routable-provider count and the live book's
 * metric tiles are all fed by sources that move several times a second. Every
 * one of those moves is a React state write, and a state write is a repaint of
 * the chrome around it — so the numbers jitter, the tiles twitch, and a reader
 * trying to hold "8/20" in their head watches it flicker instead.
 *
 * The fix is at the DATA layer, not the paint layer: buffer the value so a
 * burst of N updates costs one render instead of N. Nothing here animates,
 * nothing here reads `prefers-reduced-motion`, and nothing here decides what a
 * number means — a throttled figure is the same figure, in the same plane, a
 * moment later.
 *
 * ── The three properties that make it safe ──────────────────────────────────
 *
 * **Leading edge.** The first value of a burst publishes at once. A throttle
 * that waited out its first window would put a spinner-shaped hole at the
 * front of every stream, which is a worse defect than the jitter.
 *
 * **Trailing flush.** The last value of a burst publishes when the window
 * closes, even though the burst has stopped pushing. Without it the figure on
 * screen is whatever happened to arrive on a window boundary, and the final,
 * settled measurement — the one a reader is actually looking at — is silently
 * dropped. A stale last figure is a correctness bug in this codebase, not a
 * cosmetic one.
 *
 * **Coalescing, never queueing.** The window holds ONE value, the latest.
 * A queue would replay a sixty-frame burst frame by frame after it had already
 * ended, which turns a throttle into a delay line and makes the screen lag the
 * feed by however long the burst ran.
 *
 * ── Null is a value here, not an absence of one ─────────────────────────────
 *
 * `null` and `undefined` travel through unchanged. That is why the pending
 * slot is guarded by a Symbol rather than by a null check: `null` must be
 * storable as a held value, and "nothing is held" must be a state that no
 * measurement can impersonate. A throttle that treated null as empty would
 * drop the moment a measurement went missing — which is the one update a desk
 * most needs — and a throttle that substituted a placeholder for it would be
 * `?? 0` with a timer on top.
 *
 * ── Deliberately not only a hook ────────────────────────────────────────────
 *
 * The machine is a class for the same reason `PollingController` is: it can
 * then be driven by a fake clock with no DOM and no renderer, which is the
 * only way the leading edge, the trailing flush and the burst collapse are
 * testable at all. `useThrottledValue` is the thin React wrapper over it.
 */

import { useEffect, useRef, useState } from "react";

/**
 * The desk's shared cadence for throttled streaming figures.
 *
 * 300ms: slow enough that a metric card stops twitching, fast enough that the
 * figure still reads as live rather than as a snapshot someone took. One named
 * constant rather than a literal per call site, so the desk repaints on one
 * rhythm and changing that rhythm is one edit.
 */
export const THROTTLE_INTERVAL_MS = 300;

/** Injected so a test can drive the window without waiting in real time. */
export interface ThrottleEnvironment {
  setTimeout: (handler: () => void, ms: number) => number;
  clearTimeout: (handle: number) => void;
}

const browserEnvironment = (): ThrottleEnvironment => ({
  setTimeout: (handler, ms) => (globalThis.setTimeout(handler, ms) as unknown) as number,
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
});

/**
 * "Nothing is held."
 *
 * A Symbol, not `null` or `undefined`, because both of those are values a
 * measurement can legitimately take and both must survive a window intact.
 */
const NOTHING = Symbol("nothing held");

/**
 * Leading-edge, trailing-flush, coalescing throttle over a single value.
 *
 * `publish` is called synchronously on the leading edge and from the timer on
 * the trailing edge. It is never called with anything the caller did not push.
 */
export class ValueThrottle<T> {
  private readonly environment: ThrottleEnvironment;
  private handle: number | null = null;
  private held: T | typeof NOTHING = NOTHING;

  constructor(
    private readonly publish: (value: T) => void,
    private intervalMs: number = THROTTLE_INTERVAL_MS,
    environment?: Partial<ThrottleEnvironment>,
  ) {
    this.environment = { ...browserEnvironment(), ...environment };
  }

  /** True while a value is held back waiting for the open window to close. */
  get holding(): boolean {
    return this.held !== NOTHING;
  }

  /** True while a window is open — i.e. a leading edge has already fired. */
  get open(): boolean {
    return this.handle !== null;
  }

  /**
   * Offer a value.
   *
   * Published at once when no window is open; otherwise held, replacing
   * whatever was held before it. Replacing rather than appending is the whole
   * point — see the coalescing note in the header.
   */
  push(value: T): void {
    if (this.handle === null) {
      this.publish(value);
      this.openWindow();
      return;
    }
    this.held = value;
  }

  /**
   * Publish whatever is held, now, and restart the window from now.
   *
   * A no-op when nothing is held: flushing must never republish a value the
   * consumer already has, which would defeat the collapse it just bought.
   */
  flush(): void {
    if (this.held === NOTHING) return;
    const value = this.held as T;
    this.held = NOTHING;
    if (this.handle !== null) this.environment.clearTimeout(this.handle);
    this.publish(value);
    this.openWindow();
  }

  /**
   * Change the interval. Takes effect on the NEXT window.
   *
   * Deliberately not applied to the window already open: recomputing a
   * deadline that is part-served either publishes early or extends a wait the
   * consumer has already half-paid, and neither is worth the arithmetic.
   */
  retime(intervalMs: number): void {
    this.intervalMs = intervalMs;
  }

  /**
   * Stop. Clears the timer and drops anything held.
   *
   * It does NOT flush. This runs on unmount, where the only consumer of the
   * published value is gone — publishing into it would be a state write on a
   * dead component, not a rescued measurement.
   */
  stop(): void {
    if (this.handle !== null) this.environment.clearTimeout(this.handle);
    this.handle = null;
    this.held = NOTHING;
  }

  private openWindow(): void {
    this.handle = this.environment.setTimeout(() => {
      this.handle = null;
      // Burst over and nothing held: go idle, so the next value leads again
      // rather than waiting out a window nobody is filling.
      if (this.held === NOTHING) return;
      const value = this.held as T;
      this.held = NOTHING;
      this.publish(value);
      // A trailing publish IS an update, so the next one queues behind a fresh
      // window. Without this a steady stream would publish twice per interval.
      this.openWindow();
    }, this.intervalMs);
  }
}

/**
 * A value, buffered to at most one change per `intervalMs`.
 *
 * The value passed on the first render is returned by that same render — there
 * is no warm-up frame and no placeholder — and a `null` or `undefined` reaches
 * the caller exactly as it arrived.
 *
 * Never use it for anything where staleness is dangerous: a trading halt, an
 * order fill or reject, a breaker trip and an error condition all have to reach
 * the screen on the tick they happen, and 300ms of buffering is 300ms of a desk
 * acting on a state that has already changed.
 */
export function useThrottledValue<T>(value: T, intervalMs: number = THROTTLE_INTERVAL_MS): T {
  // Seeded with the incoming value: the first paint shows the real thing.
  const [shown, setShown] = useState<T>(value);
  const throttle = useRef<ValueThrottle<T> | null>(null);
  // A change is what gets throttled; the mount is not a change, and pushing it
  // would open a window the first real update then has to wait out.
  const mounted = useRef(false);

  if (throttle.current === null) {
    // Wrapped in an updater because T may itself be a function, which React's
    // setState would otherwise call rather than store.
    throttle.current = new ValueThrottle<T>((next) => setShown(() => next), intervalMs);
  }

  useEffect(() => {
    throttle.current?.retime(intervalMs);
  }, [intervalMs]);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    throttle.current?.push(value);
  }, [value]);

  useEffect(() => () => throttle.current?.stop(), []);

  return shown;
}
