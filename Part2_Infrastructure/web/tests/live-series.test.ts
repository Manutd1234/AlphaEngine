/**
 * A poll's arrival is one frame, not one repaint per value.
 *
 * Eight sections now carry a live tape, and every one repaints the moment its
 * own poll lands. Polls are not synchronised — each section asks on its own
 * 20-second cadence, warmed from a different hover — so a desk with several
 * sections mounted repaints in a scatter, one cut per section, and a number
 * that changes from 1.06 to 1.04 does so as a cut rather than a move.
 *
 * `useBufferedValue` coalesces arrivals into ONE commit per 300ms window and
 * hands the settled value to `NumberTicker`, which already counts to its new
 * value over `--dur-reveal`, reserves its width in tabular figures so the
 * count cannot reflow its neighbours, and honours `prefers-reduced-motion`
 * itself. So this file adds no second ticker: it adds the window, and the
 * ticker does the gliding.
 *
 * ONE SCHEDULER FOR THE DESK, NOT ONE TIMER PER TAPE, and that is the property
 * worth pinning. A `setTimeout` inside each hook is N timers that fire
 * independently, which is the scatter again with a delay on it. A single
 * module-level scheduler batches every subscriber into the same frame — the
 * shape `use-live-series.ts` uses for its store, for the same reason.
 *
 * DURATIONS READ THE LADDER. The window is a named constant with its reason;
 * the glide is `NumberTicker`'s and reads `--dur-reveal`. `motion.test.ts`
 * fails a hardcoded transition duration in CSS and cannot see a JS constant,
 * so this file holds the JS half: the window is named, once, with a reason.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { read, stripNonCode } from "./helpers/workspace-sources";

const hook = read("../lib/coherence/use-buffered-value.ts");
const code = stripNonCode(hook);

describe("the source this reads was actually loaded", () => {
  it("use-buffered-value.ts is non-empty", () => assert.ok(hook.trim().length > 600, "the hook read as empty or missing"));
});

describe("one scheduler for the desk", () => {
  it("keeps the pending set and the timer at module level, not per hook", () => {
    // Module-level `let`/`const` outside any function: the batch belongs to the
    // module, so every tape that arrives inside one window is in the same batch.
    assert.match(code, /^(let|const) pending\b/m, "the pending set is not module-level, so each hook batches alone");
    assert.match(code, /^let (timer|scheduled)\b/m, "the timer handle is not module-level, so each hook runs its own");
  });

  it("never schedules a second timer while one is pending", () => {
    // The whole point of a batch: an arrival inside the window joins it. A
    // hook that calls setTimeout unconditionally is N timers with a delay on.
    const schedule = code.slice(code.indexOf("function schedule"), code.indexOf("\n}", code.indexOf("function schedule")));
    assert.match(schedule, /if \((timer|scheduled)[^)]*\) return/, "schedule() starts a timer even when one is already pending");
  });

  it("names the window once, with its reason", () => {
    assert.match(hook, /export const BUFFER_MS = 300;/, "the window is not a named constant, or is not 300ms");
    const decl = hook.indexOf("export const BUFFER_MS");
    const above = hook.slice(Math.max(0, decl - 900), decl);
    assert.match(above, /\/\*\*[\s\S]*\*\//, "the window carries no comment saying why 300 and not another number");
  });

  it("hardcodes no other duration", () => {
    // Every other number in the file that looks like a duration must be the
    // one named constant; a second literal is the ladder violation motion.test
    // cannot see from CSS.
    const literals = [...code.matchAll(/\b(\d{2,4})\b/g)].map((m) => Number(m[1])).filter((n) => n >= 16 && n <= 5000 && n !== 300);
    assert.deepEqual(literals, [], `these look like durations and are not BUFFER_MS: ${literals.join(", ")}`);
  });
});

describe("what the hook hands back", () => {
  it("returns the settled value, and null stays null", () => {
    // A null arriving mid-window must not be replaced by the previous number:
    // "we do not know" is a reading, and buffering it into "still 1.06" is the
    // `?? 0` defect wearing a delay.
    assert.match(code, /value: number \| null/, "the hook does not accept a nullable value");
    // The VALUE path, not the whole file. `slots.get(key)?.version ?? 0` is a
    // version counter whose correct initial state IS zero; banning it there
    // would be the null-honesty rule applied to a thing that is not a
    // measurement. The first run of this guard did exactly that. What must
    // never carry `??` is the line that returns the reading.
    const ret = code.slice(code.indexOf("export function useBufferedValue"));
    const returns = [...ret.matchAll(/^\s*return [^;]+;/gm)].map((m) => m[0]);
    assert.ok(returns.length > 0, "the hook returns nothing");
    for (const line of returns) {
      assert.doesNotMatch(line, /\?\?/, `a null is coerced on the way out of the buffer: ${line.trim()}`);
    }
  });

  it("is a hook, and reads the store through useSyncExternalStore", () => {
    assert.match(code, /export function useBufferedValue\(/);
    assert.match(code, /useSyncExternalStore\(/, "the hook does not subscribe; a buffered value nobody is subscribed to never repaints");
  });
});
