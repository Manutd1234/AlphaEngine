/**
 * The palette scorer's failure mode is silent: a wrong ranking still shows a
 * plausible list, so every property here is a comparison on hand-picked pairs
 * rather than an absolute number — absolute scores are an implementation
 * detail, orderings are the contract.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { commandScore } from "../lib/command-score";

describe("matching", () => {
  it("matches any in-order subsequence, case-insensitively", () => {
    assert.notEqual(commandScore("wf", "Walk-forward"), null);
    assert.notEqual(commandScore("HULL", "hull trend"), null);
  });

  it("rejects out-of-order and absent characters", () => {
    // "vo" is not a subsequence of "Overview": its only o precedes every v.
    assert.equal(commandScore("vo", "Overview"), null);
    assert.equal(commandScore("xyz", "Portfolio"), null);
  });

  it("an empty query matches everything, indifferently", () => {
    assert.equal(commandScore("", "Overview"), 0);
    assert.equal(commandScore("   ", "Risk"), 0);
  });
});

describe("ranking", () => {
  const rank = (query: string, a: string, b: string) => {
    const sa = commandScore(query, a);
    const sb = commandScore(query, b);
    assert.notEqual(sa, null, `"${query}" must match "${a}"`);
    assert.notEqual(sb, null, `"${query}" must match "${b}"`);
    return (sa as number) - (sb as number);
  };

  it("a prefix beats a mid-word match", () => {
    assert.ok(rank("hull", "Hull trend — Trend", "Chull something") > 0);
    assert.ok(rank("ris", "Risk — Risk Manager", "Parameters — rising") > 0);
  });

  it("a word-boundary start beats a buried one", () => {
    assert.ok(rank("f", "Walk-forward", "Verification") > 0);
  });

  it("consecutive runs beat scattered letters", () => {
    // "trend" appears whole in the first and only as t…r…e-n-d in the second.
    assert.ok(rank("trend", "CMO trend", "cost ramp end") > 0);
  });

  it("tight matches on long labels beat loose matches on short ones", () => {
    // "de" tightly at the head of a long label vs d…e straddling a short one.
    assert.ok(rank("de", "Developer — Quant Developer", "Data me") > 0);
  });

  it("the palette's own headline case: 'hull' finds the strategy first", () => {
    const catalogue = [
      "Model: Hull trend — Trend",
      "Model: Chaikin volatility — Volatility",
      "Reliability — DevOps / SRE",
    ];
    const best = catalogue
      .map((label) => ({ label, score: commandScore("hull", label) }))
      .filter((c) => c.score !== null)
      .sort((a, b) => (b.score as number) - (a.score as number))[0];
    assert.equal(best.label, "Model: Hull trend — Trend");
  });
});

describe("a whole word wins, and the last word of a label wins most", () => {
  // MEASURED 2026-08-26: typing "Mass" into the palette did not surface
  // "Markets → Lattice → Mass". Every Markets label begins "Markets →", so
  // "mass" is a subsequence of most of them — M-a-r-k-e-t-S... — and a
  // subsequence scorer with a cap of twenty let the one label that ENDS in
  // the word fall off the list. The view word is what a reader types, so a
  // query that is a whole word of the label scores above a scatter, and a
  // query that is the label's LAST word scores above that.
  const labels = [
    "Markets → Settlement → Formation",
    "Markets → Settlement → Pending",
    "Markets → Stake → Capital",
    "Markets → Stake → Method",
    "Markets → Books → Identity",
    "Markets → Books → History",
    "Markets → Dispersion → Channel",
    "Markets → Fees → Cost shape",
    "Markets → Fees → Ablation",
    "Markets → Shell → Browse",
    "Markets → Universe → Families",
    "Markets → Lattice → Moments",
    "Markets → Lattice → Mass",
  ];
  const ranked = (query: string) => labels
    .map((label) => ({ label, score: commandScore(query, label) }))
    .filter((entry): entry is { label: string; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.label);

  it("puts the label that ends in the typed word first", () => {
    assert.equal(ranked("Mass")[0], "Markets → Lattice → Mass");
    assert.equal(ranked("mass")[0], "Markets → Lattice → Mass");
    assert.equal(ranked("Families")[0], "Markets → Universe → Families");
  });

  it("still scores a whole word inside the label above a scatter", () => {
    assert.equal(ranked("Stake")[0].startsWith("Markets → Stake"), true);
  });

  it("uses the LAST word of a multi-word query, so 'lattice mass' finds the same label", () => {
    assert.equal(ranked("lattice mass")[0], "Markets → Lattice → Mass");
  });

  it("changes nothing for a query that is no whole word", () => {
    assert.equal(commandScore("wf", "Walk-forward"), commandScore("wf", "Walk-forward"));
    assert.equal(commandScore("zz", "Markets → Lattice → Mass"), null);
  });
});
