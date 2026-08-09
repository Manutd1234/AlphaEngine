/**
 * One 0-100 number for a backtest, so many runs can be ranked at a glance.
 *
 * WHAT THIS IS NOT
 *
 * It is not a prediction. Every input is measured on the run's own history, so
 * the score describes what already happened and nothing else. A 90 means "this
 * result survives the checks this desk applies to its own history", not "this
 * will make money".
 *
 * WHY THESE CATEGORIES AND NOT AEGIS'S
 *
 * The obvious move was to port the sibling project's weights directly
 * (risk-adjusted 40, drawdown 20, absolute return 10, benchmark 15,
 * consistency 8, trade quality 7). They are sensible, and they score on raw
 * Sharpe and raw return — statistics this engine already knows are inflated by
 * selection. This repository computes the Deflated Sharpe Ratio, the
 * probability of backtest overfitting and walk-forward efficiency precisely
 * because a grid search over hundreds of combinations makes the best raw Sharpe
 * a biased estimate of the next one.
 *
 * Scoring on the naive statistics while owning the corrected ones would publish
 * a number this repository's own machinery disagrees with. So robustness gets
 * its own 20 points, and the risk-adjusted category is DSR-led rather than
 * Sharpe-led.
 *
 * EVERY NORMALISATION IS WRITTEN DOWN
 *
 * A score whose formula is not visible cannot be argued with, and one nobody
 * can argue with gets trusted for the wrong reasons. Each `points` function
 * below states the anchor values and where they come from — mostly the
 * thresholds `promotionGate` already enforces, so the score and the gate cannot
 * tell contradictory stories about the same run.
 */

import type { SweepResponse } from "@/lib/types";

export interface QualityInput {
  deflatedSharpeRatio: number;
  sharpe: number;
  maxDrawdown: number;
  calmar: number;
  totalReturn: number;
  winRate: number;
  trades: number;
  /** Walk-forward OOS / IS efficiency; null when walk-forward did not run. */
  medianEfficiency: number | null;
  /** PBO-style: fraction of folds whose IS winner ranked in the worse half OOS. */
  overfittingProbability: number | null;
  walkForwardOosSharpe: number | null;
  benchmarkSharpe: number;
  benchmarkTotalReturn: number;
}

export interface QualityCategory {
  id: string;
  label: string;
  /** 0-100 within the category, before weighting. */
  score: number;
  weight: number;
  /** What drove it, in the reader's units rather than the score's. */
  detail: string;
}

export interface QualityScore {
  /** 0-100, weighted. */
  total: number;
  categories: QualityCategory[];
  /** Plain-language reading of the total. Never a prediction. */
  verdict: string;
  /** True when walk-forward is absent, so robustness could not be measured. */
  incomplete: boolean;
}

/** Linear interpolation between two anchors, clamped to 0-100. */
function ramp(value: number, zero: number, full: number): number {
  if (!Number.isFinite(value)) return 0;
  if (full === zero) return value >= full ? 100 : 0;
  return Math.max(0, Math.min(100, ((value - zero) / (full - zero)) * 100));
}

export function qualityScore(input: QualityInput): QualityScore {
  const categories: QualityCategory[] = [];

  // ── Risk-adjusted, 35 ─────────────────────────────────────────────────────
  // DSR-led, not Sharpe-led. The Deflated Sharpe Ratio is the probability the
  // true Sharpe exceeds zero after accounting for how many combinations were
  // tried; `promotionGate` requires >= 0.95, so that is full marks here. Raw
  // Sharpe contributes a third, capped at 2.0 — beyond that on a backtest is
  // more often a data artefact than an edge.
  const dsrPoints = ramp(input.deflatedSharpeRatio, 0.5, 0.95);
  const sharpePoints = ramp(input.sharpe, 0, 2);
  categories.push({
    id: "risk_adjusted",
    label: "Risk-adjusted",
    score: dsrPoints * 0.67 + sharpePoints * 0.33,
    weight: 35,
    detail: `DSR ${input.deflatedSharpeRatio.toFixed(2)} · Sharpe ${input.sharpe.toFixed(2)}`,
  });

  // ── Robustness, 20 ────────────────────────────────────────────────────────
  // The category Aegis has no equivalent of, and the reason for departing from
  // its weights. Walk-forward efficiency at 1.0 means out-of-sample matched
  // in-sample; the gate's floor is 0.5. PBO is inverted — a high probability of
  // overfitting should cost points, not earn them.
  const hasWalkForward = input.medianEfficiency !== null;
  const efficiencyPoints = ramp(input.medianEfficiency ?? 0, 0, 1);
  const pboPoints = 100 - ramp(input.overfittingProbability ?? 1, 0, 1);
  const oosPoints = ramp(input.walkForwardOosSharpe ?? 0, 0, 1.5);
  categories.push({
    id: "robustness",
    label: "Robustness (out-of-sample)",
    score: hasWalkForward ? efficiencyPoints * 0.4 + pboPoints * 0.35 + oosPoints * 0.25 : 0,
    weight: 20,
    detail: hasWalkForward
      ? `efficiency ${(input.medianEfficiency ?? 0).toFixed(2)} · PBO ${((input.overfittingProbability ?? 0) * 100).toFixed(0)}%`
      : "walk-forward did not run — unmeasured, scored zero",
  });

  // ── Drawdown and tail, 15 ─────────────────────────────────────────────────
  // Anchored where a desk's tolerance actually sits: 50% drawdown scores zero
  // and 10% scores full. Calmar carries the other half because the same
  // drawdown means something different against a 5% return and a 50% one.
  const ddPoints = ramp(-Math.abs(input.maxDrawdown), -0.5, -0.1);
  const calmarPoints = ramp(input.calmar, 0, 3);
  categories.push({
    id: "drawdown",
    label: "Drawdown & tail",
    score: ddPoints * 0.6 + calmarPoints * 0.4,
    weight: 15,
    detail: `max drawdown ${(input.maxDrawdown * 100).toFixed(1)}% · Calmar ${input.calmar.toFixed(2)}`,
  });

  // ── Versus benchmark, 15 ──────────────────────────────────────────────────
  // Beating buy-and-hold is the bar a strategy must clear to justify existing:
  // the alternative costs one trade and no research.
  //
  // Compared OUT OF SAMPLE where walk-forward ran. Using the in-sample Sharpe
  // here was a leak the tests caught: a run with a grid-inflated Sharpe of 3.2,
  // a DSR of 0.2 and 80% PBO still collected full marks in this category and
  // reached 55 overall. The whole point of the robustness category is that the
  // in-sample number is not to be trusted, and then this category trusted it.
  const effectiveSharpe = input.walkForwardOosSharpe ?? input.sharpe;
  const sharpeEdge = ramp(effectiveSharpe - input.benchmarkSharpe, 0, 1);
  const returnEdge = ramp(input.totalReturn - input.benchmarkTotalReturn, 0, 0.5);
  categories.push({
    id: "benchmark",
    label: "Versus benchmark",
    // Return edge is weighted lower than Sharpe edge because total return has
    // no out-of-sample counterpart to discount it with.
    score: sharpeEdge * 0.7 + returnEdge * 0.3,
    weight: 15,
    detail: input.walkForwardOosSharpe !== null
      ? `OOS Sharpe edge ${(effectiveSharpe - input.benchmarkSharpe).toFixed(2)} vs buy-and-hold`
      : `Sharpe edge ${(effectiveSharpe - input.benchmarkSharpe).toFixed(2)} vs buy-and-hold (in-sample)`,
  });

  // ── Trade quality, 8 ──────────────────────────────────────────────────────
  // Sample size dominates. Below thirty trades the Sharpe is a handful of
  // outcomes wearing a statistic, which is the gate's own reasoning and its own
  // threshold.
  const samplePoints = ramp(input.trades, 5, 30);
  const winPoints = ramp(input.winRate, 0.35, 0.6);
  categories.push({
    id: "trade_quality",
    label: "Trade quality",
    score: samplePoints * 0.65 + winPoints * 0.35,
    weight: 8,
    detail: `${input.trades} trades · ${(input.winRate * 100).toFixed(0)}% won`,
  });

  // ── Absolute return, 7 ────────────────────────────────────────────────────
  // Last and lightest, deliberately. A large return earned by taking a large
  // risk is already counted twice above, and weighting it heavily is how a
  // scoring system learns to prefer leverage.
  categories.push({
    id: "absolute_return",
    label: "Absolute return",
    score: ramp(input.totalReturn, 0, 1),
    weight: 7,
    detail: `${(input.totalReturn * 100).toFixed(1)}% over the tested window`,
  });

  const total = categories.reduce((sum, c) => sum + (c.score * c.weight) / 100, 0);

  return {
    total: Math.round(Math.max(0, Math.min(100, total))),
    categories,
    verdict: verdictFor(Math.round(total), !hasWalkForward),
    incomplete: !hasWalkForward,
  };
}

function verdictFor(total: number, incomplete: boolean): string {
  const caveat = incomplete
    ? " Walk-forward did not run, so robustness is unmeasured and scored zero — the total is a floor, not a verdict."
    : "";
  if (total >= 75) return `Strong on this history.${caveat}`;
  if (total >= 55) return `Worth a closer look.${caveat}`;
  if (total >= 35) return `Weak — several categories are dragging.${caveat}`;
  return `Poor on its own history.${caveat}`;
}

/**
 * The one place a sweep response becomes a score input.
 *
 * Lives here rather than in the panel because the mapping is where the score
 * gets quietly corrupted. The leak the tests caught was not in the arithmetic —
 * it was a category reading the in-sample Sharpe when an out-of-sample one
 * existed. A mapping done inline at the render site is a mapping no test can
 * reach, and this one is now covered by the same file that covers the weights.
 *
 * `data.benchmark` is buy-and-hold on the SAME symbol, which is the only
 * benchmark this engine computes today. Slice 7d replaces it with a
 * user-selected instrument; until then the "versus benchmark" category is
 * asking "did the timing beat holding it", not "did it beat the market", and
 * the panel says so rather than letting the label imply otherwise.
 */
export function qualityInputFromSweep(data: SweepResponse): QualityInput {
  return {
    deflatedSharpeRatio: data.deflatedSharpeRatio,
    sharpe: data.best.sharpe,
    maxDrawdown: data.best.maxDrawdown,
    calmar: data.best.calmar,
    totalReturn: data.best.totalReturn,
    winRate: data.best.winRate,
    trades: data.best.trades,
    // Null when walk-forward was switched off, and null is load-bearing: the
    // robustness category scores zero and says why, rather than being dropped
    // from the denominator so the total flatters an unvalidated run.
    medianEfficiency: data.walkForwardReport.medianEfficiency,
    overfittingProbability: data.walkForwardReport.overfittingProbability,
    walkForwardOosSharpe: data.walkForwardOosSharpe,
    benchmarkSharpe: data.benchmark.sharpe,
    benchmarkTotalReturn: data.benchmark.totalReturn,
  };
}

/** The weights, exported so the UI can render the breakdown without restating them. */
export const QUALITY_WEIGHTS = {
  risk_adjusted: 35,
  robustness: 20,
  drawdown: 15,
  benchmark: 15,
  trade_quality: 8,
  absolute_return: 7,
} as const;
