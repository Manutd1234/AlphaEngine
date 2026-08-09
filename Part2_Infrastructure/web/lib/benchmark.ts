/**
 * Comparison against an external instrument.
 *
 * WHAT WAS THERE BEFORE
 *
 * "Benchmark" in this engine has always meant buy-and-hold on the *same*
 * symbol. That is a real and useful question — did the timing add anything over
 * simply owning it — and it is not the question anyone means by alpha. A
 * strategy on NVDA that beat holding NVDA through 2023 still has to answer
 * whether it beat holding the index, and the same-symbol comparison cannot ask
 * it. Both are kept: `benchmark` stays exactly as it was, and this is additive.
 *
 * NO SECOND REGRESSION IMPLEMENTATION
 *
 * Alpha, beta and their t-statistics come from `regress()` — the same OLS the
 * factor decomposition already uses, with the benchmark's returns supplied as
 * the single factor. Writing a bespoke two-variable regression here would be
 * about fifteen lines and would drift from the shared one within a release, in
 * the way that a second copy of a formula always does.
 *
 * ALIGNMENT IS THE PART THAT GOES WRONG
 *
 * Two providers rarely stamp the same bar with the same epoch: FMP dates a
 * daily bar at UTC midnight, an intraday vendor stamps the open, Binance stamps
 * the open of a 24/7 candle. Joining on raw timestamps silently produces an
 * empty intersection, and an empty intersection through a regression is not an
 * error — it is `null`, or worse, a handful of points and a beta of 3.4. So the
 * join is on a bucket key derived from the interval, and the number of aligned
 * bars is reported rather than assumed.
 */

import { regress } from "./quant";
import { BARS_PER_YEAR, type Bar, type SeriesPoint } from "./types";

export interface BenchmarkComparison {
  symbol: string;
  /** Bars that survived the join. Reported because a small number is a warning. */
  alignedBars: number;
  /** The benchmark's own buy-and-hold statistics over the aligned window. */
  totalReturn: number;
  sharpe: number;
  maxDrawdown: number;
  /**
   * Per-bar intercept of the strategy's returns on the benchmark's, annualised.
   * "Not explained by this benchmark", never "real alpha" — see `regress`.
   */
  alphaAnnualised: number;
  alphaTStat: number;
  alphaPValue: number;
  /** Sensitivity to the benchmark. 1.0 means it moves with it, one for one. */
  beta: number;
  betaTStat: number;
  correlation: number;
  rSquared: number;
  /** Annualised standard deviation of the active (strategy − benchmark) return. */
  trackingError: number;
  /** Active return divided by tracking error. Null when the window is flat. */
  informationRatio: number | null;
}

/**
 * Bucket a timestamp to the grid its interval implies.
 *
 * Daily bars collapse to a UTC calendar date, which is what makes a vendor that
 * stamps 00:00:00 agree with one that stamps 13:30:00 on the same session.
 * Intraday buckets floor to the interval, which handles a few seconds of clock
 * skew between venues and nothing more — deliberately, since a 1h bar that is
 * genuinely an hour out is a different bar.
 */
export function bucketKey(t: number, interval: string): number {
  const step = { "15m": 9e5, "1h": 36e5, "4h": 144e5, "1d": 864e5 }[interval] ?? 36e5;
  return Math.floor(t / step);
}

function drawdown(equity: number[]): number {
  let peak = equity[0] ?? 1;
  let worst = 0;
  for (const value of equity) {
    if (value > peak) peak = value;
    const dd = value / peak - 1;
    if (dd < worst) worst = dd;
  }
  return worst;
}

function annualisedSharpe(returns: number[], ann: number): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
  const sd = Math.sqrt(variance);
  return sd > 0 ? (mean / sd) * Math.sqrt(ann) : 0;
}

/**
 * Fewer aligned bars than this and the comparison is not reported at all.
 *
 * A beta estimated on twenty overlapping bars is a number, and printing it next
 * to a t-statistic makes it look like a measurement. Thirty is the same floor
 * `promotionGate` uses for trade count, for the same reason and stated in the
 * same place, so the two cannot disagree about what "enough" means.
 */
export const MIN_ALIGNED_BARS = 30;

export function compareToBenchmark(
  series: SeriesPoint[],
  benchmarkBars: Bar[],
  interval: string,
  symbol: string,
): BenchmarkComparison | null {
  if (series.length < 2 || benchmarkBars.length < 2) return null;

  const byBucket = new Map<number, number>();
  // Last write wins: two vendor bars inside one bucket means the later close is
  // the one that bucket ended at.
  for (const bar of benchmarkBars) byBucket.set(bucketKey(bar.t, interval), bar.c);

  // The join. Both sides must contribute a *consecutive pair* — a return needs
  // its predecessor, and a benchmark bar whose predecessor is missing would
  // silently span the gap and report the two-day move as a one-day one.
  const strategyReturns: number[] = [];
  const benchmarkReturns: number[] = [];
  let previousBenchmark: number | null = null;
  let previousAligned = false;

  for (let i = 1; i < series.length; i++) {
    const close = byBucket.get(bucketKey(series[i].t, interval));
    const priorEquity = series[i - 1].equity;
    if (close === undefined || priorEquity <= 0) {
      previousBenchmark = close ?? null;
      previousAligned = false;
      continue;
    }
    if (previousAligned && previousBenchmark !== null && previousBenchmark > 0) {
      strategyReturns.push(series[i].equity / priorEquity - 1);
      benchmarkReturns.push(close / previousBenchmark - 1);
    }
    previousBenchmark = close;
    previousAligned = true;
  }

  if (strategyReturns.length < MIN_ALIGNED_BARS) return null;

  const ann = BARS_PER_YEAR[interval] ?? 8760;
  const fit = regress(strategyReturns, [{ name: symbol, values: benchmarkReturns }], ann);
  if (!fit) return null;

  const benchmarkEquity: number[] = [1];
  for (const r of benchmarkReturns) benchmarkEquity.push(benchmarkEquity[benchmarkEquity.length - 1] * (1 + r));

  const active = strategyReturns.map((r, i) => r - benchmarkReturns[i]);
  const activeMean = active.reduce((a, b) => a + b, 0) / active.length;
  const activeVar = active.reduce((a, b) => a + (b - activeMean) ** 2, 0) / Math.max(1, active.length - 1);
  const trackingError = Math.sqrt(activeVar) * Math.sqrt(ann);

  const loading = fit.loadings[0];
  // Correlation from R² and the sign of beta: identical to computing it
  // directly for a single-factor OLS, and one fewer place for the two to
  // disagree by a rounding step.
  const correlation = Math.sign(loading.beta) * Math.sqrt(Math.max(0, fit.rSquared));

  return {
    symbol,
    alignedBars: strategyReturns.length,
    totalReturn: benchmarkEquity[benchmarkEquity.length - 1] - 1,
    sharpe: annualisedSharpe(benchmarkReturns, ann),
    maxDrawdown: drawdown(benchmarkEquity),
    alphaAnnualised: fit.alphaAnnualised,
    alphaTStat: fit.alphaTStat,
    alphaPValue: fit.alphaPValue,
    beta: loading.beta,
    betaTStat: loading.tStat,
    correlation,
    rSquared: fit.rSquared,
    trackingError,
    // `> 0` is not the right guard. A strategy that replicates its benchmark
    // produces active returns that are zero to within a couple of ulps, not
    // exactly zero — the two series reach the same ratio by different
    // multiplications. That leaves a tracking error around 1e-17 and an
    // information ratio in the billions, which is float residue presented as
    // the best risk-adjusted result ever recorded. An annualised dispersion
    // below 1e-9 is a per-bar standard deviation around 1e-11: not a small
    // measurement, an absent one.
    informationRatio: trackingError > 1e-9 ? (activeMean * ann) / trackingError : null,
  };
}
