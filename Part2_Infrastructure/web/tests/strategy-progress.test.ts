/**
 * Explored-state is a projection of the experiment log, and the failure modes
 * worth pinning are the silent ones: a verdict comparison that quietly ranks
 * "fail" above "pass" still renders a plausible codex, and a rollup that
 * miscounts by one still looks like progress. Every assertion here is against
 * hand-computed expectations on synthetic records.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { ExperimentRecord } from "../lib/experiments";
import {
  FAMILY_ORDER,
  familyProgress,
  progressFor,
  strategiesByFamily,
  strategyProgress,
} from "../lib/strategy-progress";
import { STRATEGY_FAMILY } from "../lib/types";

/** The minimum of a record this module reads: strategy, verdict, savedAt. */
function record(
  strategy: string,
  verdict: "pass" | "marginal" | "fail",
  savedAt: number,
): ExperimentRecord {
  return { strategy, verdict, savedAt } as unknown as ExperimentRecord;
}

describe("the catalogue grouping", () => {
  it("covers all 46 strategies across the seven families, each exactly once", () => {
    const groups = strategiesByFamily();
    const all = [...groups.values()].flat();
    assert.equal(all.length, Object.keys(STRATEGY_FAMILY).length);
    assert.equal(new Set(all).size, all.length, "a strategy appears in two families");
    assert.deepEqual([...groups.keys()], [...FAMILY_ORDER]);
  });

  it("groups by the family map, not by name coincidence", () => {
    for (const [family, strategies] of strategiesByFamily()) {
      for (const strategy of strategies) {
        assert.equal(STRATEGY_FAMILY[strategy], family);
      }
    }
  });
});

describe("per-strategy progress", () => {
  it("an empty log explores nothing", () => {
    const progress = strategyProgress([]);
    assert.equal(progress.size, 0);
    assert.deepEqual(progressFor(progress, "ma_cross"), {
      runs: 0,
      bestVerdict: null,
      lastRunAt: null,
    });
  });

  it("counts runs and keeps the latest timestamp", () => {
    const progress = strategyProgress([
      record("ma_cross", "fail", 100),
      record("ma_cross", "fail", 300),
      record("ma_cross", "fail", 200),
    ]);
    assert.deepEqual(progressFor(progress, "ma_cross"), {
      runs: 3,
      bestVerdict: "fail",
      lastRunAt: 300,
    });
  });

  it("best verdict means best, regardless of arrival order", () => {
    // pass must survive a later fail, and marginal must beat fail — an
    // inverted rank comparison passes every single-verdict test.
    const passFirst = strategyProgress([
      record("donchian", "pass", 1),
      record("donchian", "fail", 2),
    ]);
    assert.equal(progressFor(passFirst, "donchian").bestVerdict, "pass");

    const failFirst = strategyProgress([
      record("donchian", "fail", 1),
      record("donchian", "marginal", 2),
    ]);
    assert.equal(progressFor(failFirst, "donchian").bestVerdict, "marginal");
  });

  it("ignores a strategy this build does not know", () => {
    // An imported log from a newer deploy: the unknown id has no card to
    // mark, and crashing the codex over it would take Research down.
    const progress = strategyProgress([
      record("ichimoku_cloud", "pass", 1),
      record("ma_cross", "pass", 2),
    ]);
    assert.equal(progress.size, 1);
    assert.ok(progress.has("ma_cross"));
  });
});

describe("family rollup", () => {
  it("totals match the catalogue and sum to 46", () => {
    const rollup = familyProgress([]);
    assert.deepEqual(rollup.map((f) => f.family), [...FAMILY_ORDER]);
    assert.equal(rollup.reduce((sum, f) => sum + f.total, 0), 46);
    for (const family of rollup) assert.equal(family.explored, 0);
  });

  it("explored counts distinct strategies, not runs", () => {
    const rollup = familyProgress([
      record("ma_cross", "pass", 1), // Trend
      record("ma_cross", "fail", 2), // same strategy again
      record("hull_trend", "fail", 3), // Trend
      record("rsi_reversion", "marginal", 4), // Mean reversion
    ]);
    const byFamily = new Map(rollup.map((f) => [f.family, f]));
    assert.equal(byFamily.get("Trend")?.explored, 2);
    assert.equal(byFamily.get("Mean reversion")?.explored, 1);
    assert.equal(byFamily.get("Volume")?.explored, 0);
  });

  it("explored can regress when the log is cleared — by design", () => {
    const before = familyProgress([record("ma_cross", "pass", 1)]);
    const after = familyProgress([]);
    assert.equal(before.find((f) => f.family === "Trend")?.explored, 1);
    assert.equal(after.find((f) => f.family === "Trend")?.explored, 0);
  });
});

describe("the projection stays a projection", () => {
  it("never touches storage", () => {
    // The module must stay pure: a localStorage read here would be the second
    // store the header comment forbids.
    const source = readFileSync(
      new URL("../lib/strategy-progress.ts", import.meta.url),
      "utf8",
    );
    assert.ok(!source.includes("localStorage"), "strategy-progress reads storage directly");
  });
});
