import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { createSecondHand } from "../lib/shared-second-hand";

const root = join(import.meta.dirname, "..");
const stamp = readFileSync(join(root, "components/workspace/FreshnessStamp.tsx"), "utf8");

describe("the workspace owns one shared second hand", () => {
  it("starts one timer for many subscribers and stops it after the last leaves", () => {
    let now = 1_000;
    let started = 0;
    let stopped = 0;
    let tick: () => void = () => assert.fail("the shared timer never started");
    const clock = createSecondHand({
      now: () => now,
      start: (publish) => {
        started += 1;
        tick = publish;
        return 7;
      },
      stop: (handle) => {
        assert.equal(handle, 7);
        stopped += 1;
      },
    });

    let first = 0;
    let second = 0;
    const leaveFirst = clock.subscribe(() => { first += 1; });
    const leaveSecond = clock.subscribe(() => { second += 1; });
    assert.equal(started, 1);
    assert.equal(clock.getSnapshot(), 1_000);

    now = 2_000;
    tick();
    assert.deepEqual([first, second, clock.getSnapshot()], [1, 1, 2_000]);

    leaveFirst();
    assert.equal(stopped, 0);
    leaveSecond();
    assert.equal(stopped, 1);
  });

  it("does not allocate a component-local interval for each freshness stamp", () => {
    assert.match(stamp, /useSharedSecondHand\(\)/);
    assert.doesNotMatch(stamp, /useEffect|useState|setInterval|clearInterval/);
  });

  it("has a stable server snapshot for hydration", () => {
    const clock = createSecondHand({
      now: () => 42,
      start: () => 1,
      stop: () => undefined,
    });
    assert.equal(clock.getServerSnapshot(), 0);
    assert.equal(clock.getServerSnapshot(), clock.getServerSnapshot());
  });
});
