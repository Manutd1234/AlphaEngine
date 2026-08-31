import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COPY_EXCLUSIONS,
  VISIBLE_COPY_BASELINE,
  VISIBLE_COPY_BUDGET,
  VISIBLE_COPY_ROUTES,
  VISIBLE_COPY_SETTLING,
  compareVisibleCopy,
  countVisibleTokens,
  hashVisibleText,
  reductionPercent,
  summariseReadings,
} from "../scripts/visible-copy-audit.mjs";
import { COHERENCE_SECTIONS, MARKETS_SECTIONS } from "../lib/sections";
import { viewsFor } from "../lib/section-views";

describe("the rendered-copy audit", () => {
  it("walks every addressable desk state exactly once", () => {
    assert.equal(VISIBLE_COPY_ROUTES.length, 120);
    assert.equal(new Set(VISIBLE_COPY_ROUTES.map((route) => route.hash)).size, 120);

    const expectedMarkets = MARKETS_SECTIONS.flatMap((section) =>
      viewsFor("markets", section.id).map(([view]) => `markets/${section.id}/${view}`));
    const expectedProofs = COHERENCE_SECTIONS.flatMap((section) =>
      viewsFor("coherence", section.id).map(([view]) => `coherence/${section.id}/${view}`));
    assert.equal(expectedMarkets.length, 26);
    assert.equal(expectedProofs.length, 29);
    assert.deepEqual(
      VISIBLE_COPY_ROUTES.filter((route) => route.desk === "markets").map((route) => route.hash),
      expectedMarkets,
    );
    assert.deepEqual(
      VISIBLE_COPY_ROUTES.filter((route) => route.desk === "coherence").map((route) => route.hash),
      expectedProofs,
    );

    for (const hash of [
      "research/codex",
      "research/summary/setup",
      "markets/universe/positions",
      "markets/books/history",
      "coherence/combos/inputs",
      "coherence/combos/legs",
      "coherence/calibration/decomposition",
      "coherence/calibration/components",
      "coherence/calibration/measures",
      "coherence/calibration/reliability",
      "coherence/lessons/prices",
      "coherence/lessons/coverage",
      "diffusion/sandbox/spectrum",
    ]) {
      assert.ok(VISIBLE_COPY_ROUTES.some((route) => route.hash === hash), `${hash} is missing`);
    }
  });

  it("counts interface tokens reproducibly", () => {
    assert.equal(countVisibleTokens("P99 latency: 84 ns; marginal VaR = 2.4%."), 7);
    assert.equal(countVisibleTokens("  "), 0);
  });

  it("excludes machine-generated inventories, not explanatory UI", () => {
    assert.deepEqual(COPY_EXCLUSIONS, [".codebase-filelist ul", ".console-log", "[role='log']"]);
    assert.ok(!COPY_EXCLUSIONS.some((selector) => selector.includes("table")));
  });

  it("locks the settled browser baseline and the ten-to-fifteen-percent release band", () => {
    assert.deepEqual(VISIBLE_COPY_BASELINE, {
      words: 33_231,
      characters: 208_697,
      states: 108,
      viewport: "1440x1000",
      observedAt: "2026-08-28",
    });
    assert.deepEqual(VISIBLE_COPY_BUDGET, {
      maximumWords: 29_750,
      minimumReductionPercent: 10,
      maximumReductionPercent: 15,
    });
    assert.ok(VISIBLE_COPY_BUDGET.maximumWords <= 29_750);
    assert.ok(reductionPercent(VISIBLE_COPY_BASELINE.words, VISIBLE_COPY_BUDGET.maximumWords)! >= 10);
  });

  it("does not compare a historical total with a different route inventory", () => {
    const comparison = compareVisibleCopy(
      VISIBLE_COPY_BASELINE,
      { words: 25_000, states: VISIBLE_COPY_ROUTES.length },
    );
    assert.equal(comparison.inventoryComparable, false);
    assert.match(comparison.comparisonReason ?? "", /108 states; current inventory covers 120 states/);
    assert.equal(comparison.wordReductionPercent, null);
    assert.equal(comparison.wordsOverBudget, null);
    assert.equal(comparison.withinBudget, null);

    const sameInventory = compareVisibleCopy(
      VISIBLE_COPY_BASELINE,
      { words: VISIBLE_COPY_BUDGET.maximumWords, states: VISIBLE_COPY_BASELINE.states },
    );
    assert.equal(sameInventory.inventoryComparable, true);
    assert.equal(sameInventory.comparisonReason, null);
    assert.equal(sameInventory.withinBudget, true);
  });

  it("defines settled as two identical, non-loading samples 250ms apart", () => {
    assert.deepEqual(VISIBLE_COPY_SETTLING, {
      sampleIntervalMs: 250,
      timeoutMs: 35_000,
      identicalSamples: 2,
    });
    assert.equal(hashVisibleText("stable desk"), hashVisibleText("stable desk"));
    assert.notEqual(hashVisibleText("stable desk"), hashVisibleText("loading desk"));
  });

  it("reports per-tab totals plus median, P95 and maximum state density", () => {
    const summary = summariseReadings([
      { desk: "overview", hash: "overview/loop", words: 10, characters: 40 },
      { desk: "overview", hash: "overview/desks", words: 20, characters: 80 },
      { desk: "risk", hash: "risk/limits", words: 100, characters: 400 },
    ]);
    assert.deepEqual(summary.distribution, {
      medianWords: 20,
      p95Words: 100,
      maximumWords: 100,
      maximumState: "risk/limits",
    });
    assert.deepEqual(summary.byTab.overview, {
      states: 2,
      words: 30,
      characters: 120,
      medianWords: 15,
      p95Words: 20,
      maximumWords: 20,
      maximumState: "overview/desks",
    });
  });
});
