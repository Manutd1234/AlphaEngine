/**
 * Where each fold's winner placed out of sample: the numbers, before the drawing.
 *
 * Grammar rule 4. The reference is the median rank of the fold's own grid,
 * and "beat chance" means strictly better than it — a fold that lands exactly
 * on the median did no better than picking at random and must not be counted
 * as a choice that held up.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { foldLadder, ladderReading } from "../lib/research/fold-ladder";
import type { WalkForwardFold } from "../lib/types/sweep";

const fold = (n: number, oosRank?: number, combosRanked?: number): WalkForwardFold => ({
  fold: n, trainStart: "", trainEnd: "", testStart: "", testEnd: "",
  chosenFast: 10, chosenSlow: 20, isSharpe: 1.2, oosSharpe: 0.4, oosReturn: 0.01,
  oosRank, combosRanked,
});

describe("placing is rank over grid size, and chance is the median", () => {
  it("rank 1 of 40 held up; rank 33 of 40 selected noise", () => {
    const l = foldLadder([fold(1, 1, 40), fold(2, 33, 40)]);
    assert.equal(l.rungs[0].placing, 1 / 40);
    assert.equal(l.rungs[0].beatChance, true);
    assert.equal(l.rungs[1].beatChance, false);
    assert.equal(l.beatChance, 1);
  });

  it("exactly the median is chance, not a win", () => {
    // 40 combos: median rank is 20.5. Rank 20 beats it; rank 21 does not.
    const l = foldLadder([fold(1, 20, 40), fold(2, 21, 40)]);
    assert.equal(l.rungs[0].beatChance, true);
    assert.equal(l.rungs[1].beatChance, false);
  });
});

describe("a fold without a rank is withheld, never ranked first", () => {
  it("counts toward neither side and says why", () => {
    const l = foldLadder([fold(1, undefined, undefined), fold(2, 3, 40)]);
    assert.equal(l.rungs[0].rank, null);
    assert.equal(l.rungs[0].beatChance, null);
    assert.match(l.rungs[0].withheld!, /no out-of-sample rank/);
    assert.equal(l.withheld, 1);
    assert.equal(l.scored, 1);
  });

  it("a zero-sized grid is withheld too, not divided by", () => {
    const l = foldLadder([fold(1, 1, 0)]);
    assert.equal(l.rungs[0].placing, null);
    assert.equal(l.scored, 0);
  });
});

describe("the reading counts, and reports an unscored ladder as unscored", () => {
  it("every choice held up", () => {
    assert.match(ladderReading(foldLadder([fold(1, 1, 40), fold(2, 2, 40)])), /2 of 2 folds.*every choice held up/);
  });
  it("no choice held up", () => {
    assert.match(ladderReading(foldLadder([fold(1, 30, 40), fold(2, 35, 40)])), /0 of 2 folds.*selected noise/);
  });
  it("nothing scored is said, never 'every choice held up' over nothing", () => {
    assert.match(ladderReading(foldLadder([fold(1)])), /nothing here is scored/);
  });
});

/* ── The figure's structure ────────────────────────────────────────────── */

import { read } from "./helpers/workspace-sources";

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");


// Comments stripped, NOT `stripNonCode`: that helper blanks string literals,
// and half of what this guards IS a string literal — the ▲ in a title, the
// hatch url. The first run reported every one of them missing.
const figure = stripComments(read("../components/research/FoldLadder.tsx"));

describe("the ladder is an instrument, and its empty branch draws", () => {
  it("is non-empty", () => assert.ok(figure.length > 1200));

  it("uses a shared axis — folds are uniform — with the median as the reference", () => {
    assert.match(figure, /sharedX=\{/);
    assert.match(figure, /reference=\{/);
    assert.match(figure, /y: y\(0\.5\)/, "the reference is not the median");
  });

  it("draws a withheld fold as a hatched rung with its reason, never as rank one", () => {
    // The branch a reader will meet today: nothing on the desk or the gateway
    // populates `oosRank`, so every rung is withheld and the figure must still
    // draw the shape the answer will take.
    assert.match(figure, /url\(#diff-hatch\)/);
    assert.match(figure, /withheld — \$\{r\.withheld\}/);
    const render = figure.slice(figure.indexOf("{rungs.map("));
    assert.match(render, /r\.placing === null/, "the render no longer branches on a withheld placing");
    assert.doesNotMatch(render, /placing \?\? 0/, "a withheld placing is coerced to rank one");
  });

  it("derives from the pure module and says 'beat chance' in words", () => {
    assert.match(figure, /foldLadder\(folds\)/);
    assert.match(figure, /ladderReading\(ladder\)/);
    assert.match(figure, /▲ beat chance/);
  });
});
