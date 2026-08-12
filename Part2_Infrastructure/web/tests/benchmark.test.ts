/**
 * Comparison against an external instrument.
 *
 * Two things are being defended here, and they are not the arithmetic — the
 * regression is `regress()`, which `quant.test.ts` already covers.
 *
 * The first is the JOIN. Two vendors rarely stamp the same bar with the same
 * epoch, so the failure mode is an empty or near-empty intersection producing a
 * beta that looks measured and is not. The second is the ROUTE'S WHITELIST,
 * which is here because the benchmark work is what surfaced it: the sanitiser
 * carried a hand-written set of three strategies while the engines had grown to
 * twenty-six, silently coercing the other twenty-three to `ma_cross` on the way
 * in.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { bucketKey, compareToBenchmark, MIN_ALIGNED_BARS } from "@/lib/benchmark";
import { STRATEGY_LABELS, type Bar, type SeriesPoint } from "@/lib/types";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const DAY = 864e5;

/**
 * Deterministic bar returns with real variation.
 *
 * The first draft of these fixtures used a constant per-bar return, and every
 * comparison came back null — correctly. A constant regressor has zero variance,
 * so the design matrix is singular and `regress` refuses rather than inventing a
 * coefficient. That is the behaviour a degenerate feature set should have, so it
 * is now asserted below on purpose instead of being tripped over.
 */
function wiggle(n: number, drift: number, amplitude = 0.01): number[] {
  return Array.from({ length: n }, (_, i) => drift + Math.sin(i * 1.7) * amplitude);
}

/** A strategy equity curve compounding the given per-bar returns. */
function seriesFrom(returns: number[], startMs = 0, stepMs = DAY): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  let equity = 1;
  for (let i = 0; i <= returns.length; i++) {
    out.push({
      t: startMs + i * stepMs,
      close: 100, fast: null, slow: null, position: 1,
      equity, buyHold: 1, drawdown: 0,
    });
    if (i < returns.length) equity *= 1 + returns[i];
  }
  return out;
}

function barsFrom(returns: number[], startMs = 0, stepMs = DAY): Bar[] {
  const out: Bar[] = [];
  let price = 100;
  for (let i = 0; i <= returns.length; i++) {
    out.push({ t: startMs + i * stepMs, o: price, h: price, l: price, c: price, v: 1e6 });
    if (i < returns.length) price *= 1 + returns[i];
  }
  return out;
}

const series = (n: number, drift: number, startMs = 0, stepMs = DAY) =>
  seriesFrom(wiggle(n, drift), startMs, stepMs);
const bars = (n: number, drift: number, startMs = 0, stepMs = DAY) =>
  barsFrom(wiggle(n, drift), startMs, stepMs);

describe("the join is the part that goes wrong", () => {
  it("aligns a vendor that stamps midnight with one that stamps mid-session", () => {
    // The real case: FMP dates a daily bar 00:00:00Z, another vendor stamps the
    // session open. Joining on raw epochs finds nothing in common; both fall in
    // the same day bucket.
    const strategy = series(120, 0.001, 0);
    const benchmark = bars(120, 0.001, 13 * 36e5); // 13:00 the same days
    const out = compareToBenchmark(strategy, benchmark, "1d", "SPY");
    assert.ok(out, "a half-day stamp offset emptied the intersection");
    assert.ok(out.alignedBars > 100, `only ${out.alignedBars} bars aligned`);
  });

  it("refuses to report on too few aligned bars rather than reporting a number", () => {
    // A beta on twenty overlapping bars is a number, and printing it beside a
    // t-statistic makes it look like a measurement.
    const out = compareToBenchmark(series(120, 0.001), bars(20, 0.001), "1d", "SPY");
    assert.equal(out, null);
  });

  it("returns null when nothing lines up at all", () => {
    // Two years apart. The important property is null rather than a fit on the
    // handful of coincidences a looser join would manufacture.
    const out = compareToBenchmark(series(300, 0.001, 0), bars(300, 0.001, 900 * DAY), "1d", "SPY");
    assert.equal(out, null);
  });

  it("never spans a gap in the benchmark", () => {
    // A missing benchmark bar must drop that return, not join across it and
    // report a two-day move as a one-day one — which inflates the benchmark's
    // volatility and deflates the strategy's beta.
    //
    // Each hole costs exactly two returns: the one ending at the missing bar
    // and the one starting from it. A join that spanned gaps would lose one.
    const strategy = series(200, 0.001);
    const complete = bars(200, 0.002);
    const holed = complete.filter((_, i) => i % 7 !== 3);
    const holes = complete.length - holed.length;

    const dense = compareToBenchmark(strategy, complete, "1d", "SPY")!;
    const sparse = compareToBenchmark(strategy, holed, "1d", "SPY")!;
    const lost = dense.alignedBars - sparse.alignedBars;
    assert.ok(
      lost >= holes * 2 - 2,
      `${holes} holes cost only ${lost} returns — the join is spanning them`,
    );
  });

  it("buckets by the interval, not by a fixed day", () => {
    assert.equal(bucketKey(0, "1d"), bucketKey(86_399_999, "1d"));
    assert.notEqual(bucketKey(0, "1h"), bucketKey(36e5, "1h"));
  });

  it("reports how many bars it used, because a small number is a warning", () => {
    const out = compareToBenchmark(series(150, 0.001), bars(150, 0.001), "1d", "SPY")!;
    assert.ok(out.alignedBars >= MIN_ALIGNED_BARS);
    assert.ok(out.alignedBars <= 150);
  });
});

describe("the statistics say what they claim to", () => {
  const benchmarkReturns = wiggle(300, 0.0007);

  it("a strategy that IS the benchmark has beta 1 and no alpha", () => {
    const out = compareToBenchmark(
      seriesFrom(benchmarkReturns), barsFrom(benchmarkReturns), "1d", "SPY",
    )!;
    assert.ok(Math.abs(out.beta - 1) < 1e-6, `beta ${out.beta}`);
    assert.ok(Math.abs(out.alphaAnnualised) < 1e-6, `alpha ${out.alphaAnnualised}`);
    assert.ok(Math.abs(out.correlation - 1) < 1e-6);
    assert.ok(out.trackingError < 1e-9, "identical series should not track apart");
  });

  it("twice the benchmark's moves reads as beta 2, not as alpha", () => {
    // The distinction the whole panel exists for: leverage is not skill, and a
    // measure that cannot separate them will call every levered run alpha.
    const out = compareToBenchmark(
      seriesFrom(benchmarkReturns.map((r) => 2 * r)), barsFrom(benchmarkReturns), "1d", "SPY",
    )!;
    assert.ok(Math.abs(out.beta - 2) < 1e-3, `beta ${out.beta}`);
    assert.ok(Math.abs(out.alphaAnnualised) < 1e-6, `alpha ${out.alphaAnnualised} should be ~0`);
  });

  it("a constant drag against the same moves reads as negative alpha", () => {
    const out = compareToBenchmark(
      seriesFrom(benchmarkReturns.map((r) => r - 0.0005)), barsFrom(benchmarkReturns), "1d", "SPY",
    )!;
    assert.ok(Math.abs(out.beta - 1) < 1e-3, `beta ${out.beta}`);
    assert.ok(out.alphaAnnualised < -0.05, `alpha ${out.alphaAnnualised} should be clearly negative`);
    assert.ok(out.trackingError < 1e-6, "a constant drag is not tracking error");
  });

  it("reports the benchmark's own drawdown, not the strategy's", () => {
    // The strategy here rises; the benchmark falls hard. A panel showing the
    // strategy's drawdown under the benchmark's name would be reassuring and
    // wrong.
    const out = compareToBenchmark(series(300, 0.001), bars(300, -0.004), "1d", "SPY")!;
    assert.ok(out.maxDrawdown < -0.4, `benchmark drawdown ${out.maxDrawdown}`);
    assert.ok(out.totalReturn < -0.4, `benchmark return ${out.totalReturn}`);
  });

  it("leaves the information ratio undefined rather than dividing by zero", () => {
    const out = compareToBenchmark(
      seriesFrom(benchmarkReturns), barsFrom(benchmarkReturns), "1d", "SPY",
    )!;
    assert.equal(out.informationRatio, null);
  });

  it("fails closed on a benchmark that never moves", () => {
    // A constant regressor has zero variance and a singular design matrix.
    // `regress` returns null rather than a coefficient, and this must survive as
    // "no comparison" rather than a beta of 0 presented as a measurement.
    const flat = new Array(300).fill(0);
    assert.equal(compareToBenchmark(series(300, 0.001), barsFrom(flat), "1d", "SPY"), null);
  });
});

describe("the panel keeps the four absent cases apart", () => {
  const panel = read("../components/research/BenchmarkPanel.tsx");
  const page = read("../app/dashboard/page.tsx");

  it("is mounted in the attribution section", () => {
    assert.match(page, /import BenchmarkPanel/);
    assert.match(page, /<BenchmarkPanel/);
  });

  it("says which benchmark was requested when the comparison is missing", () => {
    // "No comparison available" for both "you did not pick one" and "the one
    // you picked would not load" is one sentence for two different actions.
    assert.match(panel, /requested\s*\?/s);
    assert.match(panel, /No benchmark selected/);
  });

  it("names alignment as a possible cause rather than implying a missing feature", () => {
    assert.match(panel, /timestamps lined up|empty intersection/);
  });

  it("does not present an insignificant alpha as a finding", () => {
    assert.match(panel, /not distinguishable from zero/);
    assert.match(panel, /alphaPValue/);
  });

  it("keeps the OLS caveat with the number it qualifies", () => {
    assert.match(panel, /Newey/);
  });
});

describe("the sanitiser accepts every strategy the engines implement", () => {
  const route = read("../app/api/backtest/route.ts");

  it("derives the whitelist instead of listing it again", () => {
    // The bug: a hand-written set of three that stayed three while the engines
    // grew to twenty-six, silently coercing twenty-three of them to `ma_cross`.
    // Invisible because the coercion is by design — a stale whitelist looks
    // exactly like a client sending nonsense.
    assert.match(route, /new Set\(Object\.keys\(STRATEGY_LABELS\)\)/);
    assert.doesNotMatch(
      route, /new Set\(\["ma_cross"/,
      "the route is back to a hand-written strategy list",
    );
  });

  it("has more than three strategies to accept", () => {
    // Guards the derivation itself: if `STRATEGY_LABELS` were ever emptied or
    // renamed, the set above would be silently empty and every request would
    // coerce to the default again.
    assert.ok(Object.keys(STRATEGY_LABELS).length >= 26);
  });

  it("treats a benchmark equal to the traded symbol as no benchmark", () => {
    // A regression of a series on itself has beta 1, R² 1 and alpha 0 — a
    // perfectly well-formed way of saying nothing.
    assert.match(route, /candidate === symbol/);
  });
});
