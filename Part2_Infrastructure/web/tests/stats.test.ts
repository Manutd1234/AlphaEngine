/**
 * Statistics and engine invariants.
 *
 * The load-bearing test here is `refuses to endorse a sweep over pure noise`:
 * a research tool that reports the best Sharpe in a grid without deflating it
 * will recommend a random walk, and this is the test that catches that
 * regression.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { pctChange, rollingMax, rollingMin, rsi, shift1, sma } from "../lib/indicators";
import {
  deflatedSharpe,
  histogramBins,
  kurtosis,
  minTrackRecordLength,
  normCdf,
  normPpf,
  probabilisticSharpe,
  skewness,
  verdictFor,
} from "../lib/stats";
import { barsPerYear, buildPosition, paramGrid, runSweep } from "../lib/engine";
import { syntheticBars } from "./helpers/synthetic-bars";
import { DEFAULT_REQUEST, MAX_COMBOS, type Bar, type SweepRequest } from "../lib/types";

const close = (xs: number[]) => Float64Array.from(xs);

describe("indicators", () => {
  it("sma is NaN until its window is filled, then correct", () => {
    const out = sma(close([1, 2, 3, 4, 5]), 3);
    assert.ok(Number.isNaN(out[0]) && Number.isNaN(out[1]));
    assert.equal(out[2], 2);
    assert.equal(out[4], 4);
  });

  it("rolling max/min track the window", () => {
    const v = close([5, 1, 9, 3, 2]);
    assert.deepEqual([...rollingMax(v, 3).slice(2)], [9, 9, 9]);
    assert.deepEqual([...rollingMin(v, 3).slice(2)], [1, 1, 2]);
  });

  it("rolling extremes match a brute-force scan on random data", () => {
    const n = 400;
    const v = new Float64Array(n);
    for (let i = 0; i < n; i++) v[i] = Math.sin(i * 1.7) * 100 + Math.cos(i * 0.3) * 40;
    const w = 17;
    const fast = rollingMax(v, w);
    for (let i = w - 1; i < n; i++) {
      let m = -Infinity;
      for (let k = i - w + 1; k <= i; k++) m = Math.max(m, v[k]);
      assert.equal(fast[i], m, `mismatch at ${i}`);
    }
  });

  it("shift1 does not leak the current bar", () => {
    const out = shift1(close([1, 2, 3]));
    assert.ok(Number.isNaN(out[0]));
    assert.deepEqual([...out.slice(1)], [1, 2]);
  });

  it("rsi is bounded and saturates on a monotonic series", () => {
    const rising = close(Array.from({ length: 60 }, (_, i) => 100 + i));
    const out = rsi(rising, 14);
    for (let i = 1; i < out.length; i++) assert.ok(out[i] >= 0 && out[i] <= 100);
    assert.ok(out[59] > 99, "an unbroken rally should pin RSI near 100");
  });

  it("pctChange is zero on the first bar", () => {
    assert.equal(pctChange(close([10, 11]))[0], 0);
    assert.ok(Math.abs(pctChange(close([10, 11]))[1] - 0.1) < 1e-12);
  });
});

describe("normal distribution helpers", () => {
  it("normPpf matches known quantiles", () => {
    assert.ok(Math.abs(normPpf(0.5)) < 1e-9);
    assert.ok(Math.abs(normPpf(0.975) - 1.959964) < 1e-5);
    assert.ok(Math.abs(normPpf(0.005) + 2.575829) < 1e-5);
  });

  it("normCdf and normPpf round-trip", () => {
    for (const p of [0.01, 0.25, 0.5, 0.75, 0.99]) {
      assert.ok(Math.abs(normCdf(normPpf(p)) - p) < 1e-6, `round-trip failed at ${p}`);
    }
  });

  it("skew and kurtosis are ~0 and ~3 on symmetric data", () => {
    const xs: number[] = [];
    for (let i = -2000; i <= 2000; i++) xs.push(i / 1000);
    assert.ok(Math.abs(skewness(xs)) < 1e-9);
    assert.ok(Math.abs(kurtosis(xs) - 1.8) < 0.1, "uniform has kurtosis 1.8");
  });
});

describe("multiple-testing correction", () => {
  it("PSR rises with sample size", () => {
    const short = probabilisticSharpe(0.05, 0, 250, 0, 3);
    const long = probabilisticSharpe(0.05, 0, 2500, 0, 3);
    assert.ok(long > short);
    assert.ok(short >= 0 && long <= 1);
  });

  it("a bigger search raises the hurdle", () => {
    const small = Array.from({ length: 10 }, (_, i) => 0.02 + i * 0.001);
    const large = Array.from({ length: 500 }, (_, i) => 0.02 + (i % 20) * 0.001);
    const a = deflatedSharpe(small, 0.06, 2000, 0, 3);
    const b = deflatedSharpe(large, 0.06, 2000, 0, 3);
    assert.ok(b.expectedMax > a.expectedMax, "500 trials must clear a higher bar than 10");
    assert.ok(b.dsr < a.dsr);
  });

  it("the hurdle is never negative, even on a uniformly losing grid", () => {
    // Adding the sample mean back (a common implementation slip) would make this
    // negative and let a losing strategy clear it.
    const allLosing = Array.from({ length: 74 }, (_, i) => -0.03 + (i % 7) * 0.001);
    const { expectedMax } = deflatedSharpe(allLosing, -0.02, 2000, 0, 3);
    assert.ok(expectedMax >= 0, `hurdle went negative: ${expectedMax}`);
  });

  it("verdict downgrades a good DSR when out-of-sample is negative", () => {
    assert.equal(verdictFor(0.99, 1.2).level, "pass");
    assert.equal(verdictFor(0.99, -0.4).level, "fail");
    assert.equal(verdictFor(0.85, 0.3).level, "marginal");
    assert.equal(verdictFor(0.2, 2.0).level, "fail");
  });
});

describe("minimum track record length", () => {
  it("is the exact inverse of PSR: PSR at N* bars equals the confidence", () => {
    for (const [sr, skew, kurt, conf] of [
      [0.03, 0, 3, 0.95],
      [0.05, -0.8, 6, 0.95],
      [0.02, 0.5, 4, 0.99],
    ] as const) {
      const nStar = minTrackRecordLength(sr, 0, skew, kurt, conf);
      const psrAtNStar = probabilisticSharpe(sr, 0, nStar, skew, kurt);
      // Tolerance is set by the A&S erf approximation in normCdf (~1.5e-7),
      // not by the identity itself, which is exact.
      assert.ok(
        Math.abs(psrAtNStar - conf) < 1e-6,
        `PSR(${sr}) at N*=${nStar} is ${psrAtNStar}, expected ${conf}`,
      );
    }
  });

  it("matches the Gaussian hand calculation", () => {
    // Normal returns (skew 0, raw kurtosis 3): the variance term is
    // 1 + S²/2 — Lo (2002) — so N* = 1 + (1 + S²/2)·(z/S)², z = Φ⁻¹(0.95).
    const nStar = minTrackRecordLength(0.02, 0, 0, 3);
    const z = normPpf(0.95);
    assert.ok(Math.abs(nStar - (1 + (1 + 0.02 ** 2 / 2) * (z / 0.02) ** 2)) < 1e-9);
    assert.ok(Math.abs(nStar - 6766.2) < 1);
  });

  it("fat tails and negative skew lengthen the required record", () => {
    const base = minTrackRecordLength(0.03, 0, 0, 3);
    assert.ok(minTrackRecordLength(0.03, 0, -0.8, 3) > base, "negative skew");
    assert.ok(minTrackRecordLength(0.03, 0, 0, 8) > base, "fat tails");
    assert.ok(minTrackRecordLength(0.03, 0, 0, 3, 0.99) > base, "higher confidence");
    assert.ok(minTrackRecordLength(0.06, 0, 0, 3) < base, "bigger edge shortens");
  });

  it("no finite record proves an edge that is not there", () => {
    assert.equal(minTrackRecordLength(0, 0, 0, 3), Infinity);
    assert.equal(minTrackRecordLength(-0.02, 0, 0, 3), Infinity);
    assert.equal(minTrackRecordLength(0.02, 0.03, 0, 3), Infinity);
  });
});

describe("engine invariants", () => {
  const bars = syntheticBars("BTCUSDT", "4h", 1500);

  it("param grid enforces fast < slow and caps the search", () => {
    const wide: SweepRequest = {
      ...DEFAULT_REQUEST,
      fastMin: 2,
      fastMax: 200,
      fastStep: 1,
      slowMin: 3,
      slowMax: 400,
      slowStep: 1,
    };
    const grid = paramGrid(wide);
    assert.ok(grid.length <= MAX_COMBOS);
    assert.ok(grid.every(([f, s]) => f < s));
  });

  it("signals use no future information", () => {
    const c = Float64Array.from(bars.map((b) => b.c));
    const h = Float64Array.from(bars.map((b) => b.h));
    const l = Float64Array.from(bars.map((b) => b.l));
    const v = Float64Array.from(bars.map((b) => b.v));
    const full = buildPosition("ma_cross", bars, c, h, l, v, 10, 40, "long_only");
    const head = buildPosition(
      "ma_cross",
      bars.slice(0, 800),
      c.slice(0, 800),
      h.slice(0, 800),
      l.slice(0, 800),
      v.slice(0, 800),
      10,
      40,
      "long_only",
    );
    for (let i = 0; i < 800; i++) {
      assert.equal(full[i], head[i], `truncating the series changed bar ${i}`);
    }
  });

  it("a flat price series never trades", () => {
    const flat: Bar[] = bars.map((b) => ({ ...b, o: 100, h: 100, l: 100, c: 100 }));
    const out = runSweep(flat, { ...DEFAULT_REQUEST, walkForward: false }, "synthetic");
    assert.equal(out.best.trades, 0);
    assert.ok(Math.abs(out.best.totalReturn) < 1e-12);
  });

  it("higher costs never improve returns", () => {
    const cheap = runSweep(bars, { ...DEFAULT_REQUEST, feeBps: 0, slippageBps: 0, walkForward: false }, "synthetic");
    const dear = runSweep(bars, { ...DEFAULT_REQUEST, feeBps: 50, slippageBps: 50, walkForward: false }, "synthetic");
    assert.ok(dear.best.totalReturn <= cheap.best.totalReturn + 1e-12);
  });

  it("metrics stay inside their natural bounds", () => {
    const out = runSweep(bars, DEFAULT_REQUEST, "synthetic");
    for (const r of out.results) {
      assert.ok(r.maxDrawdown <= 0 && r.maxDrawdown >= -1, "drawdown out of range");
      assert.ok(r.exposure >= 0 && r.exposure <= 1, "exposure out of range");
      assert.ok(r.winRate >= 0 && r.winRate <= 1, "win rate out of range");
      assert.ok(r.fast < r.slow);
    }
    assert.ok(out.deflatedSharpeRatio >= 0 && out.deflatedSharpeRatio <= 1);
    assert.equal(out.series.length > 0, true);
  });

  it("min track record is JSON-safe and internally consistent", () => {
    const out = runSweep(bars, { ...DEFAULT_REQUEST, walkForward: false }, "synthetic");
    const ann = barsPerYear("4h");
    assert.deepEqual(JSON.parse(JSON.stringify(out.minTrackRecord)), out.minTrackRecord);
    for (const entry of [out.minTrackRecord.vsZero, out.minTrackRecord.vsSearchHurdle]) {
      if (entry.bars === null) {
        assert.equal(entry.years, null);
        assert.equal(entry.sufficient, null);
      } else {
        assert.ok(Math.abs((entry.years ?? 0) - entry.bars / ann) < 1e-12);
        assert.equal(entry.sufficient, out.bars >= entry.bars);
      }
    }
    // The search hurdle is at least as demanding as the zero benchmark.
    const { vsZero, vsSearchHurdle } = out.minTrackRecord;
    if (vsZero.bars !== null && vsSearchHurdle.bars !== null) {
      assert.ok(vsSearchHurdle.bars >= vsZero.bars);
    }

    // A flat series has no edge, so no finite record can prove one.
    const flat: Bar[] = bars.map((b) => ({ ...b, o: 100, h: 100, l: 100, c: 100 }));
    const flatOut = runSweep(flat, { ...DEFAULT_REQUEST, walkForward: false }, "synthetic");
    assert.equal(flatOut.minTrackRecord.vsZero.bars, null);
  });

  it("walk-forward scores on windows the parameters never saw", () => {
    const out = runSweep(bars, { ...DEFAULT_REQUEST, folds: 3 }, "synthetic");
    assert.equal(out.walkForward.length, 3);
    for (const f of out.walkForward) {
      assert.ok(f.trainEnd <= f.testStart, "train window overlaps the test window");
      assert.ok(f.chosenFast < f.chosenSlow);
    }
  });

  it("refuses to endorse a sweep over pure noise", () => {
    // A random walk has no edge. A tool that reports the grid's best Sharpe
    // without deflating it will recommend this anyway.
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand());

    let price = 100;
    const noise: Bar[] = [];
    for (let i = 0; i < 2000; i++) {
      const open = price;
      price *= Math.exp(gauss() * 0.01);
      noise.push({ t: i * 36e5, o: open, h: Math.max(open, price) * 1.001, l: Math.min(open, price) * 0.999, c: price, v: 1 });
    }

    const out = runSweep(noise, { ...DEFAULT_REQUEST, interval: "1h", walkForward: false }, "synthetic");
    assert.ok(out.expectedMaxSharpe > 0, "the search itself must create a hurdle");
    assert.ok(
      out.deflatedSharpeRatio < 0.95,
      `noise grid produced an allocatable DSR of ${out.deflatedSharpeRatio}`,
    );
    assert.equal(out.verdict.level, "fail");
  });

  it("knows how many bars a year holds", () => {
    assert.equal(barsPerYear("1h"), 8760);
    assert.equal(barsPerYear("1d"), 365);
    assert.equal(barsPerYear("nonsense"), 8760);
  });
});

describe("histogram binning", () => {
  it("bins a uniform range into equal widths", () => {
    const out = histogramBins([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 5)!;
    assert.equal(out.counts.length, 5);
    assert.equal(out.edges.length, 6);
    assert.equal(out.edges[0], 0);
    assert.equal(out.edges[5], 9);
    assert.equal(out.counts.reduce((a, b) => a + b, 0), 10);
  });

  it("puts the maximum inside the last bin rather than past the edge", () => {
    const out = histogramBins([0, 10], 2)!;
    assert.deepEqual(out.counts, [1, 1]);
  });

  it("a degenerate range is one bin, not an invented spread", () => {
    const out = histogramBins([3, 3, 3], 10)!;
    assert.deepEqual(out.edges, [3, 3]);
    assert.deepEqual(out.counts, [3]);
  });

  it("absence is null, never an empty chart", () => {
    assert.equal(histogramBins([], 10), null);
    assert.equal(histogramBins([NaN, Infinity], 10), null);
  });

  it("drops non-finite values instead of poisoning the range", () => {
    const out = histogramBins([1, 2, NaN, 3, Infinity], 2)!;
    assert.equal(out.counts.reduce((a, b) => a + b, 0), 3);
    assert.equal(out.edges[0], 1);
    assert.equal(out.edges[2], 3);
  });
});
