/**
 * Multiple-testing statistics.
 * =============================
 *
 * Direct port of `Part2_Infrastructure/modules/backtester.py` so the Vercel
 * portal and the Python gateway cannot disagree about whether a strategy works.
 *
 * The point of this file: the best Sharpe in a grid of N is a *maximum of N
 * draws*, not an estimate of edge. A sweep over a pure random walk reliably
 * produces an impressive-looking winner. Everything here exists to price that.
 */

const SQRT2 = Math.SQRT2;

/** Abramowitz & Stegun 7.1.26 — |error| < 1.5e-7, ample for a CDF. */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

export function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / SQRT2));
}

/** Acklam's inverse normal CDF — |error| < 1.15e-9. */
export function normPpf(p: number): number {
  const pp = Math.min(Math.max(p, 1e-12), 1 - 1e-12);
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];
  const plow = 0.02425;

  if (pp < plow) {
    const q = Math.sqrt(-2 * Math.log(pp));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (pp > 1 - plow) {
    const q = Math.sqrt(-2 * Math.log(1 - pp));
    return (
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  const q = pp - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

export function mean(xs: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i];
  return xs.length ? s / xs.length : 0;
}

export function stdev(xs: ArrayLike<number>, ddof = 1): number {
  const n = xs.length;
  if (n - ddof <= 0) return 0;
  const m = mean(xs);
  let s = 0;
  for (let i = 0; i < n; i++) s += (xs[i] - m) ** 2;
  return Math.sqrt(s / (n - ddof));
}

export function skewness(xs: ArrayLike<number>): number {
  const n = xs.length;
  if (n < 3) return 0;
  const m = mean(xs);
  const sd = stdev(xs, 1);
  if (sd === 0) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += ((xs[i] - m) / sd) ** 3;
  return (n / ((n - 1) * (n - 2))) * s;
}

/** Excess kurtosis + 3 => the raw (Pearson) kurtosis the PSR formula wants. */
export function kurtosis(xs: ArrayLike<number>): number {
  const n = xs.length;
  if (n < 4) return 3;
  const m = mean(xs);
  const sd = stdev(xs, 1);
  if (sd === 0) return 3;
  let s = 0;
  for (let i = 0; i < n; i++) s += ((xs[i] - m) / sd) ** 4;
  const g2 =
    ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * s -
    (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
  return g2 + 3;
}

/**
 * Probabilistic Sharpe Ratio — P(true SR > benchmark) from a finite, non-normal
 * sample. `sr` and `srBenchmark` are per-observation, NOT annualised.
 */
export function probabilisticSharpe(
  sr: number,
  srBenchmark: number,
  n: number,
  skew: number,
  kurt: number,
): number {
  if (n < 3) return 0;
  const denom = Math.sqrt(
    Math.max(1e-12, 1 - skew * sr + ((kurt - 1) / 4) * sr * sr),
  );
  return normCdf(((sr - srBenchmark) * Math.sqrt(n - 1)) / denom);
}

/**
 * Minimum Track Record Length (Bailey & López de Prado).
 *
 *   N* = 1 + (1 − γ₃·S + (γ₄−1)/4·S²) · (Z_conf / (S − S*))²
 *
 * The exact inverse of `probabilisticSharpe` solved for n: the observation
 * count at which PSR(S*) reaches `confidence`. Inputs are per-observation, NOT
 * annualised, and `kurt` is raw Pearson kurtosis (normal = 3) — same
 * conventions as `probabilisticSharpe`, including the 1e-12 variance clamp so
 * the two stay exact inverses under extreme skew.
 *
 * Returns fractional bars; `Infinity` when S ≤ S* (no finite record can prove
 * an edge that isn't there).
 */
export function minTrackRecordLength(
  srPerBar: number,
  srBenchmarkPerBar: number,
  skew: number,
  kurt: number,
  confidence = 0.95,
): number {
  if (srPerBar <= srBenchmarkPerBar) return Infinity;
  const z = normPpf(confidence);
  const varTerm = Math.max(
    1e-12,
    1 - skew * srPerBar + ((kurt - 1) / 4) * srPerBar * srPerBar,
  );
  return 1 + varTerm * (z / (srPerBar - srBenchmarkPerBar)) ** 2;
}

const EULER_MASCHERONI = 0.5772156649015329;

/**
 * Deflated Sharpe Ratio (Bailey & López de Prado 2014).
 *
 *   SR*₀ = √V[{SRₙ}] · [ (1−γ)·Z⁻¹(1 − 1/N) + γ·Z⁻¹(1 − 1/(N·e)) ]
 *
 * Under the null every trial's true Sharpe is zero, so the hurdle comes purely
 * from the *dispersion* of the search. Adding the sample mean back — a common
 * slip — makes the hurdle negative on a uniformly-losing grid, which would let a
 * losing strategy clear it.
 */
export function deflatedSharpe(
  candidateSharpes: number[],
  selectedSharpe: number,
  nObs: number,
  skew: number,
  kurt: number,
): { dsr: number; psr: number; expectedMax: number } {
  const nTrials = Math.max(1, candidateSharpes.length);
  const sd = nTrials > 1 ? stdev(candidateSharpes, 1) : 0;

  let expectedMax = 0;
  if (nTrials > 1 && sd > 0) {
    expectedMax =
      sd *
      ((1 - EULER_MASCHERONI) * normPpf(1 - 1 / nTrials) +
        EULER_MASCHERONI * normPpf(1 - 1 / (nTrials * Math.E)));
  }

  return {
    dsr: probabilisticSharpe(selectedSharpe, expectedMax, nObs, skew, kurt),
    psr: probabilisticSharpe(selectedSharpe, 0, nObs, skew, kurt),
    expectedMax,
  };
}

/**
 * Uniform-width binning for a distribution chart.
 *
 * `edges.length === counts.length + 1`, with the last bin closed on the right
 * so the maximum lands inside it. Returns null when nothing finite survives —
 * absence must be unrepresentable as an empty chart. A degenerate range (every
 * value identical) yields one bin: widening it artificially would draw a
 * spread the data does not have.
 */
export function histogramBins(
  values: number[],
  binCount = 10,
): { edges: number[]; counts: number[] } | null {
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) return null;
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  if (hi === lo) return { edges: [lo, hi], counts: [finite.length] };

  const bins = Math.max(1, Math.floor(binCount));
  const width = (hi - lo) / bins;
  const edges = Array.from({ length: bins + 1 }, (_, i) => lo + i * width);
  const counts = new Array<number>(bins).fill(0);
  for (const v of finite) {
    const idx = Math.min(bins - 1, Math.floor((v - lo) / width));
    counts[idx] += 1;
  }
  return { edges, counts };
}

export function verdictFor(
  dsr: number,
  oosSharpe: number | null,
): { level: "pass" | "marginal" | "fail"; headline: string; detail: string } {
  const oosBad = oosSharpe !== null && oosSharpe <= 0;

  if (dsr >= 0.95 && !oosBad) {
    return {
      level: "pass",
      headline: "The edge survives the search",
      detail:
        "The winning parameters clear the multiple-testing hurdle (DSR ≥ 0.95) and hold up out-of-sample. " +
        "This is the rare case where the backtest is evidence rather than a coincidence.",
    };
  }
  if (dsr >= 0.8 && !oosBad) {
    return {
      level: "marginal",
      headline: "Plausible, not established",
      detail:
        "The result is better than the search alone would produce, but not decisively. " +
        "More data or a smaller parameter grid would be needed before sizing this.",
    };
  }
  if (oosBad && dsr >= 0.8) {
    return {
      level: "fail",
      headline: "In-sample only — it does not generalise",
      detail:
        "The in-sample numbers look acceptable but walk-forward out-of-sample Sharpe is not positive. " +
        "Parameters chosen on one period stop working on the next: that is overfitting, not edge.",
    };
  }
  return {
    level: "fail",
    headline: "Consistent with selection bias",
    detail:
      "The winning Sharpe is no better than what searching this many parameter combinations would produce " +
      "from noise. Do not allocate to it.",
  };
}
