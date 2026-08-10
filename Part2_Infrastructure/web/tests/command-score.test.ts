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
    assert.equal(commandScore("fw", "Walk-forward — evidence"), null);
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
