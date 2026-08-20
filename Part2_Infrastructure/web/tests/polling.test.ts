/**
 * The four things fourteen hand-rolled loops each decided separately.
 *
 * Every assertion here corresponds to a defect measured in the tree before
 * `PollingController` existed: three loops that never checked `document.hidden`,
 * ten that had no backoff, thirteen that did not revalidate on return, and
 * several using `setInterval`, which stacks ticks when one runs long.
 *
 * Driven by a fake clock, which is the point of the machine being a class
 * rather than a hook — none of the fourteen was ever unit-tested because none
 * of them could be.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PollingController, type PollingEnvironment } from "../lib/polling";

/** A clock the test advances by hand. No timers, no waiting. */
function harness({ hidden = false } = {}) {
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

describe("a polling loop does not spend anything on a hidden tab", () => {
  it("skips the tick but stays alive", async () => {
    const h = harness({ hidden: true });
    let ticks = 0;
    const loop = new PollingController({
      intervalMs: 1_000,
      tick: () => { ticks += 1; },
      environment: h.environment,
    });
    loop.start();

    await h.advance(10_000);
    assert.equal(ticks, 0, "a hidden tab kept polling");
    assert.ok(h.pending() > 0, "the loop stopped instead of waiting — it cannot resume");

    h.state.hidden = false;
    await h.advance(1_000);
    assert.equal(ticks, 1, "the loop did not resume when the tab came back");
    loop.stop();
  });

  it("runs immediately when the reader returns, rather than after a full interval", async () => {
    const h = harness({ hidden: true });
    let ticks = 0;
    const loop = new PollingController({
      intervalMs: 30_000,
      tick: () => { ticks += 1; },
      environment: h.environment,
    });
    loop.start();
    await h.advance(30_000);
    assert.equal(ticks, 0);

    await h.setHidden(false);
    assert.equal(ticks, 1, "a reader returning to the tab waited up to a full interval for fresh data");
    loop.stop();
  });

  it("does not fire on the way OUT", async () => {
    const h = harness();
    let ticks = 0;
    const loop = new PollingController({
      intervalMs: 30_000,
      tick: () => { ticks += 1; },
      environment: h.environment,
    });
    loop.start();
    await h.setHidden(true);
    assert.equal(ticks, 0, "leaving the tab spent a request on a tab nobody is looking at");
    loop.stop();
  });
});

describe("a failing loop backs off instead of hammering", () => {
  it("grows geometrically and stops at the ceiling", async () => {
    const h = harness();
    const loop = new PollingController({
      intervalMs: 1_000,
      maxBackoffMs: 30_000,
      tick: () => { throw new Error("gateway refused"); },
      environment: h.environment,
    });
    loop.start();

    assert.equal(loop.nextDelayMs(), 1_000, "the first attempt is not delayed");
    await h.advance(1_000);
    assert.equal(loop.consecutiveFailures, 1);
    assert.equal(loop.nextDelayMs(), 2_000);
    await h.advance(2_000);
    assert.equal(loop.nextDelayMs(), 4_000);

    // Far past the point an uncapped curve would reach hours.
    await h.advance(10 * 60_000);
    assert.equal(loop.nextDelayMs(), 30_000, "the backoff ran past its ceiling");
    loop.stop();
  });

  it("recovers the moment a tick succeeds", async () => {
    const h = harness();
    let fail = true;
    const loop = new PollingController({
      intervalMs: 1_000,
      maxBackoffMs: 30_000,
      tick: () => { if (fail) throw new Error("no"); },
      environment: h.environment,
    });
    loop.start();
    await h.advance(1_000);
    await h.advance(2_000);
    assert.ok(loop.nextDelayMs() > 1_000, "the loop is not backed off, so recovery proves nothing");

    fail = false;
    await h.advance(loop.nextDelayMs());
    assert.equal(loop.consecutiveFailures, 0);
    assert.equal(loop.nextDelayMs(), 1_000, "a recovered loop stayed slow");
    loop.stop();
  });

  it("a rejection never escapes as an unhandled rejection", async () => {
    const h = harness();
    const loop = new PollingController({
      intervalMs: 1_000,
      tick: () => Promise.reject(new Error("boom")),
      environment: h.environment,
    });
    loop.start();
    await h.advance(5_000);
    // Reaching here at all is the assertion: a throw that escaped would take
    // the loop down, and a dead loop looks exactly like a quiet system.
    assert.equal(loop.consecutiveFailures, 5);
    loop.stop();
  });
});

describe("a loop may retry from a floor of its own, and disclose the wait", () => {
  it("keeps the retry floor independent of the healthy cadence", async () => {
    /**
     * The gateway probe's case. Its interval is a refresh rate, but a gateway
     * that has just come back has to be noticed in seconds whatever that rate
     * is — anchored to the interval, the first retry on a 30s cadence would be
     * a minute, and the desk would sit in the sandbox for it.
     */
    const h = harness();
    const loop = new PollingController({
      intervalMs: 30_000,
      firstRetryMs: 2_500,
      maxBackoffMs: 30_000,
      tick: () => { throw new Error("gateway refused"); },
      environment: h.environment,
    });
    loop.start();

    await h.advance(30_000);
    assert.equal(loop.nextDelayMs(), 2_500, "the first retry waited the healthy cadence");
    await h.advance(2_500);
    assert.equal(loop.nextDelayMs(), 5_000);
    await h.advance(10 * 60_000);
    assert.equal(loop.nextDelayMs(), 30_000, "the floor's curve ran past its ceiling");
    loop.stop();
  });

  it("leaves the default curve exactly where it was", () => {
    // `firstRetryMs` defaults to twice the interval, which is the curve every
    // existing adopter is on. A default that changed it would re-time ten
    // loops silently in service of one that needed a floor.
    const loop = new PollingController({
      intervalMs: 1_000,
      maxBackoffMs: 300_000,
      tick: () => {},
      environment: harness().environment,
    });
    assert.equal(loop.nextDelayMs(), 1_000);
  });

  it("reports the delay it committed to, rather than one computed beside it", async () => {
    /**
     * `DataTierBadge` renders "Retrying automatically in about 8s." The number
     * has to come from the loop: a surface computing its own copy of the curve
     * above is a second implementation of the same arithmetic, and the two
     * disagree the moment either is touched. A countdown that disagrees with
     * the timer it describes is worse than no countdown.
     */
    const h = harness();
    const scheduled: Array<[number, number]> = [];
    let fail = true;
    const loop = new PollingController({
      intervalMs: 1_000,
      firstRetryMs: 2_500,
      maxBackoffMs: 30_000,
      tick: () => { if (fail) throw new Error("gateway refused"); },
      onSchedule: (delayMs, failures) => scheduled.push([delayMs, failures]),
      environment: h.environment,
    });
    loop.start();

    await h.advance(1_000);
    assert.deepEqual(scheduled.at(-1), [2_500, 1]);
    await h.advance(2_500);
    assert.deepEqual(scheduled.at(-1), [5_000, 2]);

    fail = false;
    await h.advance(5_000);
    assert.deepEqual(scheduled.at(-1), [1_000, 0], "a recovered loop still claimed to be backing off");
    loop.stop();
  });

  it("says nothing on the hidden-tab reschedule, which is no verdict on failure", async () => {
    // Reporting the interval there would clear a countdown that is still true:
    // the loop is backed off, nobody is looking, and the reader who comes back
    // has to be told what it is waiting for.
    const h = harness();
    const scheduled: number[] = [];
    const loop = new PollingController({
      intervalMs: 1_000,
      firstRetryMs: 2_500,
      maxBackoffMs: 30_000,
      tick: () => { throw new Error("gateway refused"); },
      onSchedule: (delayMs) => scheduled.push(delayMs),
      environment: h.environment,
    });
    loop.start();

    await h.advance(1_000);
    assert.deepEqual(scheduled, [2_500]);
    h.state.hidden = true;
    await h.advance(60_000);
    assert.deepEqual(scheduled, [2_500], "a hidden tab reported a wait it was not waiting");
    loop.stop();
  });

  it("survives a listener that throws", async () => {
    // Same reason the tick's own throw is swallowed: a dead loop looks exactly
    // like a quiet system, and disclosing the wait is not worth one.
    const h = harness();
    let ticks = 0;
    const loop = new PollingController({
      intervalMs: 1_000,
      tick: () => { ticks += 1; },
      onSchedule: () => { throw new Error("the badge blew up"); },
      environment: h.environment,
    });
    loop.start();
    await h.advance(3_000);
    assert.equal(ticks, 3, "a throwing listener took the loop down with it");
    loop.stop();
  });
});

describe("a loop may start now rather than one interval from now", () => {
  it("fires at start, and schedules from that outcome", async () => {
    /**
     * The alternative is a first fetch in an effect beside the loop, and the
     * controller never hears about its failure — so the attempt after a failed
     * first load waits the healthy interval rather than the retry floor, which
     * on a slow cadence is the difference between seconds and a minute.
     */
    const h = harness();
    let ticks = 0;
    const loop = new PollingController({
      intervalMs: 30_000,
      firstRetryMs: 2_500,
      maxBackoffMs: 30_000,
      immediate: true,
      tick: () => { ticks += 1; throw new Error("gateway refused"); },
      environment: h.environment,
    });
    loop.start();
    await Promise.resolve();

    assert.equal(ticks, 1, "the first attempt waited a full interval");
    await h.advance(2_500);
    assert.equal(ticks, 2, "the first failure never entered the backoff");
    loop.stop();
  });

  it("still spends nothing on a tab nobody is looking at", async () => {
    const h = harness({ hidden: true });
    let ticks = 0;
    const loop = new PollingController({
      intervalMs: 1_000,
      immediate: true,
      tick: () => { ticks += 1; },
      environment: h.environment,
    });
    loop.start();
    await Promise.resolve();

    assert.equal(ticks, 0, "an immediate start ignored the hidden gate");
    assert.ok(h.pending() > 0, "and left no timer behind, so it can never resume");
    loop.stop();
  });
});

describe("a slow tick does not stack", () => {
  it("waits for the previous tick before scheduling the next", async () => {
    const h = harness();
    let started = 0;
    let release: null | (() => void) = null;
    const fire = () => release?.();
    const loop = new PollingController({
      intervalMs: 1_000,
      tick: () => {
        started += 1;
        return new Promise<void>((resolve) => { release = resolve; });
      },
      environment: h.environment,
    });
    loop.start();

    await h.advance(1_000);
    assert.equal(started, 1);
    await h.advance(10_000);
    assert.equal(started, 1, "setInterval semantics: ticks stacked while one was in flight");

    fire();
    await Promise.resolve();
    await Promise.resolve();
    await h.advance(1_000);
    assert.equal(started, 2, "the loop did not resume after the slow tick finished");
    loop.stop();
  });
});

describe("stop means stop", () => {
  it("cancels the timer and unsubscribes", async () => {
    const h = harness();
    let ticks = 0;
    const loop = new PollingController({
      intervalMs: 1_000,
      tick: () => { ticks += 1; },
      environment: h.environment,
    });
    loop.start();
    await h.advance(1_000);
    loop.stop();
    await h.advance(60_000);
    assert.equal(ticks, 1, "a stopped loop kept polling");
    assert.equal(h.pending(), 0, "a stopped loop left a timer behind");

    await h.setHidden(true);
    await h.setHidden(false);
    assert.equal(ticks, 1, "a stopped loop still answered visibilitychange");
  });

  it("treats a zero interval as a genuine pause", async () => {
    const h = harness();
    let ticks = 0;
    const loop = new PollingController({
      intervalMs: 0,
      tick: () => { ticks += 1; },
      environment: h.environment,
    });
    loop.start();
    await h.advance(60_000);
    assert.equal(ticks, 0, "Paused is a cadence the console offers; it must mean no polling");
    loop.stop();
  });
});
