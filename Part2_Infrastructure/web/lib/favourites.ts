/**
 * Combining saved runs into one portfolio.
 *
 * RE-RUN, DO NOT REPLAY
 *
 * `ExperimentRecord` deliberately stores a projection — symbol, strategy,
 * parameters, window — and never the return series, because `localStorage` has
 * a 5 MB quota and sixty records of two thousand floats would blow it. That
 * decision is documented at `experiments.ts` and this module works with it
 * rather than around it: what a record holds is exactly the recipe needed to
 * re-execute the run, and a sweep costs tens of milliseconds.
 *
 * WHY THE WEIGHTS ARE FITTED ON A WINDOW THEY ARE NOT MEASURED ON
 *
 * Choosing weights that minimise variance over a period and then reporting the
 * variance over that same period is the identical mistake this repository
 * computes a Deflated Sharpe Ratio to avoid, one level up: the optimiser has
 * seen every observation it is being scored on. So the series is split, weights
 * are fitted on the earlier part and the combined result is measured on the
 * later part that the fit never saw. Both numbers are reported, and the gap
 * between them is the finding.
 *
 * ALIGNMENT, AGAIN
 *
 * Two runs on different symbols and intervals do not have the same bars. Joining
 * them by array index would pair Tuesday's BTC return with Thursday's AAPL one
 * and report the result as a portfolio. The join is on timestamp, and the
 * overlap is reported — a combination of five runs sharing forty bars is not a
 * portfolio, it is a coincidence.
 */

import { buildCovariance, proposeAllocation, type AllocationMethod } from "./portfolio-risk";

/** One re-executed favourite: what it was, and what it returned per bar. */
export interface FavouriteSeries {
  /** Stable key for the run — the experiment id, not the symbol. Two runs may
   *  share a symbol and must never share a slot in the covariance matrix. */
  id: string;
  label: string;
  symbol: string;
  /** Bar timestamps, ascending. */
  timestamps: number[];
  /** Per-bar strategy returns, same length as `timestamps`. */
  returns: number[];
}

export interface AlignedFavourites {
  ids: string[];
  timestamps: number[];
  /** returns[id] → the aligned series, all the same length. */
  returns: Record<string, number[]>;
  /** Bars every run had in common. Small is a warning, not a detail. */
  overlap: number;
  /** Longest single run, so a reader can see how much was thrown away. */
  longest: number;
}

/**
 * Inner-join the runs on timestamp.
 *
 * Deliberately an inner join and not a fill. Carrying a missing return forward
 * as zero reads as "this strategy was flat that day", which is a position, not
 * an absence — and a series padded with zeros has understated volatility and
 * understated correlation, the two errors that both make a portfolio look safer
 * than it is.
 */
export function alignFavourites(series: FavouriteSeries[]): AlignedFavourites | null {
  if (series.length < 2) return null;

  const sets = series.map((s) => new Set(s.timestamps));
  const common = series[0].timestamps.filter((t) => sets.every((set) => set.has(t)));
  if (!common.length) return null;

  const returns: Record<string, number[]> = {};
  for (const run of series) {
    const byTime = new Map<number, number>();
    for (let i = 0; i < run.timestamps.length; i++) byTime.set(run.timestamps[i], run.returns[i]);
    returns[run.id] = common.map((t) => byTime.get(t) ?? 0);
  }

  return {
    ids: series.map((s) => s.id),
    timestamps: common,
    returns,
    overlap: common.length,
    longest: Math.max(...series.map((s) => s.timestamps.length)),
  };
}

/** Below this the covariance is an anecdote; `buildCovariance` needs 20 to answer at all. */
export const MIN_OVERLAP_BARS = 60;

/** Fraction of the overlap used to fit weights; the rest is the holdout. */
export const HOLDOUT_SPLIT = 0.7;

export interface CombinedResult {
  method: AllocationMethod | "max_sharpe";
  weights: Record<string, number>;
  /** Measured on the window the weights were FITTED on — the flattering one. */
  inSampleSharpe: number;
  /** Measured on the window the fit never saw. The one that means something. */
  holdoutSharpe: number;
  holdoutReturn: number;
  holdoutMaxDrawdown: number;
  /** Combined − best single favourite, out of sample. Negative is common and honest. */
  edgeOverBestSingle: number;
}

function sharpe(returns: number[], ann: number): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
  const sd = Math.sqrt(variance);
  return sd > 0 ? (mean / sd) * Math.sqrt(ann) : 0;
}

function drawdown(returns: number[]): number {
  let equity = 1;
  let peak = 1;
  let worst = 0;
  for (const r of returns) {
    equity *= 1 + r;
    if (equity > peak) peak = equity;
    const dd = equity / peak - 1;
    if (dd < worst) worst = dd;
  }
  return worst;
}

function weighted(aligned: AlignedFavourites, weights: Record<string, number>, from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i < to; i++) {
    let total = 0;
    for (const id of aligned.ids) total += (weights[id] ?? 0) * aligned.returns[id][i];
    out.push(total);
  }
  return out;
}

/**
 * Maximum-Sharpe (tangency) weights, long-only and fully invested.
 *
 * The one method here with no existing implementation to generalise — the four
 * in `portfolio-risk.ts` size risk and none of them forecasts a return, which
 * is exactly what a tangency portfolio has to do. Solved by projected gradient
 * ascent on the Sharpe ratio rather than by inverting the covariance: the
 * closed form `Σ⁻¹μ` is unbounded and routinely returns leveraged shorts, and
 * with two highly correlated favourites — which is the normal case, since a
 * researcher saves variations on one idea — it is numerically hopeless.
 *
 * The mean estimate is the part to distrust. Expected returns are far noisier
 * than covariances, which is the standard argument for preferring minimum
 * variance, and it is why this method is offered beside the other four rather
 * than as the default.
 */
export function maxSharpeWeights(
  ids: string[],
  returns: Record<string, number[]>,
  from: number,
  to: number,
): Record<string, number> | null {
  const n = ids.length;
  if (n === 0 || to - from < 2) return null;

  const series = ids.map((id) => returns[id].slice(from, to));
  const mu = series.map((r) => r.reduce((a, b) => a + b, 0) / r.length);
  const cov = series.map((a) => series.map((b) => {
    const ma = a.reduce((x, y) => x + y, 0) / a.length;
    const mb = b.reduce((x, y) => x + y, 0) / b.length;
    let s = 0;
    for (let i = 0; i < a.length; i++) s += (a[i] - ma) * (b[i] - mb);
    return s / (a.length - 1);
  }));

  // Equal weight is the starting point and also the fallback: if no step
  // improves on it, returning it is the honest answer rather than whichever
  // corner the iteration wandered into.
  let best = new Array<number>(n).fill(1 / n);
  const objective = (w: number[]) => {
    let m = 0;
    for (let i = 0; i < n; i++) m += w[i] * mu[i];
    let v = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) v += w[i] * cov[i][j] * w[j];
    return v > 0 ? m / Math.sqrt(v) : -Infinity;
  };
  let bestScore = objective(best);

  // A fixed iteration count, matching the solvers in `portfolio-risk.ts` and
  // for the same reason: a convergence test lets two runs stop at different
  // points and disagree by more than the comparison can tolerate.
  let w = best.slice();
  for (let step = 0; step < 200; step++) {
    // Gradient of the Sharpe ratio, then projection back onto the long-only
    // simplex by clipping and renormalising. Crude, bounded, and it cannot
    // produce the leveraged short a closed-form solve happily would.
    let m = 0;
    for (let i = 0; i < n; i++) m += w[i] * mu[i];
    const sigmaW = w.map((_, i) => {
      let s = 0;
      for (let j = 0; j < n; j++) s += cov[i][j] * w[j];
      return s;
    });
    let v = 0;
    for (let i = 0; i < n; i++) v += w[i] * sigmaW[i];
    if (!(v > 0)) break;
    const sd = Math.sqrt(v);
    const grad = mu.map((mi, i) => (mi * sd - (m * sigmaW[i]) / sd) / v);

    const rate = 0.05 / (1 + step * 0.02);
    const next = w.map((wi, i) => Math.max(0, wi + rate * grad[i]));
    const total = next.reduce((a, b) => a + b, 0);
    if (!(total > 0)) break;
    w = next.map((x) => x / total);

    const score = objective(w);
    if (score > bestScore) { bestScore = score; best = w.slice(); }
  }

  const out: Record<string, number> = {};
  ids.forEach((id, i) => { out[id] = best[i]; });
  return out;
}

/** Every method offered, naive baseline first so the others have to beat it. */
export const FAVOURITE_METHODS = [
  "equal_weight", "inverse_vol", "equal_risk", "min_variance", "max_sharpe",
] as const;
export type FavouriteMethod = (typeof FAVOURITE_METHODS)[number];

/**
 * Fit weights on the first `HOLDOUT_SPLIT` of the overlap; measure on the rest.
 *
 * Returns null rather than a number when the overlap is too short — a covariance
 * estimated on forty bars across five strategies has more parameters than
 * observations, and the weights it produces are noise wearing a method name.
 */
export function combineFavourites(
  aligned: AlignedFavourites,
  method: FavouriteMethod,
  ann: number,
): CombinedResult | null {
  if (aligned.overlap < MIN_OVERLAP_BARS) return null;
  const split = Math.floor(aligned.overlap * HOLDOUT_SPLIT);
  if (split < 20 || aligned.overlap - split < 10) return null;

  let weights: Record<string, number> | null = null;
  if (method === "max_sharpe") {
    weights = maxSharpeWeights(aligned.ids, aligned.returns, 0, split);
  } else {
    // The existing solvers, keyed by run id instead of symbol. The mean-variance
    // maths is identical over any set of aligned return series; only the caller
    // changes, and generalising beats a second copy that drifts.
    const training: Record<string, number[]> = {};
    for (const id of aligned.ids) training[id] = aligned.returns[id].slice(0, split);
    const model = buildCovariance(aligned.ids, training);
    if (!model) return null;
    const proposal = proposeAllocation(
      aligned.ids.map((id) => ({ symbol: id, signedNotional: 1 })),
      model,
      method,
    );
    if (!proposal) return null;
    weights = Object.fromEntries(proposal.targets.map((t) => [t.symbol, t.targetWeight]));
  }
  if (!weights) return null;

  const inSample = weighted(aligned, weights, 0, split);
  const holdout = weighted(aligned, weights, split, aligned.overlap);

  // The comparison that decides whether combining was worth doing: the best
  // single favourite measured on the SAME holdout. A portfolio that loses to
  // one of its own members out of sample has added complexity and nothing else.
  const bestSingle = Math.max(
    ...aligned.ids.map((id) => sharpe(aligned.returns[id].slice(split, aligned.overlap), ann)),
  );
  const holdoutSharpe = sharpe(holdout, ann);

  return {
    method,
    weights,
    inSampleSharpe: sharpe(inSample, ann),
    holdoutSharpe,
    holdoutReturn: holdout.reduce((equity, r) => equity * (1 + r), 1) - 1,
    holdoutMaxDrawdown: drawdown(holdout),
    edgeOverBestSingle: holdoutSharpe - bestSingle,
  };
}
