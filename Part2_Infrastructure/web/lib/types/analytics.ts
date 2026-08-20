/**
 * Research analytics contracts.
 *
 * Defined as contract rather than as implementation because they cross the API
 * boundary: the route serialises them and the browser deserialises them, so
 * `lib/quant` imports them back rather than owning them. Split out of
 * `lib/types.ts` when that file passed 790 lines; the section comment that used
 * to head this block is above.
 *
 * `WalkForwardFold` comes back from `./sweep`, which itself needs the report
 * shapes below. Both directions are `import type`, so the cycle exists only in
 * the checker and never in the emitted graph.
 */

import type { WalkForwardFold } from "./sweep";

/** How a grid point behaves relative to its tested neighbours. */
export type CellKind = "plateau" | "slope" | "cliff" | "dead" | "isolated";

export interface StabilityCell {
  fast: number;
  slow: number;
  sharpe: number;
  /** Grid-adjacent combinations that were actually tested (up to 8). */
  neighbours: number;
  neighbourMean: number;
  neighbourMin: number;
  /** neighbourMean / sharpe — how much of the cell's edge the area retains. */
  retention: number | null;
  kind: CellKind;
}

export interface StabilityReport {
  cells: StabilityCell[];
  best: StabilityCell | null;
  plateauCount: number;
  cliffCount: number;
  classified: number;
  verdict: Verdict;
}

export interface Verdict {
  level: "pass" | "marginal" | "fail";
  headline: string;
  detail: string;
}

export interface FoldEfficiency extends WalkForwardFold {
  /** OOS Sharpe as a fraction of IS Sharpe. Null when IS was not positive. */
  efficiency: number | null;
  /** Grid-step distance from the previous fold's chosen parameters. */
  paramDrift: number | null;
}

export interface WalkForwardReport {
  folds: FoldEfficiency[];
  medianEfficiency: number | null;
  positiveFolds: number;
  totalFolds: number;
  /** Fraction of folds that re-selected the previous fold's parameters. */
  parameterPersistence: number | null;
  /**
   * Probability of backtest overfitting: the fraction of folds whose in-sample
   * winner landed in the worse half of the same grid out-of-sample. A strategy
   * whose winners keep placing in the bottom half is being chosen by noise.
   * Null when no fold ranked its grid.
   */
  overfittingProbability: number | null;
  verdict: Verdict;
}

export interface FactorLoading {
  name: string;
  beta: number;
  tStat: number;
  pValue: number;
}

export interface Regression {
  n: number;
  alpha: number;
  alphaAnnualised: number;
  alphaTStat: number;
  alphaPValue: number;
  loadings: FactorLoading[];
  rSquared: number;
  adjRSquared: number;
  idiosyncraticShare: number;
  informationRatio: number;
  collinearity: { a: string; b: string; corr: number }[];
}

export interface FactorReport {
  regression: Regression;
  /** One line per factor saying exactly what it is, so nothing is implied. */
  descriptions: string[];
  lookback: number;
  /** Stated in the payload, not just in the UI copy — see `lib/quant.ts`. */
  note: string;
}

export interface MonthlyReturn {
  month: string;
  year: number;
  monthIndex: number;
  return: number;
  bars: number;
}

export interface TailReport {
  var95: number;
  var99: number;
  cvar95: number;
  cvar99: number;
  tailRatio: number;
  bestBar: number;
  worstBar: number;
  positiveBars: number;
  totalBars: number;
  maxLosingStreak: number;
  ulcerIndex: number;
  monthly: MonthlyReturn[];
  annualisedTurnover: number;
}

export interface PromotionCheck {
  id: string;
  label: string;
  value: string;
  hurdle: string;
  passed: boolean;
  why: string;
}

export interface PromotionGate {
  checks: PromotionCheck[];
  passed: number;
  total: number;
  eligible: boolean;
}

export interface CostSummary {
  /** Flat fee + slippage, in basis points of traded notional. */
  flatBps: number;
  /** Average daily quote volume the impact model was sized against. */
  averageDailyVolume: number;
  /** Modelled impact in bps at the configured order size; 0 when disabled. */
  impactBps: number;
  /** Fraction of ADV a single order represents; 0 when impact is disabled. */
  participation: number;
  fundingBpsPer8h: number;
  borrowBpsAnnual: number;
  /** True when every friction beyond flat fee/slippage is switched off. */
  flatOnly: boolean;
}
