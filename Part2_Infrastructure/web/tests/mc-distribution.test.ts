/**
 * The terminal-distribution simulation must be deterministic in its seed,
 * indifferent to how it is chunked (the worker and the main-thread fallback
 * step it differently and must not disagree), and internally consistent —
 * loss quantiles ordered, histogram accounting for every path.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createMcSimulation, type McDistributionRequest } from "@/lib/mc-distribution";
import { mcSeedFor } from "@/lib/montecarlo";
import { mulberry32 } from "@/lib/random";

function syntheticReturns(n: number, seed: number): number[] {
  const rand = mulberry32(seed);
  // Mildly skewed daily-ish returns: enough texture for quantiles to spread.
  return Array.from({ length: n }, () => (rand() - 0.48) * 0.04);
}

function run(overrides: Partial<McDistributionRequest> = {}) {
  const request: McDistributionRequest = {
    returns: syntheticReturns(400, 7),
    horizonBars: 60,
    paths: 2_000,
    seed: mcSeedFor("deadbeefcafe0123", 20, 80),
    equity: 1_000_000,
    ...overrides,
  };
  const sim = createMcSimulation(request);
  sim.step(sim.total);
  return sim.finish();
}

describe("determinism", () => {
  it("same seed, same everything", () => {
    assert.deepEqual(run(), run());
  });

  it("a different seed draws a different distribution", () => {
    const a = run();
    const b = run({ seed: 1234 });
    assert.notEqual(a.pnl.mean, b.pnl.mean);
  });

  it("chunking does not change the draw stream", () => {
    const request: McDistributionRequest = {
      returns: syntheticReturns(400, 7),
      horizonBars: 60,
      paths: 1_000,
      seed: 42,
      equity: 1_000_000,
    };
    const oneShot = createMcSimulation(request);
    oneShot.step(oneShot.total);
    const chunked = createMcSimulation(request);
    while (chunked.done < chunked.total) chunked.step(7);
    assert.deepEqual(chunked.finish(), oneShot.finish());
  });
});

describe("internal consistency", () => {
  it("loss quantiles are ordered and tie back to the P&L landmarks", () => {
    const result = run();
    assert.ok(result.loss.p99 >= result.loss.p95, "p99 loss below p95 loss");
    assert.ok(result.loss.p95 >= result.loss.p50, "p95 loss below median loss");
    assert.ok(result.pnl.worst <= result.pnl.p50 && result.pnl.p50 <= result.pnl.best);
    assert.equal(result.loss.p50, -result.pnl.p50);
    assert.ok(-result.loss.p99 >= result.pnl.worst, "p99 loss beyond the worst path");
  });

  it("the histogram accounts for every path", () => {
    const result = run();
    assert.ok(result.histogram);
    const counted = result.histogram.counts.reduce((acc, v) => acc + v, 0);
    assert.equal(counted, result.paths);
    assert.equal(result.histogram.edges.length, result.histogram.counts.length + 1);
  });

  it("probLoss is a probability", () => {
    const result = run();
    assert.ok(result.probLoss >= 0 && result.probLoss <= 1);
  });

  it("path count clamps to the floor rather than running a junk sample", () => {
    const result = run({ paths: 3 });
    assert.equal(result.paths, 100);
  });

  it("an empty driver distribution refuses instead of returning zeros", () => {
    assert.throws(() => createMcSimulation({
      returns: [],
      horizonBars: 60,
      paths: 1_000,
      seed: 1,
      equity: 1_000_000,
    }));
  });
});
