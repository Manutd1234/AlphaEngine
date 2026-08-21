/**
 * Walk-forward efficiency refuses to flatter a losing fold.
 *
 * Efficiency is out-of-sample Sharpe over in-sample Sharpe, and the ratio has a
 * trap at the bottom: −0.5 / −1.0 is +0.5, which reads as "kept half its edge"
 * for a fold that lost money in both windows. Two negatives must produce no
 * efficiency at all — excluded from the median, not folded into it — or the
 * headline number improves as the strategy gets worse.
 *
 * The rest is the same honesty under absence. Parameter drift is counted in
 * grid steps between consecutive folds, and the first fold has nothing to drift
 * from, so it reports null rather than zero. No folds at all is a failure, not
 * a pass by absence of evidence. Decay is marginal and collapse is a failure,
 * because a verdict that only ever says "pass" or "fail" hides the case a
 * researcher most needs to see.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { walkForwardReport } from "../lib/quant";

import { close, fold } from "./helpers/quant-fixtures";

describe("walk-forward efficiency refuses to flatter a losing fold", () => {
  const fasts = [5, 10, 15];
  const slows = [30, 40, 50];

  it("efficiency is 1 when out-of-sample matches in-sample", () => {
    const r = walkForwardReport([fold(1, 1.5, 1.5), fold(2, 2, 2)], fasts, slows);
    close(r.medianEfficiency!, 1, 1e-12, "median efficiency");
    assert.equal(r.verdict.level, "pass");
  });

  it("a fold that lost in BOTH windows reports no efficiency at all", () => {
    // -0.5 / -1.0 = +0.5, which would read as "kept half its edge" for a fold
    // that lost money twice. It must be excluded, not included.
    const r = walkForwardReport([fold(1, -1, -0.5)], fasts, slows);
    assert.equal(r.folds[0].efficiency, null);
    assert.equal(r.medianEfficiency, null);
    assert.equal(r.positiveFolds, 0);
  });

  it("counts parameter drift in grid steps between consecutive folds", () => {
    const r = walkForwardReport(
      [fold(1, 1, 1, 5, 30), fold(2, 1, 1, 5, 30), fold(3, 1, 1, 15, 50)],
      fasts,
      slows,
    );
    assert.equal(r.folds[0].paramDrift, null, "the first fold has nothing to drift from");
    assert.equal(r.folds[1].paramDrift, 0);
    assert.equal(r.folds[2].paramDrift, 4, "two steps on each axis");
    close(r.parameterPersistence!, 0.5, 1e-12, "one of two transitions held");
  });

  it("decay is marginal; collapse is a failure", () => {
    const decay = walkForwardReport([fold(1, 2, 0.6), fold(2, 2, 0.5)], fasts, slows);
    assert.equal(decay.verdict.level, "marginal");
    const collapse = walkForwardReport([fold(1, 2, -0.4), fold(2, 2, -0.9)], fasts, slows);
    assert.equal(collapse.verdict.level, "fail");
  });

  it("no folds is a failure, not a pass by absence of evidence", () => {
    const r = walkForwardReport([], fasts, slows);
    assert.equal(r.verdict.level, "fail");
    assert.equal(r.medianEfficiency, null);
  });
});
