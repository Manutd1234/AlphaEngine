/**
 * Pairing circuit trips to their recoveries, and the five ways that miscounts.
 *
 * Each of these is a way the ledger would read BETTER than the truth, which is
 * the direction that matters on a reliability surface: a merged incident, a
 * cooldown counted as a fix, a self-inflicted drill counted as a recovery, a
 * 1/1 rendered as 100%, or an evicted opening silently shrinking the trip count
 * without saying so.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MIN_TRIPS_FOR_RATE, deriveRemediation } from "../lib/remediation";
import type { TraceEvent } from "../lib/observability";

let seq = 0;
const event = (
  source: string,
  fields: Record<string, unknown>,
  ts = ++seq * 1000,
): TraceEvent =>
  ({ seq: seq, ts, level: "info", source, message: "", fields, origin: "server" }) as TraceEvent;

const breaker = (provider: string, state: string, ts: number, extra: Record<string, unknown> = {}) =>
  event("Breaker", { provider, state, ...extra }, ts);

const cursor = (over = {}) => ({ oldest: 1, latest: 99, retained: 99, capacity: 600, ...over });

describe("a trip is paired with its own closure", () => {
  it("measures how long the circuit stayed open", () => {
    const model = deriveRemediation(
      [breaker("fmp", "open", 1_000, { failures: 5 }), breaker("fmp", "closed", 61_000)],
      cursor(),
    );
    assert.equal(model.trips, 1);
    assert.equal(model.pairs[0].elapsedMs, 60_000);
    assert.equal(model.pairs[0].failures, 5);
    assert.equal(model.stillOpen, 0);
  });

  it("does not pair across providers", () => {
    const model = deriveRemediation(
      [breaker("fmp", "open", 1_000), breaker("tiingo", "closed", 2_000)],
      cursor(),
    );
    assert.equal(model.trips, 1);
    assert.equal(model.stillOpen, 1, "fmp's trip was closed by tiingo's recovery");
  });

  it("counts two openings before a closure as two trips, not one", () => {
    /**
     * Overwriting the pending entry would merge two incidents into one and
     * halve the trip count — the ledger would read as a calmer week than it was.
     */
    const model = deriveRemediation(
      [
        breaker("fmp", "open", 1_000),
        breaker("fmp", "open", 5_000),
        breaker("fmp", "closed", 9_000),
      ],
      cursor(),
    );
    assert.equal(model.trips, 2);
    assert.equal(model.stillOpen, 1);
  });

  it("ignores a closure whose opening aged out of the ring", () => {
    const model = deriveRemediation([breaker("fmp", "closed", 9_000)], cursor());
    assert.equal(model.trips, 0, "a closure invented a trip it never saw open");
  });
});

describe("a cooldown is not a recovery", () => {
  it("treats half_open as neither an opening nor a closure", () => {
    /**
     * `breakerOpen()` emits half_open every time a cooldown elapses, whether or
     * not the probe that follows succeeds. Counting it would make every
     * cooldown look like a fix.
     */
    const model = deriveRemediation(
      [breaker("fmp", "open", 1_000), breaker("fmp", "half_open", 30_000)],
      cursor(),
    );
    assert.equal(model.trips, 1);
    assert.equal(model.stillOpen, 1);
    assert.equal(model.recoveredAutomatically, 0);
  });
});

describe("automatic and operator recoveries are told apart", () => {
  it("reads the operator flag the reset now emits", () => {
    const model = deriveRemediation(
      [
        breaker("a", "open", 1_000), breaker("a", "closed", 2_000),
        breaker("b", "open", 3_000), breaker("b", "closed", 4_000, { by: "operator" }),
      ],
      cursor(),
    );
    assert.equal(model.recoveredAutomatically, 1);
    assert.equal(model.recoveredByOperator, 1);
  });

  it("counts drills separately and never as recoveries", () => {
    // A simulated outage is self-inflicted; clearing it is not a recovery from
    // anything, and folding it in would inflate the rate with the desk's own
    // tests.
    const model = deriveRemediation(
      [
        event("Operator", { action: "simulate_outage", provider: "fmp" }, 1_000),
        event("Operator", { action: "clear_outage", provider: "fmp" }, 2_000),
      ],
      cursor(),
    );
    assert.equal(model.trips, 0);
    assert.equal(model.recoveredAutomatically, 0);
    assert.equal(model.drills.simulated, 1);
    assert.equal(model.drills.cleared, 1);
  });
});

describe("the ledger refuses the claims it cannot support", () => {
  it("withholds a rate below the sample floor", () => {
    const one = deriveRemediation(
      [breaker("a", "open", 1_000), breaker("a", "closed", 2_000)],
      cursor(),
    );
    assert.equal(one.rate, null, "1/1 rendered as 100% is theatre");
    assert.equal(one.trips, 1);

    const enough = deriveRemediation(
      Array.from({ length: MIN_TRIPS_FOR_RATE }, (_, i) => [
        breaker(`p${i}`, "open", i * 10_000 + 1_000),
        breaker(`p${i}`, "closed", i * 10_000 + 2_000),
      ]).flat(),
      cursor(),
    );
    assert.equal(enough.rate, 1);
  });

  it("says the counts are a floor when the ring has evicted lines", () => {
    const model = deriveRemediation([], cursor({ oldest: 42 }));
    assert.equal(model.truncated, true);
    assert.equal(deriveRemediation([], cursor({ oldest: 1 })).truncated, false);
  });

  it("reports a clean instance as clean rather than as unmeasured", () => {
    const model = deriveRemediation([], cursor());
    assert.equal(model.trips, 0);
    assert.equal(model.rate, null);
    assert.equal(model.medianCloseMs, null);
    assert.equal(model.longestCloseMs, null);
  });

  it("summarises durations without averaging over the unresolved", () => {
    // An open circuit has no duration; including it as zero would drag the
    // median toward "we recover instantly".
    const model = deriveRemediation(
      [
        breaker("a", "open", 1_000), breaker("a", "closed", 11_000),
        breaker("b", "open", 2_000), breaker("b", "closed", 62_000),
        breaker("c", "open", 3_000),
      ],
      cursor(),
    );
    assert.equal(model.stillOpen, 1);
    assert.equal(model.longestCloseMs, 60_000);
    assert.equal(model.medianCloseMs, 10_000);
  });
});
