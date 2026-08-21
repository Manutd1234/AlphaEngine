/**
 * When a polling loop starts, what happens while a tick is still in flight,
 * and what `stop` has to mean.
 *
 * The last of the four things fourteen hand-rolled loops each decided
 * separately: several of them used `setInterval`, which stacks ticks when one
 * runs long, so a slow gateway turned one loop into a queue of concurrent
 * requests against the endpoint that was already struggling.
 *
 * The start and stop edges are here with it because they are the same
 * property seen from either end — a loop owns exactly one outstanding timer at
 * a time. An immediate first tick must still respect the gate and still feed
 * its own outcome into the schedule; a stopped loop must leave nothing behind,
 * neither a timer nor a visibility subscription, because a loop that keeps
 * polling after its owner unmounted is invisible until the request count is.
 *
 * Driven by a fake clock, which is the point of the machine being a class
 * rather than a hook — none of the fourteen was ever unit-tested because none
 * of them could be. `tests/helpers/fake-clock.ts` holds the harness; the
 * visibility and backoff halves of this contract share it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PollingController } from "../lib/polling";

import { fakeClock } from "./helpers/fake-clock";

describe("a loop may start now rather than one interval from now", () => {
  it("fires at start, and schedules from that outcome", async () => {
    /**
     * The alternative is a first fetch in an effect beside the loop, and the
     * controller never hears about its failure — so the attempt after a failed
     * first load waits the healthy interval rather than the retry floor, which
     * on a slow cadence is the difference between seconds and a minute.
     */
    const h = fakeClock();
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
    const h = fakeClock({ hidden: true });
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
    const h = fakeClock();
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
    const h = fakeClock();
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
    const h = fakeClock();
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
