/**
 * The history behind the scalars, and the four ways bucketing invents data.
 *
 * The samples have been on the server since latency was first recorded and only
 * `statsOf` aggregates ever escaped, so the Data tab could report a p95 and had
 * no way to say whether it was climbing. Exposing them is cheap; exposing them
 * *honestly* is what these assertions are for:
 *
 *  1. A bucket with too little traffic is `null`, never `0` — a minute with no
 *     calls is not a fast minute, and a zero would draw the best-looking point
 *     on the chart out of an absence.
 *  2. A key with no plottable bucket is omitted entirely, so "no line" and "a
 *     flat line at the axis" stay different.
 *  3. The bucket statistic and the headline come from the same pool, or the
 *     sparkline and the chip beside it will disagree on screen.
 *  4. Samples outside the window never appear, however they are timestamped.
 */

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  LATENCY_BUCKET_MIN_SAMPLES,
  LATENCY_BUCKET_MS,
  latencyStats,
  latencyWindow,
  recordLatency,
  resetTelemetry,
} from "../lib/observability";

const NOW = 1_800_000_000_000;

beforeEach(() => resetTelemetry({ latency: true }));

/** Record `count` samples inside the bucket `minutesAgo` minutes back. */
function fill(key: string, minutesAgo: number, count: number, ms: number) {
  const at = NOW - minutesAgo * 60_000 - 1_000;
  for (let i = 0; i < count; i += 1) recordLatency(key, ms, true, at);
}

describe("bucketing keeps absence and speed apart", () => {
  it("returns null for a bucket below the sample floor", () => {
    fill("alpha", 2, LATENCY_BUCKET_MIN_SAMPLES - 1, 40);
    fill("alpha", 1, LATENCY_BUCKET_MIN_SAMPLES + 2, 40);
    const window = latencyWindow(NOW);
    const series = window.series.find((s) => s.key === "alpha");
    assert.ok(series, "alpha should be plottable — one bucket cleared the floor");
    const thin = series.p50.filter((v) => v === 0);
    assert.equal(thin.length, 0, "a thin bucket became a zero rather than a gap");
    assert.ok(series.p50.some((v) => v == null), "no bucket was withheld");
    assert.ok(series.p50.some((v) => v != null), "no bucket was plotted");
  });

  it("omits a key that is never plottable rather than drawing it flat", () => {
    fill("whisper", 3, LATENCY_BUCKET_MIN_SAMPLES - 1, 10);
    assert.equal(
      latencyWindow(NOW).series.find((s) => s.key === "whisper"),
      undefined,
      "an all-null row was emitted, which draws as a missing line rather than as no line",
    );
  });

  it("counts every sample it saw, even in buckets it would not plot", () => {
    // `n` is what lets the caption say "3 quiet minutes" rather than implying
    // the source was silent.
    fill("beta", 2, 1, 25);
    fill("beta", 1, LATENCY_BUCKET_MIN_SAMPLES, 25);
    const series = latencyWindow(NOW).series.find((s) => s.key === "beta");
    assert.ok(series);
    assert.equal(series.n.reduce((a, b) => a + b, 0), LATENCY_BUCKET_MIN_SAMPLES + 1);
  });
});

describe("the buckets and the headline describe one pool", () => {
  it("agrees with latencyStats when every sample lands in one bucket", () => {
    /**
     * The property that stops the sparkline and the p95 chip beside it from
     * being two different readings: both must resolve through the same
     * windowed sample set, overlay included.
     */
    for (const ms of [10, 20, 30, 40, 50]) fill("gamma", 1, 1, ms);
    const stats = latencyStats("gamma", NOW);
    const series = latencyWindow(NOW).series.find((s) => s.key === "gamma");
    assert.ok(series);
    const plotted = series.p50.filter((v): v is number => v != null);
    assert.equal(plotted.length, 1, "the fixture should occupy exactly one bucket");
    assert.equal(plotted[0], stats.p50);
  });
});

describe("the window is a window", () => {
  it("drops samples older than the retention period", () => {
    fill("delta", 60, 10, 90);
    assert.equal(latencyWindow(NOW).series.find((s) => s.key === "delta"), undefined);
  });

  it("reports its own geometry so a caller can label the axis", () => {
    fill("epsilon", 1, LATENCY_BUCKET_MIN_SAMPLES, 12);
    const window = latencyWindow(NOW);
    assert.equal(window.bucketMs, LATENCY_BUCKET_MS);
    assert.equal(window.minSamplesPerBucket, LATENCY_BUCKET_MIN_SAMPLES);
    assert.equal(window.startedAt, NOW - window.buckets * window.bucketMs);
    for (const series of window.series) {
      assert.equal(series.p50.length, window.buckets);
      assert.equal(series.n.length, window.buckets);
    }
  });

  it("is empty on a cold instance, and empty is a real answer", () => {
    const window = latencyWindow(NOW);
    assert.deepEqual(window.series, []);
    assert.ok(window.buckets > 0, "geometry must still be reported so the caption can render");
  });
});
