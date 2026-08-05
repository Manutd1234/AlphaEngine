import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { monteCarloBands, stationaryBootstrapIndices } from "../lib/montecarlo";
import { mulberry32 } from "../lib/random";
import { runSweep } from "../lib/engine";
import { syntheticBars } from "../lib/marketdata";
import { DEFAULT_REQUEST } from "../lib/types";

const constantReturns = (n: number, r: number) => new Float64Array(n).fill(r);
const everyIndex = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("stationary bootstrap", () => {
  it("covers [0, n) with exactly n draws", () => {
    const idx = stationaryBootstrapIndices(500, 22, mulberry32(7));
    assert.equal(idx.length, 500);
    for (const i of idx) assert.ok(i >= 0 && i < 500);
  });

  it("continuation frequency matches the mean block length", () => {
    const n = 5000;
    const L = 5;
    const idx = stationaryBootstrapIndices(n, L, mulberry32(11));
    let continues = 0;
    for (let i = 1; i < n; i++) {
      if (idx[i] === (idx[i - 1] + 1) % n) continues++;
    }
    const rate = continues / (n - 1);
    // Expected 1 − 1/L = 0.8, plus a ~1/n sliver where a fresh block happens
    // to land on the successor.
    assert.ok(Math.abs(rate - 0.8) < 0.03, `continuation rate ${rate}`);
  });

  it("mean block length 1 degenerates to iid (no forced continuation)", () => {
    const n = 2000;
    const idx = stationaryBootstrapIndices(n, 1, mulberry32(3));
    let continues = 0;
    for (let i = 1; i < n; i++) {
      if (idx[i] === (idx[i - 1] + 1) % n) continues++;
    }
    // Under iid the successor is hit with probability 1/n.
    assert.ok(continues / (n - 1) < 0.01);
  });
});

describe("monte carlo bands", () => {
  it("is deterministic in the seed and sensitive to it", () => {
    const returns = Float64Array.from({ length: 400 }, (_, i) => Math.sin(i) * 0.01);
    const sample = everyIndex(400).filter((i) => i % 4 === 0);
    const a = monteCarloBands(returns, sample, 42, { paths: 50 });
    const b = monteCarloBands(returns, sample, 42, { paths: 50 });
    const c = monteCarloBands(returns, sample, 43, { paths: 50 });
    assert.deepEqual(a, b);
    assert.notDeepEqual(a.p50, c.p50);
  });

  it("percentiles are ordered at every sampled bar", () => {
    const returns = Float64Array.from({ length: 600 }, (_, i) => ((i * 37) % 11 - 5) * 0.004);
    const sample = everyIndex(600).filter((i) => i % 3 === 0);
    const bands = monteCarloBands(returns, sample, 9, { paths: 120 });
    for (let j = 0; j < sample.length; j++) {
      assert.ok(bands.p05[j] <= bands.p25[j]);
      assert.ok(bands.p25[j] <= bands.p50[j]);
      assert.ok(bands.p50[j] <= bands.p75[j]);
      assert.ok(bands.p75[j] <= bands.p95[j]);
    }
    assert.ok(bands.terminal.p05 <= bands.terminal.p50);
    assert.ok(bands.terminal.p50 <= bands.terminal.p95);
  });

  it("a constant return has a degenerate cone: every band is the curve itself", () => {
    const r = 0.002;
    const n = 100;
    const bands = monteCarloBands(constantReturns(n, r), everyIndex(n), 1, { paths: 20 });
    for (let i = 0; i < n; i++) {
      const expected = (1 + r) ** (i + 1);
      for (const band of [bands.p05, bands.p50, bands.p95]) {
        assert.ok(Math.abs(band[i] - expected) < 1e-12, `bar ${i}`);
      }
    }
    assert.equal(bands.terminal.probLoss, 0);
  });

  it("all-zero returns give flat bands at 1", () => {
    const bands = monteCarloBands(constantReturns(50, 0), everyIndex(50), 5, { paths: 10 });
    for (let i = 0; i < 50; i++) {
      assert.equal(bands.p05[i], 1);
      assert.equal(bands.p95[i], 1);
    }
  });

  it("runSweep attaches bands aligned with the thinned series, JSON-safe", () => {
    const bars = syntheticBars("BTCUSDT", "4h", 1500);
    const out = runSweep(bars, { ...DEFAULT_REQUEST, walkForward: false }, "synthetic");
    assert.equal(out.monteCarlo.p05.length, out.series.length);
    assert.equal(out.monteCarlo.p95.length, out.series.length);
    assert.ok(out.monteCarlo.paths > 0);
    const round = JSON.parse(JSON.stringify(out.monteCarlo));
    assert.ok(Array.isArray(round.p50), "typed array leaked into the payload");
    assert.deepEqual(round, out.monteCarlo);
    // Same sweep, same cone.
    const again = runSweep(bars, { ...DEFAULT_REQUEST, walkForward: false }, "synthetic");
    assert.deepEqual(again.monteCarlo.p50, out.monteCarlo.p50);
  });
});
