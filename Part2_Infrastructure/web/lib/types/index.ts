/**
 * Shared contracts between the API routes and the UI.
 *
 * This was one 793-line file. It is now three, and this barrel is the reason
 * none of the 62 importing modules had to change: `@/lib/types` still resolves
 * here and still exports every name it exported before.
 *
 * The re-export list is written out name by name rather than as `export *`.
 * `export *` is exhaustive by construction, which sounds like the safer
 * choice, but it also silently re-exports anything a sibling adds later and
 * silently drops nothing when a sibling renames — the failure mode is a name
 * that quietly stops existing at this path while every file still compiles
 * against the sibling directly. Spelled out, a rename is a compile error here,
 * which is where a contract change should surface. Nothing holds the two lists
 * to each other as of 2026-08-21; the suite this named no longer exists.
 */

export type { BenchmarkComparison } from "../benchmark";

export {
  CHART_SERIES,
  PARAM_MEANING,
  STRATEGY_FAMILY,
  STRATEGY_LABELS,
} from "./strategies";
export type { Strategy, StrategyFamily } from "./strategies";

export {
  BARS_PER_YEAR,
  DATA_SOURCES,
  DEFAULT_REQUEST,
  INTERVALS,
  isMeasuredSource,
  MAX_COMBOS,
} from "./sweep";
export type {
  Bar,
  DataSource,
  Direction,
  MinTrackRecordEntry,
  MonteCarloBands,
  NamedWindowStat,
  ParamResult,
  RegimeReport,
  RegimeStat,
  SeriesPoint,
  SweepRequest,
  SweepResponse,
  WalkForwardFold,
} from "./sweep";

export type {
  CellKind,
  CostSummary,
  FactorLoading,
  FactorReport,
  FoldEfficiency,
  MonthlyReturn,
  PromotionCheck,
  PromotionGate,
  Regression,
  StabilityCell,
  StabilityReport,
  TailReport,
  Verdict,
  WalkForwardReport,
} from "./analytics";
