/**
 * Which strategies this browser has actually run — derived, never stored.
 *
 * The experiment log (`lib/experiments.ts`) is the only record of attempts,
 * and it is deliberately imperfect memory: 60 records, request-deduplicated,
 * clearable. A separately persisted "strategies tried" store would immediately
 * disagree with it — surviving eviction, surviving Clear, counting auto-runs
 * the log refuses to count — and two stores disagreeing about how much
 * searching happened is the exact dishonesty the log exists to prevent. So
 * explored-state is a projection of the log, recomputed on read, and every
 * surface that shows it labels the provenance: *from this browser's run log
 * (last 60 runs)*. It can regress when old records fall off the end. That is
 * correct behaviour: a counter that cannot regress would be claiming memory
 * the system does not have.
 */

import type { ExperimentRecord } from "./experiments";
import { STRATEGY_FAMILY, type Strategy, type StrategyFamily } from "./types";

export interface StrategyProgress {
  /** Records in the log for this strategy — hypotheses, not keystrokes. */
  runs: number;
  /** The best verdict any of those runs earned. */
  bestVerdict: "pass" | "marginal" | "fail" | null;
  lastRunAt: number | null;
}

export interface FamilyProgress {
  family: StrategyFamily;
  /** Strategies in the catalogue for this family. */
  total: number;
  /** How many of them appear in the log. */
  explored: number;
}

/** Families in presentation order: rule-based first, the estimated one last. */
export const FAMILY_ORDER: readonly StrategyFamily[] = [
  "Trend", "Breakout", "Mean reversion", "Momentum", "Volume", "Volatility", "Fitted",
];

const VERDICT_RANK: Record<"pass" | "marginal" | "fail", number> = {
  pass: 2,
  marginal: 1,
  fail: 0,
};

/** The catalogue grouped by family, in catalogue order within each group. */
export function strategiesByFamily(): ReadonlyMap<StrategyFamily, Strategy[]> {
  const groups = new Map<StrategyFamily, Strategy[]>(FAMILY_ORDER.map((f) => [f, []]));
  for (const [strategy, family] of Object.entries(STRATEGY_FAMILY) as [Strategy, StrategyFamily][]) {
    groups.get(family)?.push(strategy);
  }
  return groups;
}

/**
 * Per-strategy state from the log. Strategies never run are absent — read
 * through `progressFor` for the hollow default.
 */
export function strategyProgress(records: ExperimentRecord[]): Map<Strategy, StrategyProgress> {
  const progress = new Map<Strategy, StrategyProgress>();
  for (const record of records) {
    // A record from a newer deploy can carry a strategy this build does not
    // know. It has no card to mark, and guessing a family for it would show
    // progress on the wrong group.
    if (!(record.strategy in STRATEGY_FAMILY)) continue;
    const current = progress.get(record.strategy) ?? { runs: 0, bestVerdict: null, lastRunAt: null };
    progress.set(record.strategy, {
      runs: current.runs + 1,
      bestVerdict:
        current.bestVerdict === null
        || VERDICT_RANK[record.verdict] > VERDICT_RANK[current.bestVerdict]
          ? record.verdict
          : current.bestVerdict,
      lastRunAt: Math.max(current.lastRunAt ?? 0, record.savedAt) || null,
    });
  }
  return progress;
}

export function progressFor(
  progress: ReadonlyMap<Strategy, StrategyProgress>,
  strategy: Strategy,
): StrategyProgress {
  return progress.get(strategy) ?? { runs: 0, bestVerdict: null, lastRunAt: null };
}

/** Explored-of-total per family, in `FAMILY_ORDER`. */
export function familyProgress(records: ExperimentRecord[]): FamilyProgress[] {
  const progress = strategyProgress(records);
  return [...strategiesByFamily()].map(([family, strategies]) => ({
    family,
    total: strategies.length,
    explored: strategies.filter((s) => progress.has(s)).length,
  }));
}
