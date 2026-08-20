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
import { median } from "./factors";

// --------------------------------------------------------------------------
// Walk-forward efficiency
// --------------------------------------------------------------------------

/**
 * Walk-forward efficiency, per fold.
 *
 * WFE is only defined when the in-sample Sharpe was positive. Dividing by a
 * negative IS Sharpe produces a *positive* ratio for a fold that lost money in
 * both windows, which reads as success — so those folds report null and are
 * counted separately rather than being folded into a median that would flatter
 * the strategy.
 */
export function walkForwardReport(
  folds: WalkForwardFold[],
  fasts: number[],
  slows: number[],
): WalkForwardReport {
  const fastIndex = new Map([...new Set(fasts)].sort((a, b) => a - b).map((v, i) => [v, i]));
  const slowIndex = new Map([...new Set(slows)].sort((a, b) => a - b).map((v, i) => [v, i]));

  const enriched: FoldEfficiency[] = folds.map((fold, i) => {
    const prev = i > 0 ? folds[i - 1] : null;
    const drift = prev
      ? Math.abs((fastIndex.get(fold.chosenFast) ?? 0) - (fastIndex.get(prev.chosenFast) ?? 0))
        + Math.abs((slowIndex.get(fold.chosenSlow) ?? 0) - (slowIndex.get(prev.chosenSlow) ?? 0))
      : null;
    return {
      ...fold,
      efficiency: fold.isSharpe > 0 ? fold.oosSharpe / fold.isSharpe : null,
      paramDrift: drift,
    };
  });

  const defined = enriched.map((f) => f.efficiency).filter((e): e is number => e !== null);
  const positiveFolds = enriched.filter((f) => f.oosSharpe > 0).length;
  const drifts = enriched.map((f) => f.paramDrift).filter((d): d is number => d !== null);
  const persistence = drifts.length ? drifts.filter((d) => d === 0).length / drifts.length : null;

  return {
    folds: enriched,
    medianEfficiency: defined.length ? median(defined) : null,
    positiveFolds,
    totalFolds: enriched.length,
    parameterPersistence: persistence,
    overfittingProbability: overfittingProbability(folds),
    verdict: walkForwardVerdict(enriched, defined.length ? median(defined) : null, positiveFolds),
  };
}

/**
 * Probability of backtest overfitting, the cheap sequential reading.
 *
 * Bailey et al. rank the in-sample winner against every other combination
 * out-of-sample and ask how often it lands in the losing half. Full CPCV does
 * this over every combinatorial train/test split; this uses the walk-forward
 * folds already computed, which costs nothing extra and answers the same
 * question with a coarser estimate.
 *
 * Mirrors `overfitting_probability` in the Python reference.
 */
export function overfittingProbability(folds: WalkForwardFold[]): number | null {
  const ranked = folds.filter(
    (f): f is WalkForwardFold & { oosRank: number; combosRanked: number } =>
      typeof f.oosRank === "number" && typeof f.combosRanked === "number" && f.combosRanked > 1,
  );
  if (!ranked.length) return null;
  const losses = ranked.filter((f) => f.oosRank > (f.combosRanked + 1) / 2).length;
  return Number((losses / ranked.length).toFixed(4));
}

function walkForwardVerdict(
  folds: FoldEfficiency[],
  medianEff: number | null,
  positiveFolds: number,
): Verdict {
  if (!folds.length) {
    return {
      level: "fail",
      headline: "No walk-forward evidence",
      detail: "There were not enough bars to split into training and testing windows.",
    };
  }
  const share = positiveFolds / folds.length;
  if (medianEff !== null && medianEff >= 0.5 && share >= 0.6) {
    return {
      level: "pass",
      headline: "Out-of-sample performance holds",
      detail:
        `Median walk-forward efficiency is ${medianEff.toFixed(2)} and ${positiveFolds} of ${folds.length} `
        + "folds were profitable out-of-sample. Parameters chosen on one window kept working on the next.",
    };
  }
  if (medianEff !== null && medianEff > 0 && share >= 0.5) {
    return {
      level: "marginal",
      headline: "Out-of-sample performance decays",
      detail:
        `Median efficiency is ${medianEff.toFixed(2)} — the strategy keeps some of its in-sample edge but loses `
        + "most of it. Expect live results nearer the out-of-sample column than the headline.",
    };
  }
  return {
    level: "fail",
    headline: "The edge does not survive the fold boundary",
    detail:
      `Only ${positiveFolds} of ${folds.length} folds were profitable out-of-sample`
      + (medianEff !== null ? `, at a median efficiency of ${medianEff.toFixed(2)}` : "")
      + ". Parameters selected on one window stop working on the next, which is the definition of overfitting.",
  };
}
