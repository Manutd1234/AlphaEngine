/**
 * The terminal-distribution simulation must be deterministic in its seed,
 * indifferent to how it is chunked (the worker and the main-thread fallback
 * step it differently and must not disagree), and internally consistent —
 * loss quantiles ordered, histogram accounting for every path.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { mcResultDegeneracy } from "@/components/risk/mc-degeneracy";
import { parseMcSeed } from "@/components/risk/McParameterRail";
import {
  createMcSimulation,
  mcLossConfidences,
  mcResamplerOf,
  mcWorkerSource,
  type McDistributionRequest,
  type McDistributionResult,
  type McResampler,
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
      const idx = stationaryBootstrapIndices(n, meanBlockLength, rand, request.horizonBars);
      let multiple = 1;
      for (let i = 0; i < request.horizonBars; i++) multiple *= 1 + request.returns[idx[i]];
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

describe("the horizon is a number of steps, not a slice of the driver", () => {
  /**
   * The regression these two hold. `bootstrapIndices` was called with the
   * horizon as its ONLY size, so it served as the index range as well as the
   * path length and every draw landed in `[0, horizonBars)` — the driver's
   * OLDEST bars. On a moving-average winner those are the warm-up, where
   * `lib/engine/combo.ts:167-169` writes exact 0.0 because `lagged === 0`, so
   * the card refused a perfectly healthy driver and reported the refusal as a
   * property of the data. The `% n` at the read masked it: with
   * `horizonBars <= returns.length` it is an identity map, which reads as a
   * deliberate wrap rather than a range that was never wide enough to need one.
   *
   * Neither case could be caught by the full-run parity replay above, which
   * transcribed the same call and so asserted the implementation against
   * itself. These assert against the DRIVER instead — 60 warm-up zeros in
   * front of 340 live bars, asked at a 60-bar horizon, which is the exact
   * shape that reproduced the blank card.
   */
  const warmUpDriver = (): number[] => [
    ...Array.from({ length: 60 }, () => 0),
    ...syntheticReturns(340, 23),
  ];

  const finished = (overrides: Partial<McDistributionRequest> = {}) => {
    const sim = createMcSimulation({
      returns: warmUpDriver(),
      horizonBars: 60,
      paths: 2_000,
      seed: 4_242,
      equity: 1_000_000,
      ...overrides,
    });
    sim.step(sim.total);
    return sim.finish();
  };

  it("draws from the whole driver, not from its first horizonBars", () => {
    assert.equal(
      mcResultDegeneracy(finished()),
      null,
      "340 live bars behind a 60-bar warm-up is a distribution, not a driver with nothing in it",
    );
  });

  it("the block length still moves the tail when the driver outlasts the horizon", () => {
    // Two block lengths that can only reach the warm-up zeros produce the
    // same single outcome, so this pair reads identical under the defect and
    // the resampler control looks inert — the second way the same bug showed.
    const at = (meanBlockLength: number) => finished({ meanBlockLength }).loss.p95;
    assert.notEqual(at(5), at(40), "the block length reached no bar that differed from any other");
  });
});

describe("the resampler is a choice, and the result says which one ran", () => {
  /**
   * The fixture is the contract between the two implementations. Python's
   * `MonteCarlo.resampler` derives its answer from the same field by the same
   * rule and `tests/test_mc_resampler.py` holds it to this same table, so a
   * run named "stationary" in the chat card cannot be an i.i.d. draw on the
   * workspace card.
   */
  const fixture = JSON.parse(
    readFileSync(fileURLToPath(new URL("./fixtures/mc-resampler-parity.json", import.meta.url)), "utf8"),
  ) as {
    resamplerByBlock: Array<{ meanBlockLength: number; resampler: McResampler }>;
    derivedBlockLength: Array<{ observations: number; meanBlockLength: number }>;
    contradictions: Array<{ resampler: McResampler; meanBlockLength: number }>;
    lossQuantiles: {
      sortedTerminalPnl: number[];
      bands: Array<{ confidence: number; loss: number }>;
    };
  };

  it("names the resampler from the block length, as the committed table does", () => {
    for (const row of fixture.resamplerByBlock) {
      assert.equal(mcResamplerOf({ meanBlockLength: row.meanBlockLength }), row.resampler);
    }
  });

  it("defaults to the derived block length, at every sample size in the table", () => {
    for (const row of fixture.derivedBlockLength) {
      const result = run({ returns: syntheticReturns(row.observations, 11), paths: 100, horizonBars: 2 });
      assert.equal(result.meanBlockLength, row.meanBlockLength, `${row.observations} observations`);
      assert.equal(mcResamplerOf(result), "stationary");
    }
  });

  it("asking for the default explicitly changes nothing at all", () => {
    // The parity reference is a request that names neither field. If saying
    // "stationary" out loud moved a single number, that reference would be
    // describing a simulation nobody runs any more.
    assert.deepEqual(run({ resampler: "stationary" }), run());
  });

  it("i.i.d. is a block of one bar, by either spelling", () => {
    const chosen = run({ resampler: "iid" });
    const spelled = run({ meanBlockLength: 1 });
    assert.equal(chosen.meanBlockLength, 1);
    assert.equal(mcResamplerOf(chosen), "iid");
    // The old spelling still means what it meant, draw for draw.
    assert.deepEqual(chosen, spelled);
    // And it is genuinely a different distribution from the blocked draw.
    assert.notEqual(chosen.pnl.mean, run().pnl.mean);
  });

  it("refuses a contradictory pair instead of picking a winner", () => {
    for (const row of fixture.contradictions) {
      assert.throws(
        () => createMcSimulation({
          returns: syntheticReturns(400, 7),
          horizonBars: 30,
          paths: 200,
          seed: 5,
          equity: 1_000_000,
          resampler: row.resampler,
          meanBlockLength: row.meanBlockLength,
        }),
        /i\.i\.d\./,
        `${row.resampler} with a block of ${row.meanBlockLength} must be refused`,
      );
    }
  });
});

describe("the loss confidences are a choice, and the labels follow them", () => {
  const fixture = JSON.parse(
    readFileSync(fileURLToPath(new URL("./fixtures/mc-resampler-parity.json", import.meta.url)), "utf8"),
  ) as { lossQuantiles: { sortedTerminalPnl: number[]; bands: Array<{ confidence: number; loss: number }> } };

  it("maps a confidence to the quantile the committed table names", () => {
    // `percentile` is the library function the factory's inlined copy is
    // pinned against by the full-run parity test above, so checking the rule
    // here checks the rule the simulation runs. Python's `_loss_band` is held
    // to the same rows.
    for (const band of fixture.lossQuantiles.bands) {
      assert.equal(
        -percentile(fixture.lossQuantiles.sortedTerminalPnl, 100 - band.confidence),
        band.loss,
        `confidence ${band.confidence}`,
      );
    }
  });

  it("a default result carries no bands, and reads back as 50/95/99", () => {
    const result = run();
    assert.equal(result.lossBands, undefined, "an extra key would break the parity reference");
    assert.deepEqual(mcLossConfidences(result), [50, 95, 99]);
  });

  it("a custom triple is reported at the confidences it was computed at", () => {
    const result = run({ lossConfidences: [90, 99, 99.9] });
    assert.deepEqual(mcLossConfidences(result), [90, 99, 99.9]);
    assert.deepEqual(result.lossBands?.map((band) => band.loss), [
      result.loss.p50,
      result.loss.p95,
      result.loss.p99,
    ]);
    // The mildest band is no longer the median, which is the whole point of
    // asking for it: at 90 it is a real tail figure.
    assert.notEqual(result.loss.p50, -result.pnl.p50);
  });
});

describe("the seed is shown and overridable, and never invented", () => {
  it("an override draws a different distribution and is reported back", () => {
    const overridden = run({ seed: 12_345 });
    assert.equal(overridden.seed, 12_345);
    assert.notEqual(overridden.pnl.mean, run().pnl.mean);
  });

  it("a box holding something that is not a seed yields null, not zero", () => {
    // `Number("")` is 0 and `Number("12x")` is NaN; either would run a real
    // simulation under a seed nobody chose, which the card refuses to do.
    assert.equal(parseMcSeed(""), null);
    assert.equal(parseMcSeed("  "), null);
    assert.equal(parseMcSeed("12x"), null);
    assert.equal(parseMcSeed("-4"), null);
    assert.equal(parseMcSeed("1.5"), null);
    assert.equal(parseMcSeed("4294967296"), null, "a uint32 is the widest seed mulberry32 keeps");
    assert.equal(parseMcSeed("0"), 0, "zero is a seed a reader may deliberately choose");
    assert.equal(parseMcSeed(" 4294967295 "), 4_294_967_295);
  });
});
