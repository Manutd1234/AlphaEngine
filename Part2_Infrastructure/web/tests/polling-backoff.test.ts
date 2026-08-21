/**
 * What a polling loop does when the thing it polls stops answering — and what
 * it tells the reader while it waits.
 *
 * One of the four things fourteen hand-rolled loops each decided separately,
 * and the most expensive: ten of them had no backoff at all, so a gateway that
 * went down was met by a fixed-cadence hammer from every open tab until it
 * came back.
 *
 * The disclosure half is here for the same reason the curve is. `DataTierBadge`
 * renders "Retrying automatically in about 8s", and that number has to come
 * from the loop rather than from a second implementation of the same
 * arithmetic beside it: a countdown that disagrees with the timer it describes
 * is worse than no countdown. So the curve, its retry floor, its ceiling, its
 * recovery and what it reports at each step are one concern, pinned together.
 *
 * Driven by a fake clock, which is the point of the machine being a class
 * rather than a hook — none of the fourteen was ever unit-tested because none
 * of them could be. `tests/helpers/fake-clock.ts` holds the harness; the
 * visibility and lifecycle halves of this contract share it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PollingController } from "../lib/polling";

import { fakeClock } from "./helpers/fake-clock";

describe("a failing loop backs off instead of hammering", () => {
  it("grows geometrically and stops at the ceiling", async () => {
    const h = fakeClock();
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
    const h = fakeClock();
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
    const h = fakeClock();
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
    const h = fakeClock();
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
      environment: fakeClock().environment,
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
    const h = fakeClock();
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
    const h = fakeClock();
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
    const h = fakeClock();
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
