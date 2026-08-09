/**
 * The composite score.
 *
 * A single number invites trust it has not earned, so most of these assert the
 * ways it must REFUSE to flatter a run: an unmeasured category cannot be
 * silently skipped, weights must sum to the scale they claim, and the naive
 * statistics must not be able to outvote the corrected ones.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { QUALITY_WEIGHTS, QualityInput, qualityScore } from "@/lib/quality-score";

const solid: QualityInput = {
  deflatedSharpeRatio: 0.96, sharpe: 1.8, maxDrawdown: -0.12, calmar: 2.4,
  totalReturn: 0.8, winRate: 0.56, trades: 64,
  medianEfficiency: 0.9, overfittingProbability: 0.1, walkForwardOosSharpe: 1.4,
  benchmarkSharpe: 0.4, benchmarkTotalReturn: 0.2,
};

describe("the scale is what it claims to be", () => {
  it("the weights sum to 100", () => {
    const sum = Object.values(QUALITY_WEIGHTS).reduce((a, b) => a + b, 0);
    assert.equal(sum, 100, "a score out of 100 whose parts do not sum to 100 is not out of 100");
  });

  it("every category the weights name is actually produced", () => {
    const ids = qualityScore(solid).categories.map((c) => c.id).sort();
    assert.deepEqual(ids, Object.keys(QUALITY_WEIGHTS).sort());
  });

  it("stays within 0-100 for absurd inputs in both directions", () => {
    const wild = qualityScore({
      ...solid, sharpe: 400, totalReturn: 90, calmar: 1e6, trades: 1e6, deflatedSharpeRatio: 1,
    });
    assert.ok(wild.total <= 100 && wild.total >= 0, `out of range: ${wild.total}`);

    const dire = qualityScore({
      ...solid, deflatedSharpeRatio: -5, sharpe: -9, maxDrawdown: -0.99, calmar: -20,
      totalReturn: -0.95, winRate: 0, trades: 0,
      medianEfficiency: -3, overfittingProbability: 1, walkForwardOosSharpe: -2,
      benchmarkSharpe: 9, benchmarkTotalReturn: 9,
    });
    assert.ok(dire.total >= 0 && dire.total <= 100, `out of range: ${dire.total}`);
  });
});

describe("an unmeasured category is not a passed one", () => {
  it("scores robustness zero when walk-forward did not run, and says so", () => {
    // The alternative — omitting the category and rescaling — would let a run
    // that was never validated out-of-sample outscore one that was and did
    // badly. Absence of evidence would become evidence.
    const withWf = qualityScore(solid);
    const withoutWf = qualityScore({
      ...solid, medianEfficiency: null, overfittingProbability: null, walkForwardOosSharpe: null,
    });

    assert.ok(withoutWf.total < withWf.total, "skipping walk-forward did not cost anything");
    assert.equal(withoutWf.incomplete, true);
    assert.match(withoutWf.verdict, /unmeasured|floor/i,
      "the verdict does not warn that the total is a floor");
  });
});

describe("the corrected statistics outrank the naive ones", () => {
  it("a high raw Sharpe with a poor DSR cannot reach a strong score", () => {
    // The specific failure this repository already computes DSR to avoid: a
    // grid search over hundreds of combinations makes the best raw Sharpe a
    // biased estimate, and a score that rewarded it would contradict the
    // machinery sitting next to it.
    const overfit = qualityScore({
      ...solid, sharpe: 3.2, deflatedSharpeRatio: 0.2,
      medianEfficiency: 0.1, overfittingProbability: 0.8, walkForwardOosSharpe: -0.2,
    });
    assert.ok(overfit.total < 55,
      `a Sharpe of 3.2 with DSR 0.2 and PBO 80% scored ${overfit.total} — the naive statistic won`);
  });

  it("robustness alone moves the total materially", () => {
    const robust = qualityScore(solid);
    const fragile = qualityScore({
      ...solid, medianEfficiency: 0.05, overfittingProbability: 0.9, walkForwardOosSharpe: -0.5,
    });
    assert.ok(robust.total - fragile.total >= 12,
      "out-of-sample collapse barely changed the score");
  });
});

describe("it describes history and does not predict", () => {
  it("no verdict promises anything about the future", () => {
    for (const input of [solid, { ...solid, sharpe: 0.1, deflatedSharpeRatio: 0.1 }]) {
      const { verdict } = qualityScore(input);
      assert.doesNotMatch(verdict, /will|expect|profit|guarantee/i,
        `a verdict predicted rather than described: "${verdict}"`);
    }
  });

  it("every category reports its detail in the reader's units", () => {
    // A breakdown of six bare numbers is unreadable; the point of the detail
    // line is that a reader can check the score against something they know.
    for (const c of qualityScore(solid).categories) {
      assert.ok(c.detail.length > 0, `${c.id} has no detail`);
      assert.match(c.detail, /[0-9]/, `${c.id} detail cites no measured value`);
    }
  });
});
