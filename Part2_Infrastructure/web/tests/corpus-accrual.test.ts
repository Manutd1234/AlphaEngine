/**
 * When the corpus becomes usable, drawn — the question the Corpus view could
 * not answer.
 *
 * Ian: "Corpus is not working well when we are pulling the data, fix the
 * diagrams, make it genius and intuitive." The gateway half was a horizon
 * constant that selected almost nothing; the desk half is that the view could
 * say what the corpus IS and never what it is BECOMING. A reader on a cold
 * recorder saw a count, a `thin` flag and an engine word, and had no way to
 * ask the only question that matters on a cold recorder: is this filling, and
 * when does it cross the line?
 *
 * TWO LINES, BOTH THE GATEWAY'S. Twenty tape forecasts is where the scorer
 * stops falling back to last trades — the line between a forecast test and a
 * convergence test — and fifty settled markets is where the reliability term
 * stops being mostly noise. Both were drawn on this desk as flags and neither
 * was ever drawn as a NUMBER a reader could see a count approaching.
 *
 * A PROJECTION IS A CLAIM, so it is made only where it is honest: the last
 * runs must be non-decreasing and actually growing. Where they are not, the
 * figure says the corpus is not accruing and gives the count that shows it,
 * rather than fitting a line through noise and printing a date.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { read, stripNonCode } from "./helpers/workspace-sources";

const accrual = read("../components/coherence/CorpusAccrual.tsx");
const trend = read("../components/coherence/CalibrationTrend.tsx");

describe("the two floors are the gateway's own numbers", () => {
  it("imports them rather than restating them", () => {
    assert.match(accrual, /import \{ MIN_TAPE_FORECASTS, THIN_CORPUS \} from "@\/lib\/coherence\/thresholds"/,
      "the floors are typed into the figure instead of read from the mirror");
    assert.doesNotMatch(stripNonCode(accrual), /\b50\b|\b20\b/,
      "a floor is written as a literal, so the gateway can move it and the figure will not");
  });

  it("draws each as a labelled rule, not as a flag", () => {
    assert.match(accrual, /tape preferred/i, "the tape floor carries no words");
    assert.match(accrual, /not thin/i, "the thin floor carries no words");
  });
});

describe("the projection is made only where it is honest", () => {
  it("requires the recent runs to be non-decreasing before extending anything", () => {
    assert.match(stripNonCode(accrual), /nonDecreasing/,
      "the figure fits a line without checking the counts only go up");
  });

  it("says the corpus is not accruing rather than printing a date it cannot support", () => {
    assert.match(accrual, /not accruing/i,
      "a flat corpus gets a projection anyway, which is a coerced estimate in the shape of a date");
  });

  it("never coerces a missing count to zero", () => {
    assert.doesNotMatch(stripNonCode(accrual), /\?\? 0\b|\|\| 0\b/);
  });

  it("draws a measured zero as a mark on the floor, not as a gap", () => {
    assert.match(accrual, /measured zero|a run that scored nothing/i,
      "a run that scored no markets is indistinguishable from a run that did not happen");
  });
});

describe("it draws on every branch, including the cold one", () => {
  it("the empty state is a drawing with both rules on it", () => {
    const branch = accrual.slice(accrual.indexOf("if (!points.length)"));
    assert.ok(branch.length > 200, "the empty branch is no longer where this reads it");
    assert.match(branch.slice(0, 1400), /<Plot/, "a cold recorder still gets a sentence instead of the two lines");
  });

  it("the trend mounts it on the branch where nothing has scored", () => {
    // That branch IS the view on any deployment with nothing settled, which is
    // exactly where the accrual question is the only one worth asking.
    const cold = trend.slice(trend.indexOf("if (!scored.length)"), trend.indexOf("const first = points[0].ts"));
    assert.ok(cold.length > 200, "the unscored branch is no longer where this reads it");
    assert.match(cold, /<CorpusAccrual/, "the cold branch does not draw the accrual");
  });

  it("and on the branch where something has", () => {
    const warm = trend.slice(trend.indexOf("const first = points[0].ts"));
    assert.match(warm, /<CorpusAccrual/, "the scored branch does not draw the accrual");
  });
});
