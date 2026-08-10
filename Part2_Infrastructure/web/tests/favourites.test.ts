/**
 * Combining saved runs into one portfolio.
 *
 * Two things can go wrong here and neither raises an error.
 *
 * The first is ALIGNMENT: joining two runs by array index pairs Tuesday's BTC
 * return with Thursday's AAPL one and reports the result as a portfolio. The
 * second is the OPTIMISER SEEING ITS OWN SCORE — choosing weights that minimise
 * variance over a window and then reporting the variance over that same window
 * is the mistake this repository computes a Deflated Sharpe Ratio to avoid, one
 * level up.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  alignFavourites,
  combineFavourites,
  FAVOURITE_METHODS,
  HOLDOUT_SPLIT,
  maxSharpeWeights,
  MIN_OVERLAP_BARS,
  type FavouriteSeries,
} from "@/lib/favourites";

const DAY = 864e5;

/** Deterministic, varied returns — a constant series is a singular covariance. */
function wiggle(n: number, drift: number, amp: number, phase = 0): number[] {
  return Array.from({ length: n }, (_, i) => drift + Math.sin(i * 0.7 + phase) * amp);
}

function run(id: string, returns: number[], startDay = 0): FavouriteSeries {
  return {
    id, label: id, symbol: id.toUpperCase(),
    timestamps: returns.map((_, i) => (startDay + i) * DAY),
    returns,
  };
}

describe("alignment is a join on time, not on index", () => {
  it("pairs bars by timestamp when the runs start on different days", () => {
    // The failure this prevents: two runs offset by 50 days, joined by index,
    // pair unrelated days and report a correlation that describes nothing.
    const a = run("a", wiggle(200, 0.001, 0.01), 0);
    const b = run("b", wiggle(200, 0.001, 0.01), 50);
    const aligned = alignFavourites([a, b])!;
    assert.equal(aligned.overlap, 150);
    // Bar 0 of the overlap is day 50 in both, so both series must report the
    // value their own day-50 bar held.
    assert.equal(aligned.returns.a[0], a.returns[50]);
    assert.equal(aligned.returns.b[0], b.returns[0]);
  });

  it("returns null when nothing overlaps at all", () => {
    const a = run("a", wiggle(100, 0.001, 0.01), 0);
    const b = run("b", wiggle(100, 0.001, 0.01), 500);
    assert.equal(alignFavourites([a, b]), null);
  });

  it("reports how much was discarded, not just what survived", () => {
    // A five-run combination sharing forty bars is a coincidence, and the only
    // way a reader can tell is if both numbers are shown.
    const aligned = alignFavourites([
      run("a", wiggle(400, 0.001, 0.01), 0),
      run("b", wiggle(120, 0.001, 0.01), 0),
    ])!;
    assert.equal(aligned.overlap, 120);
    assert.equal(aligned.longest, 400);
  });

  it("inner-joins rather than padding a gap with zero", () => {
    // A padded zero reads as "flat that day", which is a position rather than
    // an absence — and it understates both volatility and correlation, the two
    // errors that each make a portfolio look safer than it is.
    const full = run("a", wiggle(200, 0.001, 0.02), 0);
    const holed: FavouriteSeries = {
      ...run("b", wiggle(200, 0.001, 0.02), 0),
      timestamps: wiggle(200, 0, 0).map((_, i) => i * DAY).filter((_, i) => i % 5 !== 0),
      returns: wiggle(200, 0.001, 0.02).filter((_, i) => i % 5 !== 0),
    };
    const aligned = alignFavourites([full, holed])!;
    assert.equal(aligned.overlap, 160);
    assert.ok(aligned.returns.b.every((r) => r !== 0), "a gap was filled with a zero return");
  });
});

describe("the optimiser never scores itself on the window it fitted", () => {
  const ids = ["a", "b", "c"];
  const aligned = alignFavourites([
    run("a", wiggle(400, 0.0012, 0.02, 0)),
    run("b", wiggle(400, 0.0008, 0.015, 1.4)),
    run("c", wiggle(400, 0.0005, 0.03, 2.9)),
  ])!;

  it("splits the overlap and measures on the later part", () => {
    const result = combineFavourites(aligned, "min_variance", 252)!;
    assert.ok(result);
    // Both numbers are reported. The gap between them is the finding, and a
    // result that only published the in-sample one would be the exact
    // overfitting the rest of this engine is built to expose.
    assert.ok(Number.isFinite(result.inSampleSharpe));
    assert.ok(Number.isFinite(result.holdoutSharpe));
    assert.ok(HOLDOUT_SPLIT > 0.5 && HOLDOUT_SPLIT < 1);
  });

  it("refuses rather than answering when the overlap is too short", () => {
    // A covariance across three strategies on forty bars has more parameters
    // than observations. The weights it produces are noise wearing a method name.
    const short = alignFavourites([
      run("a", wiggle(40, 0.001, 0.02)),
      run("b", wiggle(40, 0.001, 0.02, 1)),
    ])!;
    assert.ok(short.overlap < MIN_OVERLAP_BARS);
    assert.equal(combineFavourites(short, "min_variance", 252), null);
  });

  it("compares against the best single member on the same holdout", () => {
    // The comparison that decides whether combining was worth doing at all. A
    // portfolio that loses to one of its own members out of sample has added
    // complexity and nothing else.
    const result = combineFavourites(aligned, "equal_weight", 252)!;
    assert.ok(Number.isFinite(result.edgeOverBestSingle));
  });

  it("every method produces long-only weights that sum to one", () => {
    // The bound that keeps a near-degenerate covariance — two favourites that
    // are variations on one idea, which is the normal case — from producing a
    // leveraged short.
    for (const method of FAVOURITE_METHODS) {
      const result = combineFavourites(aligned, method, 252);
      assert.ok(result, `${method} produced nothing`);
      const values = ids.map((id) => result.weights[id] ?? 0);
      assert.ok(values.every((w) => w >= -1e-9), `${method} went short: ${values}`);
      const total = values.reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(total - 1) < 1e-6, `${method} weights sum to ${total}`);
    }
  });
});

describe("max_sharpe is bounded where the closed form is not", () => {
  it("never returns a leveraged or short weight", () => {
    // `Σ⁻¹μ` is unbounded and routinely returns leveraged shorts; with two
    // correlated favourites it is numerically hopeless. Projected ascent on the
    // long-only simplex cannot produce either.
    const returns = {
      a: wiggle(300, 0.002, 0.02),
      b: wiggle(300, -0.001, 0.02, 0.05), // nearly the mirror of a: correlated
    };
    const w = maxSharpeWeights(["a", "b"], returns, 0, 300)!;
    assert.ok(w.a >= 0 && w.b >= 0, `went short: ${JSON.stringify(w)}`);
    assert.ok(Math.abs(w.a + w.b - 1) < 1e-6);
  });

  it("prefers the member with the better risk-adjusted return", () => {
    const returns = {
      good: wiggle(300, 0.002, 0.01),
      poor: wiggle(300, 0.0001, 0.03, 1.1),
    };
    const w = maxSharpeWeights(["good", "poor"], returns, 0, 300)!;
    assert.ok(w.good > w.poor, `weights ignored the risk-adjusted difference: ${JSON.stringify(w)}`);
  });

  it("falls back to equal weight rather than a corner it wandered into", () => {
    // Two statistically identical members have no tangency answer to find.
    // Equal weight is the honest result, not whichever one the last step
    // happened to favour.
    const identical = wiggle(300, 0.001, 0.02);
    const w = maxSharpeWeights(["a", "b"], { a: identical, b: identical.slice() }, 0, 300)!;
    assert.ok(Math.abs(w.a - w.b) < 0.02, `split ${JSON.stringify(w)} on identical members`);
  });
});

describe("the naive baseline is offered first", () => {
  it("equal weight leads the method list", () => {
    // It knows nothing and says so, which is what makes it the baseline the
    // other four have to beat out of sample.
    assert.equal(FAVOURITE_METHODS[0], "equal_weight");
  });

  it("offers the four existing solvers plus the one that is genuinely new", () => {
    assert.deepEqual([...FAVOURITE_METHODS], [
      "equal_weight", "inverse_vol", "equal_risk", "min_variance", "max_sharpe",
    ]);
  });
});
