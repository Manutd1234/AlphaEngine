import { mean, normCdf, stdev } from "../stats";
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
import { barsPerYear } from "./common";

// --------------------------------------------------------------------------
// Tail risk and return distribution
// --------------------------------------------------------------------------

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

export function tailReport(
  returns: Float64Array,
  equity: Float64Array,
  bars: Bar[],
  interval: string,
  turnoverTotal: number,
): TailReport {
  const sorted = [...returns].sort((a, b) => a - b);
  const var95 = percentile(sorted, 5);
  const var99 = percentile(sorted, 1);

  /**
   * Expected shortfall as the mean of the worst ⌈p·n⌉ observations.
   *
   * The obvious implementation — average everything at or below the VaR
   * threshold — is only equal to this when the quantile is not a repeated
   * value, and in a backtest it very often is. A strategy that is flat most of
   * the time earns *exactly* zero on every bar it holds nothing, so with 1.5%
   * exposure the 5th percentile lands on that atom of zeros: the "tail" becomes
   * every non-positive bar, and the average is taken over 99% of the sample.
   * Measured on a default RSI run that understated CVaR95 by 19.8× and CVaR99
   * by 99×, and printed the two as the identical number — which is the visible
   * tell that the selection was by value rather than by rank.
   */
  const tailOf = (p: number) => {
    if (!sorted.length) return 0;
    const k = Math.max(1, Math.ceil((p / 100) * sorted.length));
    return mean(sorted.slice(0, k));
  };

  let losingStreak = 0;
  let maxLosingStreak = 0;
  let positive = 0;
  for (let i = 0; i < returns.length; i++) {
    if (returns[i] > 0) positive += 1;
    if (returns[i] < 0) {
      losingStreak += 1;
      if (losingStreak > maxLosingStreak) maxLosingStreak = losingStreak;
    } else {
      losingStreak = 0;
    }
  }

  // Ulcer index over the equity curve: sqrt(mean(drawdown²)). Max drawdown says
  // how deep the hole was; this says how much time was spent in it.
  let peak = -Infinity;
  let sumSqDd = 0;
  for (let i = 0; i < equity.length; i++) {
    if (equity[i] > peak) peak = equity[i];
    const dd = equity[i] / peak - 1;
    sumSqDd += dd * dd;
  }

  const ann = barsPerYear(interval);
  const years = bars.length / ann;

  return {
    var95,
    var99,
    cvar95: tailOf(5),
    cvar99: tailOf(1),
    tailRatio: Math.abs(percentile(sorted, 5)) > 0
      ? Math.abs(percentile(sorted, 95)) / Math.abs(percentile(sorted, 5))
      : 0,
    bestBar: sorted[sorted.length - 1] ?? 0,
    worstBar: sorted[0] ?? 0,
    positiveBars: positive,
    totalBars: returns.length,
    maxLosingStreak,
    ulcerIndex: equity.length ? Math.sqrt(sumSqDd / equity.length) : 0,
    monthly: monthlyReturns(returns, bars),
    annualisedTurnover: years > 0 ? turnoverTotal / years : 0,
  };
}

/**
 * Compound per-bar returns into calendar months.
 *
 * Calendar months, not 30-bar blocks: a researcher comparing this grid against a
 * tear sheet, a fund report or their own memory is thinking in calendar months,
 * and a rolling block that happens to be the same length is not the same object.
 */
export function monthlyReturns(returns: Float64Array, bars: Bar[]): MonthlyReturn[] {
  const buckets = new Map<string, { growth: number; bars: number; year: number; month: number }>();
  const n = Math.min(returns.length, bars.length);
  for (let i = 0; i < n; i++) {
    const d = new Date(bars[i].t);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    const key = `${year}-${String(month + 1).padStart(2, "0")}`;
    const bucket = buckets.get(key) ?? { growth: 1, bars: 0, year, month };
    bucket.growth *= 1 + returns[i];
    bucket.bars += 1;
    buckets.set(key, bucket);
  }
  return [...buckets.entries()]
    .map(([month, b]) => ({
      month,
      year: b.year,
      monthIndex: b.month,
      return: b.growth - 1,
      bars: b.bars,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}
