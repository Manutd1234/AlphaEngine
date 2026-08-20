import {
  BARS_PER_YEAR,
  type Bar,
  type CellKind,
  type FoldEfficiency,
  type MonthlyReturn,
  type ParamResult,
  type PromotionCheck,
  type PromotionGate,
  type Regression,
  type StabilityCell,
  type StabilityReport,
  type TailReport,
  type Verdict,
  type WalkForwardFold,
  type WalkForwardReport,
} from "../types";

/**
 * Local copy of the engine's helper, so the dependency runs one way only.
 *
 * `engine.ts` imports the cost model from this file; if this file imported
 * anything back the two would form a cycle. ESM tolerates that for hoisted
 * function declarations and then breaks confusingly the first time someone adds
 * a module-level constant, so the one-line duplication is the cheaper trade.
 */
export const barsPerYear = (interval: string) => BARS_PER_YEAR[interval] ?? 8760;
