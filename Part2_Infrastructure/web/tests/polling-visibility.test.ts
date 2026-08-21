/**
 * What a polling loop does when nobody is looking, and when they come back.
 *
 * Two of the four things fourteen hand-rolled loops each decided separately,
 * and both correspond to a defect measured in the tree before
 * `PollingController` existed: three loops that never checked
 * `document.hidden`, and thirteen that did not revalidate on return.
 *
 * Neither is cosmetic. A loop that ignores the hidden flag spends quota and
 * gateway budget on a tab nobody is reading; a loop that does not revalidate
 * makes the reader who comes back stare at data up to a full interval old,
 * which on a 30-second cadence is exactly long enough to act on.
 *
 * Driven by a fake clock, which is the point of the machine being a class
 * rather than a hook — none of the fourteen was ever unit-tested because none
 * of them could be. `tests/helpers/fake-clock.ts` holds the harness; the
 * backoff and lifecycle halves of this contract share it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PollingController } from "../lib/polling";

import { fakeClock } from "./helpers/fake-clock";

describe("a polling loop does not spend anything on a hidden tab", () => {
  it("skips the tick but stays alive", async () => {
    const h = fakeClock({ hidden: true });
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
    const h = fakeClock({ hidden: true });
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
    const h = fakeClock();
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
