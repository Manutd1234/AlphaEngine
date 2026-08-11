/**
 * The terminal-distribution simulation must be deterministic in its seed,
 * indifferent to how it is chunked (the worker and the main-thread fallback
 * step it differently and must not disagree), and internally consistent —
 * loss quantiles ordered, histogram accounting for every path.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createMcSimulation,
  mcWorkerSource,
  type McDistributionRequest,
  type McDistributionResult,
  type McWorkerMessage,
} from "@/lib/mc-distribution";
import { mcSeedFor, stationaryBootstrapIndices } from "@/lib/montecarlo";
import { percentile } from "@/lib/quant";
import { mulberry32 } from "@/lib/random";
import { histogramBins } from "@/lib/stats";

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

describe("the inlined helpers are the library helpers", () => {
  // The factory inlines mulberry32, the stationary bootstrap, nearest-rank
  // percentile and histogramBins because it stringifies into the worker Blob.
  // This replays the whole simulation with the ORIGINAL lib functions and
  // demands the identical result — if any inlined copy drifts, this fails.
  it("full-run parity with lib/montecarlo + lib/random + lib/quant + lib/stats", () => {
    const request: McDistributionRequest = {
      returns: syntheticReturns(400, 7),
      horizonBars: 60,
      paths: 500,
      seed: 90210,
      equity: 1_000_000,
    };
    const sim = createMcSimulation(request);
    sim.step(sim.total);
    const actual = sim.finish();

    const n = request.returns.length;
    const meanBlockLength = Math.min(100, Math.max(5, Math.round(Math.sqrt(n))));
    const rand = mulberry32(request.seed);
    const pnl: number[] = [];
    for (let p = 0; p < request.paths; p++) {
      const idx = stationaryBootstrapIndices(request.horizonBars, meanBlockLength, rand);
      let multiple = 1;
      for (let i = 0; i < request.horizonBars; i++) multiple *= 1 + request.returns[idx[i] % n];
      pnl.push(request.equity * (multiple - 1));
    }
    const sorted = [...pnl].sort((a, b) => a - b);
    assert.deepEqual(actual.pnl, {
      mean: pnl.reduce((acc, v) => acc + v, 0) / request.paths,
      p50: percentile(sorted, 50),
      best: sorted[sorted.length - 1],
      worst: sorted[0],
    });
    assert.deepEqual(actual.loss, {
      p50: -percentile(sorted, 50),
      p95: -percentile(sorted, 5),
      p99: -percentile(sorted, 1),
    });
    assert.deepEqual(actual.histogram, histogramBins(pnl, 32));
  });

  it("the worker program is executable and agrees with the direct call", () => {
    // Run the Blob source in Node with a stubbed `self` — an executable check
    // that the stringified factory really is a working worker program.
    const request: McDistributionRequest = {
      returns: syntheticReturns(200, 3),
      horizonBars: 30,
      paths: 200,
      seed: 555,
      equity: 250_000,
    };
    const messages: McWorkerMessage[] = [];
    const self = {
      onmessage: null as ((event: { data: McDistributionRequest }) => void) | null,
      postMessage: (message: McWorkerMessage) => void messages.push(message),
    };
    new Function("self", mcWorkerSource())(self);
    assert.ok(self.onmessage, "the worker program installed no message handler");
    self.onmessage!({ data: request });

    const result = messages.find((m): m is { type: "result"; result: McDistributionResult } => m.type === "result");
    assert.ok(result, "the worker never posted a result");
    const direct = createMcSimulation(request);
    direct.step(direct.total);
    assert.deepEqual(result.result, direct.finish());
    assert.ok(messages.some((m) => m.type === "progress"), "no progress was posted");
  });
});
