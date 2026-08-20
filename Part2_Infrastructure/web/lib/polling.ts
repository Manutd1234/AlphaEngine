/**
 * One polling loop, written once.
 *
 * The desk had fourteen hand-rolled `useEffect` loops and no shared
 * abstraction, so each of them got the same four decisions right or wrong
 * independently. Measured across the tree before this existed:
 *
 *   - three never checked `document.hidden` at all, so a backgrounded tab kept
 *     spending provider quota;
 *   - ten of twelve fetching loops had NO error backoff. `ExecutionCockpit`
 *     records what that costs in its own comment — "1,542 requests in ten
 *     seconds from one idle guest tab, every one of them doomed" — and notes
 *     the failure was invisible to the desk sweep and to the unit suite;
 *   - one of fourteen revalidated when the reader came back to the tab, so the
 *     other thirteen showed a stale number for up to a full interval at the
 *     moment someone was looking at it;
 *   - several used `setInterval`, which stacks ticks when one runs long.
 *
 * None of those is hard. All of them are easy to forget once per loop, which
 * is the argument for a class rather than a convention.
 *
 * Deliberately not a hook. The React wrapper is `usePolling`, and keeping the
 * machine separate is what lets it be unit-tested against a fake clock with no
 * DOM at all — the reason none of the fourteen were ever tested.
 */

/** Injected so a test can drive the loop without waiting in real time. */
export interface PollingEnvironment {
  setTimeout: (handler: () => void, ms: number) => number;
  clearTimeout: (handle: number) => void;
  /** True while the page is not being looked at. */
  isHidden: () => boolean;
  /** Subscribe to visibility changes; returns an unsubscribe. */
  onVisibilityChange: (listener: () => void) => () => void;
}

export interface PollingOptions {
  /** Milliseconds between ticks. 0 or less is a genuine pause, not an error. */
  intervalMs: number;
  /** The work. A rejection is a failure and drives the backoff. */
  tick: () => void | Promise<void>;
  /**
   * Skip the tick while the page is hidden.
   *
   * On by default and off only where the work is not a network call — a local
   * re-publish of state already in memory costs nothing and stopping it makes
   * the first paint after a return stale.
   */
  pauseWhenHidden?: boolean;
  /** Run immediately when the reader comes back to a hidden tab. */
  revalidateOnVisible?: boolean;
  /** Geometric backoff ceiling. Null disables backoff entirely. */
  maxBackoffMs?: number | null;
  environment?: Partial<PollingEnvironment>;
}

const browserEnvironment = (): PollingEnvironment => ({
  setTimeout: (handler, ms) => (globalThis.setTimeout(handler, ms) as unknown) as number,
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
  isHidden: () => typeof document !== "undefined" && document.hidden,
  onVisibilityChange: (listener) => {
    if (typeof document === "undefined") return () => {};
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  },
});

export class PollingController {
  private readonly environment: PollingEnvironment;
  private handle: number | null = null;
  private unsubscribe: (() => void) | null = null;
  private running = false;
  /** Consecutive failures. Drives the backoff and resets on any success. */
  private failures = 0;
  /** True while a tick is in flight, so a slow tick cannot be overlapped. */
  private inFlight = false;

  constructor(private readonly options: PollingOptions) {
    this.environment = { ...browserEnvironment(), ...options.environment };
  }

  /** Consecutive failures. Exposed so a surface can disclose degradation. */
  get consecutiveFailures(): number {
    return this.failures;
  }

  /**
   * The delay before the next attempt.
   *
   * `2 ** failures` from the base interval, capped. The cap matters more than
   * the curve: an uncapped geometric backoff on a long-lived tab reaches hours
   * and the loop is effectively dead without ever saying so.
   */
  nextDelayMs(): number {
    const base = Math.max(0, this.options.intervalMs);
    const ceiling = this.options.maxBackoffMs;
    if (!this.failures || ceiling == null) return base;
    return Math.min(ceiling, base * 2 ** Math.min(this.failures, 8));
  }

  start(): void {
    if (this.running || this.options.intervalMs <= 0) return;
    this.running = true;
    if (this.options.revalidateOnVisible !== false) {
      this.unsubscribe = this.environment.onVisibilityChange(() => {
        // Only on the way BACK. Firing on the way out would spend a request on
        // a tab nobody is looking at, which is the defect this class exists to
        // prevent.
        if (!this.environment.isHidden()) void this.runNow();
      });
    }
    this.schedule(this.options.intervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.handle !== null) this.environment.clearTimeout(this.handle);
    this.handle = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Tick now and restart the schedule from now. */
  async runNow(): Promise<void> {
    if (this.handle !== null) this.environment.clearTimeout(this.handle);
    this.handle = null;
    await this.fire();
  }

  private schedule(ms: number): void {
    if (!this.running) return;
    this.handle = this.environment.setTimeout(() => {
      this.handle = null;
      void this.fire();
    }, ms);
  }

  private async fire(): Promise<void> {
    if (!this.running || this.inFlight) return;

    // Hidden: reschedule without spending anything. NOT stop() — the loop has
    // to be alive to resume when the reader returns.
    if (this.options.pauseWhenHidden !== false && this.environment.isHidden()) {
      this.schedule(this.options.intervalMs);
      return;
    }

    this.inFlight = true;
    try {
      await this.options.tick();
      this.failures = 0;
    } catch {
      // Swallowed on purpose: a poll that throws into an unhandled rejection
      // takes the loop down with it, and a dead loop looks exactly like a quiet
      // system. The failure is recorded in the backoff instead.
      this.failures += 1;
    } finally {
      this.inFlight = false;
      this.schedule(this.nextDelayMs());
    }
  }
}
