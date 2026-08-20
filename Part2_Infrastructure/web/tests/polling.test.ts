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
