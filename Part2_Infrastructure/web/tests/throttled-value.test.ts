/**
 * The three properties that separate a throttle from a lie.
 *
 * The header and the metric tiles twitched because several sources wrote React
 * state faster than a reader can read a number. Buffering that is easy; getting
 * it wrong is easier, and each way of getting it wrong is a defect this desk
 * has a name for:
 *
 *   - no leading edge, and the first value of every stream arrives a window
 *     late — a spinner-shaped hole at the front of live data;
 *   - no trailing flush, and the LAST value of a burst is dropped, so the
 *     figure on screen is whichever one happened to land on a boundary. A
 *     stale last figure is a correctness bug here, not a cosmetic one;
 *   - a queue instead of a coalesce, and a sixty-frame burst replays frame by
 *     frame after it ended, which makes the screen lag the feed;
 *   - a null check guarding the pending slot, and "the measurement went
 *     missing" is the one update the throttle silently eats.
 *
 * Driven by a fake clock, which is why the machine is a class rather than only
 * a hook — the same argument `polling.test.ts` makes for `PollingController`.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  THROTTLE_INTERVAL_MS,
  ValueThrottle,
  type ThrottleEnvironment,
} from "../lib/use-throttled-value";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

/** Comments explain the traps by name; a scan must not read the explanation as
 *  the offence. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/** A clock the test advances by hand. No timers, no waiting. */
function throttled<T>(intervalMs: number = THROTTLE_INTERVAL_MS) {
  let now = 0;
  let nextHandle = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  const published: T[] = [];

  const environment: Partial<ThrottleEnvironment> = {
    setTimeout: (handler, ms) => {
      const handle = nextHandle++;
      timers.set(handle, { at: now + ms, run: handler });
      return handle;
    },
    clearTimeout: (handle) => void timers.delete(handle),
  };

  const machine = new ValueThrottle<T>((value) => published.push(value), intervalMs, environment);

  return {
    machine,
    published,
    /** Advance time, firing everything due. Timers opened during the advance
     *  are honoured only if they fall inside the window too. */
    advance(ms: number) {
      const target = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].run();
      }
      now = target;
    },
    scheduled: () => timers.size,
  };
}

// ---------------------------------------------------------------------------
// Leading edge
// ---------------------------------------------------------------------------

describe("the first value of a burst is never delayed", () => {
  it("publishes on the push, before any clock has moved", () => {
    const t = throttled<number>();
    t.machine.push(1);
    assert.deepEqual(t.published, [1], "the leading edge waited for its own window");
  });

  it("leads again once a quiet window has closed", () => {
    const t = throttled<number>();
    t.machine.push(1);
    t.advance(THROTTLE_INTERVAL_MS);
    // Nothing was held, so the machine went idle rather than holding a window
    // open that nobody is filling.
    assert.equal(t.machine.open, false);
    t.machine.push(2);
    assert.deepEqual(t.published, [1, 2]);
  });
});

// ---------------------------------------------------------------------------
// Trailing flush
// ---------------------------------------------------------------------------

describe("the last value of a burst is never lost", () => {
  it("flushes the newest held value when the window closes", () => {
    const t = throttled<number>();
    t.machine.push(1);
    t.machine.push(2);
    t.machine.push(3);
    assert.deepEqual(t.published, [1], "a value was published inside the open window");
    t.advance(THROTTLE_INTERVAL_MS);
    assert.deepEqual(t.published, [1, 3], "the settled figure was dropped on the floor");
  });

  it("flush() publishes the held value now and restarts the window", () => {
    const t = throttled<number>();
    t.machine.push(1);
    t.machine.push(2);
    t.machine.flush();
    assert.deepEqual(t.published, [1, 2]);
    // The flush counts as an update, so the next value queues behind a window
    // rather than leading straight past it.
    t.machine.push(3);
    assert.deepEqual(t.published, [1, 2]);
    t.advance(THROTTLE_INTERVAL_MS);
    assert.deepEqual(t.published, [1, 2, 3]);
  });

  it("flush() with nothing held republishes nothing", () => {
    const t = throttled<number>();
    t.machine.push(1);
    t.machine.flush();
    assert.deepEqual(t.published, [1], "flushing an empty window repeated a value the consumer had");
  });
});

// ---------------------------------------------------------------------------
// Coalescing
// ---------------------------------------------------------------------------

describe("a burst collapses to one update per interval", () => {
  it("sixty frames inside one window cost two renders, not sixty", () => {
    const t = throttled<number>();
    for (let frame = 1; frame <= 60; frame++) t.machine.push(frame);
    assert.deepEqual(t.published, [1], "the burst was not coalesced");
    t.advance(THROTTLE_INTERVAL_MS);
    assert.deepEqual(t.published, [1, 60], "a queue replayed the burst instead of collapsing it");
  });

  it("a steady stream publishes once per interval and never twice", () => {
    const t = throttled<number>(THROTTLE_INTERVAL_MS);
    // One value every 10ms for a second — roughly what a 100Hz feed does.
    for (let step = 1; step <= 100; step++) {
      t.machine.push(step);
      t.advance(10);
    }
    // Leading edge at t=0, then one trailing publish per closed window.
    const windows = Math.floor(1_000 / THROTTLE_INTERVAL_MS);
    assert.equal(
      t.published.length, windows + 1,
      `a second of 100Hz input produced ${t.published.length} renders, not ${windows + 1}`,
    );
    // And what it published is the LATEST of each window, never a replayed one.
    assert.deepEqual([...t.published].sort((a, b) => a - b), t.published);
  });

  it("holds exactly one value, whatever the burst length", () => {
    const t = throttled<number>();
    t.machine.push(1);
    for (let frame = 2; frame <= 500; frame++) t.machine.push(frame);
    assert.equal(t.machine.holding, true);
    t.advance(THROTTLE_INTERVAL_MS);
    assert.equal(t.machine.holding, false);
    assert.deepEqual(t.published, [1, 500]);
  });
});

// ---------------------------------------------------------------------------
// Null is a value, not an absence of one
// ---------------------------------------------------------------------------

describe("a missing measurement stays missing", () => {
  it("passes a null straight through on the leading edge", () => {
    const t = throttled<number | null>();
    t.machine.push(null);
    assert.deepEqual(t.published, [null]);
    // Not zero, not undefined, not a placeholder.
    assert.strictEqual(t.published[0], null);
  });

  it("flushes a null held inside a window as a null", () => {
    const t = throttled<number | null>();
    t.machine.push(12);
    t.machine.push(null);
    t.advance(THROTTLE_INTERVAL_MS);
    assert.deepEqual(t.published, [12, null], "the moment a figure went missing was eaten");
    assert.strictEqual(t.published[1], null);
  });

  it("passes an undefined through as undefined", () => {
    const t = throttled<number | undefined>();
    t.machine.push(7);
    t.machine.push(undefined);
    t.advance(THROTTLE_INTERVAL_MS);
    assert.deepEqual(t.published, [7, undefined]);
    assert.strictEqual(t.published[1], undefined);
  });

  it("does not mistake a held falsy value for an empty window", () => {
    // The pending slot is guarded by a Symbol for exactly this: 0, "", false
    // and null are all values a measurement can take.
    for (const value of [0, "", false, null] as const) {
      const t = throttled<unknown>();
      t.machine.push("first");
      t.machine.push(value);
      t.advance(THROTTLE_INTERVAL_MS);
      assert.deepEqual(t.published, ["first", value], `a held ${JSON.stringify(value)} was dropped`);
    }
  });
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe("the window closes cleanly when the consumer goes away", () => {
  it("stop() clears the timer and publishes nothing after it", () => {
    const t = throttled<number>();
    t.machine.push(1);
    t.machine.push(2);
    t.machine.stop();
    assert.equal(t.scheduled(), 0, "a timer outlived the consumer that owned it");
    t.advance(THROTTLE_INTERVAL_MS * 4);
    assert.deepEqual(t.published, [1], "a state write landed on an unmounted consumer");
  });

  it("a retime takes effect on the next window, not the open one", () => {
    const t = throttled<number>(THROTTLE_INTERVAL_MS);
    t.machine.push(1);
    t.machine.retime(1_000);
    t.machine.push(2);
    t.advance(THROTTLE_INTERVAL_MS);
    assert.deepEqual(t.published, [1, 2], "the open window was recomputed underneath the consumer");
    t.machine.push(3);
    t.advance(THROTTLE_INTERVAL_MS);
    assert.deepEqual(t.published, [1, 2], "the new interval was not applied to the next window");
    t.advance(1_000);
    assert.deepEqual(t.published, [1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// The shared cadence, and the React wrapper over the machine
// ---------------------------------------------------------------------------

describe("one named cadence, not a literal per call site", () => {
  it("sits in the band a metric card can be read at", () => {
    assert.ok(
      THROTTLE_INTERVAL_MS >= 250 && THROTTLE_INTERVAL_MS <= 500,
      `${THROTTLE_INTERVAL_MS}ms is outside the 250-500ms band`,
    );
  });

  it("the hook seeds from the incoming value, so the first paint is the real one", () => {
    const source = code(read("../lib/use-throttled-value.ts"));
    assert.match(source, /useState<T>\(value\)/);
    // A default argument on the interval, so no call site has to name it.
    assert.match(source, /intervalMs: number = THROTTLE_INTERVAL_MS/);
  });

  it("the hook stops its machine on unmount", () => {
    const source = code(read("../lib/use-throttled-value.ts"));
    assert.match(source, /useEffect\(\(\) => \(\) => throttle\.current\?\.stop\(\), \[\]\)/);
  });

  it("coerces nothing on the way through", () => {
    const source = code(read("../lib/use-throttled-value.ts"));
    assert.doesNotMatch(source, /\?\? 0/, "the throttle invented a zero for an absent measurement");
    assert.doesNotMatch(source, /\?\? null/, "the throttle substituted its own idea of absence");
  });

  it("says in its own text what may never be buffered", () => {
    const source = read("../lib/use-throttled-value.ts");
    for (const phrase of ["trading halt", "order fill", "breaker trip"]) {
      assert.ok(source.includes(phrase), `the module never warns about a ${phrase}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Where it is applied, and where it deliberately is not
// ---------------------------------------------------------------------------

describe("the buffered sources are the read-only ones", () => {
  it("the health hook buffers its latency and cache figures", () => {
    const health = code(read("../lib/use-system-health.ts"));
    assert.match(health, /const decisionLatency = useThrottledValue\(/);
    assert.match(health, /const cacheHitRate = useThrottledValue\(/);
  });

  it("the health hook leaves the snapshot and the incident count immediate", () => {
    const health = code(read("../lib/use-system-health.ts"));
    // `health` carries the breakers, the outages and the trading-path state;
    // `degraded` is the header's incident flag, not one of its counters.
    assert.doesNotMatch(health, /useThrottledValue\(health\)/);
    assert.doesNotMatch(health, /const degraded = useThrottledValue/);
    assert.doesNotMatch(health, /const actionResult = useThrottledValue/);
  });

  it("the header's counters and its latency stats share one window", () => {
    const page = code(read("../app/dashboard/page.tsx"));
    assert.match(page, /const headerSummary = useThrottledValue\(systems\.health\?\.summary \?\? null\)/);
    assert.match(page, /providersReady=\{headerSummary\?\.ready \?\? null\}/);
    assert.match(page, /providersTotal=\{headerSummary\?\.total \?\? null\}/);
    // Same window as the counters, so the chip cannot pair a new network
    // figure with the previous decision figure.
    assert.match(page, /latency=\{headerSummary\?\.upstreamLatency \?\? headerSummary\?\.latency \?\? null\}/);
    // The whole snapshot is never buffered — the consoles read state off it.
    assert.doesNotMatch(page, /useThrottledValue\(systems\.health\)/);
  });

  it("the live book coalesces on the shared cadence rather than a literal", () => {
    const book = code(read("../lib/livebook.ts"));
    assert.match(book, /const PUBLISH_HZ = 1_000 \/ THROTTLE_INTERVAL_MS/);
    assert.match(book, /publishHz = PUBLISH_HZ/);
    // The publish tick already replaces N per-message renders with one; a
    // second buffer over it would only add latency to a live order book.
    assert.doesNotMatch(book, /useThrottledValue\(/);
    assert.doesNotMatch(book, /publishHz = \d/, "the cadence went back to a bare literal");
  });

  it("the Monte Carlo progress is buffered but its verdict is not", () => {
    const mc = code(read("../lib/use-mc-distribution.ts"));
    // The worker posts a frame every 500 paths inside a tight loop.
    assert.match(mc, /const progress = useThrottledValue\(state\.progress\)/);
    assert.match(mc, /state\.status === "running" \? \{ \.\.\.state, progress \} : state/);
    assert.doesNotMatch(mc, /useThrottledValue\(state\)/, "a finished simulation waits behind a window");
  });
});

describe("nothing safety-critical is buffered", () => {
  /**
   * Each of these carries a fact a desk acts on within the interval a throttle
   * would hold it: the tape carries fills and rejects, the stream carries the
   * kill switch and the risk state behind it, and the book carries
   * `trading_halted` and `halted_symbols`. Buffering any of them is 300ms of a
   * desk trading against a state that has already changed.
   */
  for (const [file, what] of [
    ["../lib/use-desk-tape.ts", "order fills and rejects"],
    ["../lib/use-desk-stream.ts", "the kill switch and the risk state"],
    ["../lib/use-book.ts", "the trading halt and the halted symbols"],
  ] as const) {
    it(`${file.split("/").pop()} publishes ${what} immediately`, () => {
      assert.doesNotMatch(
        code(read(file)),
        /useThrottledValue/,
        `${file} buffers ${what} — see the warning in lib/use-throttled-value.ts`,
      );
    });
  }

  it("the header's halt control is fed straight off the book", () => {
    const page = code(read("../app/dashboard/page.tsx"));
    assert.match(page, /halted: book\.book\.trading_halted/);
    assert.match(page, /haltedSymbols: book\.book\.halted_symbols/);
    // The incident flag beside the throttled counters stays unbuffered.
    assert.match(page, /degraded=\{systems\.degraded\}/);
  });
});
