/**
 * The network plane: the polled upstream figure, the ring it is kept in, the
 * sparkline it is drawn as, and the caveat that says which plane it is.
 *
 * This is the SLOW number — a round trip over the wire, hundreds of
 * milliseconds — and its whole risk is being read as the fast one. So every
 * check here is about honesty rather than arithmetic:
 *
 *  • A FIGURE UNDER THE SAMPLE FLOOR IS MUTED, whatever it says. Three
 *    observations cannot support a p99, and a green chip drawn from three
 *    observations is a confident claim about nothing.
 *  • THE THRESHOLDS ARE THE DOCUMENTED ONES, tested at the boundary rather
 *    than near it, because a band that drifts by one is a band nobody notices
 *    has moved.
 *  • THE CAVEAT NAMES THE PLANE, THE POOL AND THE HOP. `formatNetworkCaveat`
 *    is where "network, polled" is written; the decision chip embeds this text
 *    rather than a number of its own, which is what keeps the µs plane and the
 *    ms plane from being confused in the one place they appear together.
 *
 * The ring and the sparkline are here because they are how this figure
 * survives a render: `appendLatencyHistory` must not append an unchanged
 * observation (which would draw a flat line out of one sample repeated), must
 * cap rather than grow without bound, and must not mutate the array React is
 * holding. `downsample` must keep the first and last points, since those are
 * the two a reader actually reads off a sparkline.
 *
 * Siblings, from the same module: `-decision-loop` (the five stages),
 * `-kill-switch` (the arming gate), `-decision-plane` (the in-process
 * microsecond plane, whose chip quotes the caveat built here).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LATENCY_BAD_MS,
  LATENCY_HISTORY_CAP,
  LATENCY_MIN_SAMPLES,
  LATENCY_WARN_MS,
  type LatencyHistoryPoint,
  appendLatencyHistory,
  downsample,
  formatLatencyChip,
  formatNetworkCaveat,
  latencyTone,
} from "../lib/overview-state";

describe("latencyTone", () => {
  it("small samples are muted regardless of the number", () => {
    assert.equal(latencyTone(5000, LATENCY_MIN_SAMPLES - 1).tone, "muted");
    assert.equal(latencyTone(null, 500).tone, "muted");
    assert.equal(latencyTone(50, 0).tone, "muted");
  });

  it("thresholds sit exactly at the documented boundaries", () => {
    assert.equal(latencyTone(LATENCY_WARN_MS - 1, LATENCY_MIN_SAMPLES).tone, "good");
    assert.equal(latencyTone(LATENCY_WARN_MS, LATENCY_MIN_SAMPLES).tone, "warn");
    assert.equal(latencyTone(LATENCY_BAD_MS - 1, LATENCY_MIN_SAMPLES).tone, "warn");
    assert.equal(latencyTone(LATENCY_BAD_MS, LATENCY_MIN_SAMPLES).tone, "bad");
  });

  it("error rate escalates the tone independently of speed", () => {
    assert.equal(latencyTone(100, 50, 0.06).tone, "warn");
    assert.equal(latencyTone(100, 50, 0.25).tone, "bad");
  });

  it("chip copy carries the honesty caveat", () => {
    const warm = formatLatencyChip({ p99: 120, n: 5, errorRate: 0 });
    assert.equal(warm.value, "p99 —");
    assert.ok(warm.caveat.includes("n=5"));
    const hot = formatLatencyChip({ p99: 321.4, n: 80, errorRate: 0.1 });
    assert.equal(hot.value, "p99 321ms");
    assert.ok(hot.caveat.includes("15-minute window"));
    assert.ok(hot.caveat.includes("n=80"));
  });
});

describe("appendLatencyHistory", () => {
  const point = (t: number, lastAt: number | null, n = 40): LatencyHistoryPoint => ({
    t,
    p99: 100 + t,
    errorRate: 0,
    n,
    lastAt,
  });

  it("appends fresh observations and caps at the ring size", () => {
    let history: LatencyHistoryPoint[] = [];
    for (let k = 0; k < LATENCY_HISTORY_CAP + 10; k++) {
      history = appendLatencyHistory(history, point(k, k));
    }
    assert.equal(history.length, LATENCY_HISTORY_CAP);
    assert.equal(history[history.length - 1].t, LATENCY_HISTORY_CAP + 9);
    assert.equal(history[0].t, 10, "oldest entries dropped first");
  });

  it("skips empty windows and unchanged lastAt", () => {
    const seeded = appendLatencyHistory([], point(1, 1000));
    assert.equal(appendLatencyHistory(seeded, point(2, 1000)).length, 1, "same lastAt must not append");
    assert.equal(appendLatencyHistory(seeded, point(2, 2000, 0)).length, 1, "n=0 must not append");
    assert.equal(appendLatencyHistory(seeded, point(2, 2000)).length, 2);
  });

  it("never mutates its input", () => {
    const original = [point(1, 1000)];
    const copy = [...original];
    appendLatencyHistory(original, point(2, 2000));
    assert.deepEqual(original, copy);
  });
});

describe("downsample", () => {
  it("preserves first and last and bounds the length", () => {
    const values = Array.from({ length: 500 }, (_, k) => k);
    const out = downsample(values, 64);
    assert.equal(out.length, 64);
    assert.equal(out[0], 0);
    assert.equal(out[out.length - 1], 499);
  });

  it("is the identity for short inputs", () => {
    assert.deepEqual(downsample([1, 2, 3], 64), [1, 2, 3]);
    assert.deepEqual(downsample([], 64), []);
  });
});

describe("formatNetworkCaveat", () => {
  it("says which plane it is and whether the pool is warm", () => {
    const warm = formatNetworkCaveat({ p99: 120, n: 5, errorRate: 0 });
    assert.match(warm, /network, polled/);
    assert.match(warm, /collecting n=5\/20/);
    const hot = formatNetworkCaveat({ p99: 321.4, n: 80, errorRate: 0.1 });
    assert.match(hot, /upstream p99 321 ms/);
    assert.match(hot, /15-min pool/);
    assert.match(hot, /error rate 10%/);
  });

  it("names the desk hop only when it has its own samples", () => {
    const withHop = formatNetworkCaveat({ p99: 500, n: 40, errorRate: 0 }, { p99: 24, n: 60 });
    assert.match(withHop, /desk hop p99 24\.0 ms/);
    const thinHop = formatNetworkCaveat({ p99: 500, n: 40, errorRate: 0 }, { p99: 24, n: 3 });
    assert.doesNotMatch(thinHop, /desk hop/);
  });
});
