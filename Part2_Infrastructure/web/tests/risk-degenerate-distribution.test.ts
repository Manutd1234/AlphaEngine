/**
 * A simulation over degenerate drivers is reported, never drawn.
 *
 * THE DEFECT THIS PINS
 * ------------------------------------------------------------------------
 * The Monte Carlo card was screenshotted fully populated and entirely zero:
 * 50,000 paths, a stationary bootstrap, a block length, a seed, and then "MEAN
 * OUTCOME $0", "P50 LOSS $-0", "P95 LOSS $-0", "P99 LOSS $-0", "WORST CASE
 * $0", "0.0% of paths end in loss", a histogram that was one solid block from
 * "$0" to "$0", and a verdict reading "Within headroom." Every figure was
 * arithmetically correct. The card was still lying, because a trader reads
 * that as fifty thousand simulated futures none of which lost money.
 *
 * The cause is traced in `components/risk/mc-degeneracy.ts` and reproduced
 * below rather than described: a parameter combination that never takes a
 * position produces per-bar returns that are exactly zero, `lib/engine.ts`
 * ships them as `bestRunReturns`, and `lib/use-sweep-run.ts` builds a driver
 * from them after testing their LENGTH.
 *
 * WHAT IS ASSERTED, AND IN WHICH REGISTER
 * ------------------------------------------------------------------------
 * The detectors are EXECUTED, not read: a degenerate driver is built here, the
 * real simulation is run over it, and the guard is asked about the real
 * result. A source scan cannot tell a guard that fires from one that is
 * spelled correctly. The source scans that do exist are only for the wiring a
 * unit test cannot see — that the card consults the guard before building a
 * request, and that no tile survives a refusal.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  mcDriverDegeneracy,
  mcResultDegeneracy,
  mcRoundsToZero,
  mcUsd,
} from "../components/risk/mc-degeneracy";
import { createMcSimulation } from "../lib/mc-distribution";
import { readSource, stripCode } from "./helpers/source-files";

/** Runs the real simulation to completion and hands back the result. */
function simulate(returns: number[], equity = 1_000_000) {
  const sim = createMcSimulation({
    returns,
    horizonBars: 180,
    paths: 500,
    seed: 20260822,
    equity,
  });
  while (sim.done < sim.total) sim.step(500);
  return sim.finish();
}

// --------------------------------------------------------------------------
// 1. The zeros are real, and they are what the card used to print
// --------------------------------------------------------------------------

describe("the reported screen, reproduced", () => {
  /** What `lib/engine/combo.ts` emits for a winner that never took a position. */
  const neverTraded = new Array(720).fill(0);

  it("a never-traded winner simulates to a distribution of one repeated zero", () => {
    const result = simulate(neverTraded);
    assert.equal(result.pnl.mean, 0);
    assert.equal(result.pnl.best, 0);
    assert.equal(result.pnl.worst, 0);
    assert.equal(result.probLoss, 0, "0.0% of paths end in loss, exactly as screenshotted");
    // The histogram collapses to a single bin spanning nothing — the "one
    // solid block across the full width" in the report.
    assert.deepEqual(result.histogram, { edges: [0, 0], counts: [500] });
  });

  it("the loss quantiles are negative zero, which is where \"$-0\" came from", () => {
    const result = simulate(neverTraded);
    for (const loss of [result.loss.p50, result.loss.p95, result.loss.p99]) {
      assert.ok(Object.is(loss, -0), "a negated zero percentile is negative zero");
    }
    // The old formatter, demonstrated rather than asserted about.
    assert.equal((-0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }), "-0");
  });
});

// --------------------------------------------------------------------------
// 2. The guard, executed
// --------------------------------------------------------------------------

describe("a degenerate driver is refused before anything is simulated", () => {
  it("all-zero returns are named as a winner that never took a position", () => {
    const defect = mcDriverDegeneracy(new Array(720).fill(0));
    assert.ok(defect, "the case the screenshot showed must be caught");
    assert.equal(defect.kind, "driver-never-traded");
    assert.match(defect.detail, /exactly zero/);
    assert.match(defect.detail, /Nothing was simulated/,
      "the reader must be told no simulation stands behind the absence");
    assert.equal(defect.kind === "driver-never-traded" && defect.observations, 720,
      "the reason carries the count it measured, so the sentence is not a guess");
  });

  it("constant non-zero returns are refused too — the test is dispersion, not zero", () => {
    const defect = mcDriverDegeneracy(new Array(300).fill(0.001));
    assert.ok(defect, "every path identical is the same defect whatever the constant is");
    assert.equal(defect.kind, "driver-constant");
  });

  it("returns with no finite value at all are refused, and say how many arrived", () => {
    const defect = mcDriverDegeneracy([Number.NaN, Number.POSITIVE_INFINITY]);
    assert.ok(defect);
    assert.equal(defect.kind, "driver-empty");
    assert.equal(defect.kind === "driver-empty" && defect.observations, 2);
  });

  it("a real driver passes — the guard is not a blanket refusal", () => {
    const real = Array.from({ length: 400 }, (_, i) => Math.sin(i) * 0.004);
    assert.equal(mcDriverDegeneracy(real), null);
    const result = simulate(real);
    assert.equal(mcResultDegeneracy(result), null, "a spread of outcomes has quantiles to read");
    assert.notEqual(result.pnl.best, result.pnl.worst);
  });
});

describe("a completed run whose outcomes never moved is refused as well", () => {
  it("the result guard catches what the driver guard is bypassed for", () => {
    // Deliberately routed AROUND the driver check, which is the whole point of
    // the second guard existing: it must hold even when the inputs looked fine
    // or the input check was never consulted.
    const result = simulate(new Array(200).fill(0));
    const defect = mcResultDegeneracy(result);
    assert.ok(defect, "every path at one value has no quantiles");
    assert.equal(defect.kind, "outcomes-unmoved");
    assert.equal(defect.kind === "outcomes-unmoved" && defect.paths, 500);
    assert.match(defect.detail, /no spread and no tail/);
  });

  it("identical-but-non-zero outcomes are named differently from unmoved ones", () => {
    const defect = mcResultDegeneracy({
      ...simulate(new Array(200).fill(0)),
      pnl: { mean: -250, p50: -250, best: -250, worst: -250 },
    });
    assert.ok(defect);
    assert.equal(defect.kind, "outcomes-identical");
    assert.match(defect.detail, /\$-250/, "the one value every path landed on is stated");
  });
});

// --------------------------------------------------------------------------
// 3. "$0" is a value; "-$0" is a typo for one
// --------------------------------------------------------------------------

describe("money that has rounded away loses its sign, never its dash", () => {
  it("negative zero and anything rounding to it print $0", () => {
    for (const value of [-0, -0.4, 0.49, 0]) {
      assert.equal(mcUsd(value), "$0", `${value} must not print a sign it does not have`);
    }
  });

  it("a real figure keeps its sign and its magnitude", () => {
    assert.equal(mcUsd(-1_250), "$-1,250");
    assert.equal(mcUsd(48_120), "$48,120");
    assert.equal(mcUsd(-0.6), "$-1", "half a dollar rounds, it does not vanish");
  });

  it("a missing measurement is still a dash, not a zero", () => {
    // The whole point of normalising a sign away is undone if the same helper
    // also swallows null. These are different facts and stay different.
    assert.equal(mcUsd(null), "—");
    assert.equal(mcUsd(undefined), "—");
    assert.equal(mcUsd(Number.NaN), "—");
  });

  it("the tone predicate agrees with what the digits say", () => {
    assert.equal(mcRoundsToZero(-0), true);
    assert.equal(mcRoundsToZero(-0.2), true, "a tile reading $0 must not be coloured as a loss");
    assert.equal(mcRoundsToZero(-900), false);
    assert.equal(mcRoundsToZero(Number.NaN), false, "an absence is not a zero");
  });
});

// --------------------------------------------------------------------------
// 4. The wiring a unit test cannot see
// --------------------------------------------------------------------------

describe("the card consults the guard rather than carrying its own copy", () => {
  const card = readSource("components/risk/MonteCarloDistribution.tsx");
  const code = stripCode(card);

  it("no request is built for a driver the guard has rejected", () => {
    assert.match(code, /driverDefect\) return null;/,
      "a degenerate driver must not reach the worker at all");
    assert.match(code, /mcDriverDegeneracy\(driver\.returns\)/);
  });

  it("the tiles, histogram and verdict stay atomic while a valid prior result refreshes in place", () => {
    // One condition guards all three. It deliberately does NOT require `done`:
    // a same-driver parameter refresh retains the last valid result so the
    // analytical surface does not collapse or twitch while its replacement is
    // running. A degenerate result still replaces all three with one refusal,
    // but only after the replacement run has settled.
    assert.match(code, /\{result && !resultDefect && \(/);
    assert.doesNotMatch(code, /state\.status === "done" && result && !resultDefect/,
      "a refresh must not hide the retained valid distribution until the replacement completes");
    assert.match(code, /\{result && resultDefect && state\.status !== "running" && \(/,
      "the refusal is rendered after completion, not merely the figures withheld");

    const hook = stripCode(readSource("lib/use-mc-distribution.ts"));
    assert.match(
      hook,
      /const retainedResult = sameDriver \? previous\.result : null;[\s\S]*?status:\s*"running"[\s\S]*?result:\s*retainedResult/,
      "same-driver refreshes must retain the prior result; a new driver must clear it",
    );
  });

  it("every figure read off the result goes through mcUsd", () => {
    // `usd(` survives for the cushion and the equity bucket, which are book
    // values rather than simulation output; nothing off `result` may use it.
    const offenders = [...code.matchAll(/usd\(result\.[^)]*\)/g)].map((m) => m[0]);
    assert.deepEqual(offenders, [],
      `these print a simulated figure through the unnormalised formatter:\n  ${offenders.join("\n  ")}`);
  });

  it("the histogram's axis ends cannot print a sign they do not have", () => {
    // The guard stops a degenerate result reaching the chart at all, so this
    // is the belt to that brace: a live distribution whose low end sits a hair
    // under break-even labelled its own axis "$-0" through the bare formatter.
    const hist = stripCode(readSource("components/risk/McHistogram.tsx"));
    assert.match(hist, /\{mcUsd\(lo\)\}/);
    assert.match(hist, /\{mcUsd\(hi\)\}/);
    assert.doesNotMatch(hist, /usd\((lo|hi), 0\)/);
  });

  it("the refusal names a reason and states what was asked for", () => {
    const notice = stripCode(readSource("components/risk/McDegenerateNotice.tsx"));
    assert.match(notice, /headline/);
    assert.match(notice, /\{asked\}/, "the request stays on screen so only the answer is missing");
    assert.match(notice, /role="status"/);
    assert.doesNotMatch(notice, /return null/,
      "an absent card and a card reporting an absence mean different things");
  });
});
