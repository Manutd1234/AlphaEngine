/**
 * The overfitting estimate the whole walk-forward apparatus exists to produce,
 * and the fold geometry that has to hold for it to mean anything.
 *
 * PBO is the number a reader uses to decide whether an in-sample winner was a
 * discovery or a coincidence, so the two ways it can lie are pinned here: it
 * must fall out of the ranks the folds actually recorded, and it must be null —
 * never zero — when nothing was ranked at all. "0% overfit" is the most
 * reassuring possible reading of no information.
 *
 * The embargo is the other half. A lookback that spans a fold boundary lets the
 * training window see bars the test window is about to be scored on, and an
 * unpurged fold's out-of-sample Sharpe is indistinguishable from a leak. The
 * gap must shorten training without moving the test window, dropping a fold, or
 * quietly changing the default the Python parity fixture was built against.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { walkForward } from "../lib/engine";
import { overfittingProbability } from "../lib/quant";
import { DEFAULT_REQUEST, type SweepRequest, type WalkForwardFold } from "../lib/types";
import { bars } from "./helpers/deterministic-bars";

// --------------------------------------------------------------------------
// Overfitting probability
// --------------------------------------------------------------------------

function fold(rank: number, total = 10): WalkForwardFold {
  return {
    fold: rank,
    trainStart: "2026-01-01", trainEnd: "2026-01-20",
    testStart: "2026-01-21", testEnd: "2026-02-01",
    chosenFast: 10, chosenSlow: 50,
    isSharpe: 1.5, oosSharpe: 0.2, oosReturn: 0.02,
    oosRank: rank, combosRanked: total,
  };
}

describe("PBO counts how often the in-sample pick lost its rank", () => {
  it("winners that keep placing in the bottom half read as overfit", () => {
    assert.equal(overfittingProbability([fold(8), fold(9), fold(10)]), 1);
  });

  it("winners that hold up read as robust", () => {
    assert.equal(overfittingProbability([fold(1), fold(2), fold(3)]), 0);
  });

  it("is null when nothing was ranked, not zero", () => {
    // Absent evidence must never render as "0% overfit" — that is the most
    // reassuring possible reading of no information at all.
    const unranked = { ...fold(1), oosRank: undefined, combosRanked: undefined };
    assert.equal(overfittingProbability([unranked]), null);
    assert.equal(overfittingProbability([]), null);
  });

  it("a single-combination grid cannot rank anything", () => {
    assert.equal(overfittingProbability([fold(1, 1)]), null);
  });
});

// --------------------------------------------------------------------------
// Embargoed folds
// --------------------------------------------------------------------------

describe("the embargo keeps a lookback from spanning the fold boundary", () => {
  const combos: Array<[number, number]> = [[5, 20], [10, 50]];
  const request = (embargoBars?: number): SweepRequest => ({
    ...DEFAULT_REQUEST, bars: 1600, folds: 3, walkForward: true, embargoBars,
  });

  it("shortens training without moving the test window or dropping a fold", () => {
    const plain = walkForward(bars(1600), combos, request());
    const gapped = walkForward(bars(1600), combos, request(120));

    assert.equal(gapped.folds.length, plain.folds.length);
    for (let i = 0; i < plain.folds.length; i++) {
      assert.equal(gapped.folds[i].testStart, plain.folds[i].testStart);
      assert.ok(gapped.folds[i].trainEnd < plain.folds[i].trainEnd);
      assert.equal(gapped.folds[i].embargoBars, 120);
    }
  });

  it("defaults to zero so the Python parity fixture still holds", () => {
    const { folds } = walkForward(bars(1600), combos, request());
    assert.ok(folds.length > 0);
    assert.ok(folds.every((f) => f.embargoBars === 0));
  });

  it("ranks the winner against the whole grid on every fold", () => {
    const { folds } = walkForward(bars(1600), combos, request());
    for (const f of folds) {
      assert.equal(f.combosRanked, combos.length);
      assert.ok(f.oosRank! >= 1 && f.oosRank! <= combos.length);
    }
  });
});
