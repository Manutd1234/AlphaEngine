/**
 * Research analytics — the part that debugs a failed strategy.
 * ============================================================
 *
 * `engine.ts` answers "what did this strategy do" and is pinned byte-for-byte
 * against the Python `NumpyEngine` by the parity fixture. Nothing here touches
 * it. This file answers the four questions a researcher asks *after* the verdict
 * comes back red, and every one of them is additive:
 *
 *   1. **Is the winner a plateau or a cliff?** A grid reports one champion. If
 *      its neighbours in parameter space collapse, the champion is a coordinate,
 *      not an edge — and the single reported Sharpe cannot show that.
 *   2. **Where did walk-forward break?** One aggregate OOS Sharpe says a strategy
 *      failed. It does not say whether it decayed steadily, died in one regime,
 *      or was never there — and those imply completely different next steps.
 *   3. **Is it alpha, or is it beta?** A long-only crypto strategy in a bull
 *      market earns a good Sharpe by holding the asset. Regressing against the
 *      asset itself is the cheapest way to find out, and it is the check that
 *      most often kills a "working" strategy.
 *   4. **What does the loss tail look like?** Sharpe divides by standard
 *      deviation, which treats a fat left tail as ordinary variance. VaR, CVaR
 *      and the monthly grid do not.
 *
 * ── On the factors ──────────────────────────────────────────────────────────
 * These are **time-series factors built from the same instrument**, not
 * Fama–French, not cross-sectional. One symbol's OHLCV cannot produce SMB, HML,
 * or a cross-sectional momentum decile, and constructing something that merely
 * resembles them from a single series would be the exact dishonesty the rest of
 * this codebase exists to prevent. What a single series *can* answer honestly is
 * "is this just the asset", "is this just trend-following", and "is this just a
 * volatility-regime bet" — so those are the three, named for what they are, with
 * their pairwise correlations reported so collinearity is visible rather than
 * hidden inside an inflated standard error.
 */

import { mean, normCdf, stdev } from "./stats";
import {
  BARS_PER_YEAR,
  type Bar,
  type CellKind,
  type FactorLoading,
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
} from "./types";

/**
 * Local copy of the engine's helper, so the dependency runs one way only.
 *
 * `engine.ts` imports the cost model from this file; if this file imported
 * anything back the two would form a cycle. ESM tolerates that for hoisted
 * function declarations and then breaks confusingly the first time someone adds
 * a module-level constant, so the one-line duplication is the cheaper trade.
 */
const barsPerYear = (interval: string) => BARS_PER_YEAR[interval] ?? 8760;

// --------------------------------------------------------------------------
// Ordinary least squares
// --------------------------------------------------------------------------

/**
 * Solve a symmetric positive-definite system and return the inverse too.
 *
 * Gauss–Jordan with partial pivoting on the augmented `[A | I]`. With three or
 * four regressors this is a handful of operations and needs no library; the
 * inverse is required anyway because the diagonal of `(XᵀX)⁻¹` is what turns a
 * coefficient into a t-statistic. Returns null on a singular system rather than
 * emitting Infinity — a perfectly collinear factor set is a modelling error, and
 * `NaN` propagating into a screen full of plausible-looking numbers is worse
 * than an honest gap.
 */
function invertAndSolve(
  A: number[][],
  b: number[],
): { x: number[]; inverse: number[][] } | null {
  const k = A.length;
  const m = A.map((row, i) => [...row, ...Array.from({ length: k }, (_, j) => (i === j ? 1 : 0))]);

  for (let col = 0; col < k; col++) {
    let pivot = col;
    for (let r = col + 1; r < k; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];

    const d = m[col][col];
    for (let j = 0; j < 2 * k; j++) m[col][j] /= d;

    for (let r = 0; r < k; r++) {
      if (r === col) continue;
      const factor = m[r][col];
      if (factor === 0) continue;
      for (let j = 0; j < 2 * k; j++) m[r][j] -= factor * m[col][j];
    }
  }

  const inverse = m.map((row) => row.slice(k));
  const x = inverse.map((row) => row.reduce((acc, v, j) => acc + v * b[j], 0));
  return { x, inverse };
}

function correlation(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  const den = Math.sqrt(da * db);
  return den > 0 ? num / den : 0;
}

/** Two-sided p-value from a t-statistic, via the normal approximation. */
function twoSidedP(t: number): number {
  return 2 * (1 - normCdf(Math.abs(t)));
}

/**
 * Regress `y` on `factors` with an intercept.
 *
 * **The t-statistics are plain OLS.** Strategy returns are heteroskedastic and
 * mildly autocorrelated, so a Newey–West correction would widen these standard
 * errors — meaning the significance reported here is, if anything, generous. It
 * is stated rather than silently assumed away, and it is the reason the UI
 * frames a significant alpha as "not explained by these three factors" rather
 * than as "real alpha".
 */
export function regress(
  y: ArrayLike<number>,
  factors: { name: string; values: ArrayLike<number> }[],
  ann: number,
): Regression | null {
  const n = y.length;
  const k = factors.length + 1;
  if (n <= k + 2) return null;

  // Design matrix with the intercept as column 0.
  const X: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = new Array<number>(k);
    row[0] = 1;
    for (let j = 0; j < factors.length; j++) row[j + 1] = factors[j].values[i];
    X[i] = row;
  }

  const XtX: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const Xty = new Array<number>(k).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < k; a++) {
      Xty[a] += X[i][a] * y[i];
      for (let b = a; b < k; b++) XtX[a][b] += X[i][a] * X[i][b];
    }
  }
  for (let a = 0; a < k; a++) for (let b = 0; b < a; b++) XtX[a][b] = XtX[b][a];

  const solved = invertAndSolve(XtX, Xty);
  if (!solved) return null;
  const { x: coef, inverse } = solved;

  let ssRes = 0;
  const my = mean(y);
  let ssTot = 0;
  const residuals = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let fit = 0;
    for (let a = 0; a < k; a++) fit += coef[a] * X[i][a];
    const e = y[i] - fit;
    residuals[i] = e;
    ssRes += e * e;
    ssTot += (y[i] - my) ** 2;
  }

  const dof = n - k;
  const sigma2 = ssRes / dof;
  const se = (a: number) => Math.sqrt(Math.max(0, sigma2 * inverse[a][a]));

  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  const alphaSe = se(0);
  const alphaT = alphaSe > 0 ? coef[0] / alphaSe : 0;
  const residualSd = stdev(residuals, 1);

  const collinearity: Regression["collinearity"] = [];
  for (let a = 0; a < factors.length; a++) {
    for (let b = a + 1; b < factors.length; b++) {
      collinearity.push({
        a: factors[a].name,
        b: factors[b].name,
        corr: correlation(factors[a].values, factors[b].values),
      });
    }
  }

  return {
    n,
    alpha: coef[0],
    alphaAnnualised: coef[0] * ann,
    alphaTStat: alphaT,
    alphaPValue: twoSidedP(alphaT),
    loadings: factors.map((f, j) => {
      const s = se(j + 1);
      const t = s > 0 ? coef[j + 1] / s : 0;
      return { name: f.name, beta: coef[j + 1], tStat: t, pValue: twoSidedP(t) };
    }),
    rSquared,
    adjRSquared: dof > 0 ? 1 - ((1 - rSquared) * (n - 1)) / dof : 0,
    idiosyncraticShare: 1 - Math.max(0, Math.min(1, rSquared)),
    // Annualised alpha over annualised residual vol. Residual vol rather than
    // total vol is the point: it is the risk actually taken *beyond* the factors.
    informationRatio: residualSd > 0 ? (coef[0] / residualSd) * Math.sqrt(ann) : 0,
    collinearity,
  };
}

// --------------------------------------------------------------------------
// Factor construction
// --------------------------------------------------------------------------

export interface FactorSet {
  names: string[];
  values: Float64Array[];
  /** Plain-language description of what each factor IS, shown in the UI. */
  descriptions: string[];
}

/** Lookback for the trend and volatility factors, in bars. */
export const FACTOR_LOOKBACK = 30;

/**
 * Three factors, all constructible from one instrument's bars.
 *
 * Executed with the same one-bar lag as the strategy itself. Regressing a
 * strategy that trades at t+1 against a factor that trades at t would credit the
 * factor with information the strategy never had, and the resulting beta would
 * be an artefact of the timing mismatch rather than a real exposure.
 */
export function buildFactors(pxRet: Float64Array, lookback = FACTOR_LOOKBACK): FactorSet {
  const n = pxRet.length;
  const market = new Float64Array(n);
  const trend = new Float64Array(n);
  const volatility = new Float64Array(n);

  // Trailing cumulative return and trailing realised vol, both known at t-1.
  const trailing = new Float64Array(n).fill(NaN);
  const vol = new Float64Array(n).fill(NaN);
  for (let i = lookback; i < n; i++) {
    let cum = 1;
    for (let j = i - lookback; j < i; j++) cum *= 1 + pxRet[j];
    trailing[i] = cum - 1;
    vol[i] = stdev(pxRet.subarray(i - lookback, i), 1);
  }

  /**
   * The "is volatility high" threshold, expanding rather than full-sample.
   *
   * Taking the median over the whole series would let the factor know, at bar
   * 100, what volatility is going to look like at bar 1900. That is look-ahead
   * — and it is the *insidious* direction of it: a benchmark built with hindsight
   * is stronger than one anybody could have traded, so the strategy's alpha
   * against it comes out too low and a real edge could be argued away by a
   * factor that could not have existed. An expanding mean of everything seen so
   * far is implementable in real time and costs one accumulator.
   */
  let volSum = 0;
  let volCount = 0;

  for (let i = 0; i < n; i++) {
    market[i] = pxRet[i];
    // Time-series momentum: long after an up window, short after a down one.
    // `trailing[i]` closes at i-1 and is multiplied by bar i's return, matching
    // the engine's own signal-at-t, execute-at-t+1 convention exactly.
    trend[i] = Number.isFinite(trailing[i]) ? Math.sign(trailing[i]) * pxRet[i] : 0;

    // Compared against the mean of every *earlier* observation, then folded in.
    // Order matters: including bar i's own volatility in its own threshold is a
    // one-observation leak, and a leak with a tidy explanation is still a leak.
    volatility[i] = Number.isFinite(vol[i]) && volCount > 0
      ? (vol[i] <= volSum / volCount ? pxRet[i] : -pxRet[i])
      : 0;
    if (Number.isFinite(vol[i])) {
      volSum += vol[i];
      volCount += 1;
    }
  }

  return {
    names: ["Market", "Trend (TSMOM)", "Volatility regime"],
    values: [market, trend, volatility],
    descriptions: [
      "Buy and hold the instrument. A high loading means the strategy is mostly directional exposure.",
      `Long after a positive trailing ${lookback}-bar return, short after a negative one. A high loading means the edge is generic trend-following.`,
      `Long while trailing ${lookback}-bar volatility is below its expanding average, short above. The threshold uses only prior bars, so the factor is implementable rather than built with hindsight.`,
    ],
  };
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// --------------------------------------------------------------------------
// Parameter stability
// --------------------------------------------------------------------------

/** Neighbour retention at or above this is a plateau. */
const PLATEAU_RETENTION = 0.6;
/** Retention at or below this is a cliff: the neighbours do not follow. */
const CLIFF_RETENTION = 0.2;

/**
 * Classify every grid point by what its neighbours do.
 *
 * Adjacency is in *grid index* space, not in raw parameter units, because the
 * grid is a sparse lattice: with `fastStep: 5` the neighbour of 25 is 20, and
 * measuring distance in parameter units would call 24 a neighbour when 24 was
 * never tested. Sorting the distinct values and stepping by index is the only
 * definition that matches what the sweep actually evaluated.
 */
export function parameterStability(results: ParamResult[]): StabilityReport {
  const fasts = [...new Set(results.map((r) => r.fast))].sort((a, b) => a - b);
  const slows = [...new Set(results.map((r) => r.slow))].sort((a, b) => a - b);
  const fastIndex = new Map(fasts.map((v, i) => [v, i]));
  const slowIndex = new Map(slows.map((v, i) => [v, i]));

  const grid = new Map<string, ParamResult>();
  for (const r of results) grid.set(`${fastIndex.get(r.fast)}:${slowIndex.get(r.slow)}`, r);

  const cells: StabilityCell[] = results.map((r) => {
    const fi = fastIndex.get(r.fast)!;
    const si = slowIndex.get(r.slow)!;
    const around: number[] = [];
    for (let df = -1; df <= 1; df++) {
      for (let ds = -1; ds <= 1; ds++) {
        if (df === 0 && ds === 0) continue;
        const hit = grid.get(`${fi + df}:${si + ds}`);
        if (hit) around.push(hit.sharpe);
      }
    }

    const neighbourMean = around.length ? mean(around) : 0;
    const neighbourMin = around.length ? Math.min(...around) : 0;
    const retention = r.sharpe > 0 && around.length ? neighbourMean / r.sharpe : null;

    let kind: CellKind;
    if (around.length < 3) kind = "isolated";
    else if (r.sharpe <= 0) kind = "dead";
    else if (retention === null) kind = "isolated";
    else if (retention >= PLATEAU_RETENTION) kind = "plateau";
    else if (retention <= CLIFF_RETENTION) kind = "cliff";
    else kind = "slope";

    return {
      fast: r.fast,
      slow: r.slow,
      sharpe: r.sharpe,
      neighbours: around.length,
      neighbourMean,
      neighbourMin,
      retention,
      kind,
    };
  });

  let best: StabilityCell | null = null;
  for (const cell of cells) if (!best || cell.sharpe > best.sharpe) best = cell;

  const plateauCount = cells.filter((c) => c.kind === "plateau").length;
  const cliffCount = cells.filter((c) => c.kind === "cliff").length;
  const classified = cells.filter((c) => c.kind !== "isolated").length;

  return { cells, best, plateauCount, cliffCount, classified, verdict: stabilityVerdict(best) };
}

function stabilityVerdict(best: StabilityCell | null): Verdict {
  if (!best) {
    return { level: "fail", headline: "No grid to assess", detail: "The sweep produced no results." };
  }
  if (best.sharpe <= 0) {
    return {
      level: "fail",
      headline: "The best cell is not profitable",
      detail:
        "The highest Sharpe in the grid is at or below zero, so there is no neighbourhood to assess. "
        + "Parameter stability is a question you only get to ask about something that worked.",
    };
  }
  if (best.kind === "isolated") {
    return {
      level: "marginal",
      headline: "The winner sits on the grid edge",
      detail:
        "Fewer than three tested neighbours surround the best combination, so its robustness cannot be judged. "
        + "Widen the search range so the winner is interior — an optimum at the boundary is usually a sign the "
        + "true optimum is outside the grid.",
    };
  }
  const around = describeNeighbourhood(best);
  if (best.kind === "cliff") {
    return {
      level: "fail",
      headline: "The winner is a cliff, not a plateau",
      detail:
        `${around} A real edge degrades smoothly as parameters move; an isolated spike that collapses one `
        + "grid step away is a coordinate the search found in noise, and it will not survive live.",
    };
  }
  if (best.kind === "plateau") {
    return {
      level: "pass",
      headline: "The winner sits on a plateau",
      detail:
        `${around} The result does not depend on hitting one exact coordinate, which is what a robust `
        + "parameterisation looks like — necessary, not sufficient.",
    };
  }
  return {
    level: "marginal",
    headline: "The winner sits on a slope",
    detail:
      `${around} Degrading, but not collapsing — treat the reported parameters as the top of a ridge `
      + "rather than a stable operating point.",
  };
}

/**
 * Describe the neighbourhood without letting a ratio explode.
 *
 * `retention` is `neighbourMean / sharpe`, and the denominator is a Sharpe that
 * can be a hair above zero — a winner at 0.006 with negative neighbours yields
 * −8268%, which is arithmetically correct and communicates nothing. Whenever the
 * ratio leaves the band where a percentage means something, the two Sharpes are
 * quoted directly instead. Percentages are a convenience, not the measurement.
 */
export function describeNeighbourhood(cell: StabilityCell): string {
  const own = cell.sharpe.toFixed(2);
  const mean_ = cell.neighbourMean.toFixed(2);
  const retention = cell.retention;
  if (retention === null || retention < 0 || retention > 2) {
    return (
      `The winner's Sharpe is ${own}; its ${cell.neighbours} tested neighbours average ${mean_}.`
    );
  }
  return (
    `Neighbouring combinations retain ${Math.round(retention * 100)}% of the winner's Sharpe on average `
    + `(${mean_} against ${own}).`
  );
}

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

// --------------------------------------------------------------------------
// Cost model
// --------------------------------------------------------------------------

export interface CostModel {
  /** Flat exchange fee, basis points of traded notional. */
  feeBps: number;
  /** Flat slippage, basis points of traded notional. */
  slippageBps: number;
  /**
   * Square-root market-impact coefficient.
   *
   * `impact_bps = coefficient × 10⁴ × √(orderNotional / ADV)`. Zero disables it,
   * which is the default — so an unconfigured run produces exactly the numbers
   * the parity fixture pins.
   */
  impactCoefficient: number;
  /** Order notional used to size market impact, in quote currency. */
  orderNotional: number;
  /** Perpetual funding, bps per 8h, charged on absolute exposure. */
  fundingBpsPer8h: number;
  /** Annual borrow cost on short exposure, in bps. */
  borrowBpsAnnual: number;
}

export const NO_FRICTIONS: Pick<
  CostModel,
  "impactCoefficient" | "orderNotional" | "fundingBpsPer8h" | "borrowBpsAnnual"
> = {
  impactCoefficient: 0,
  orderNotional: 0,
  fundingBpsPer8h: 0,
  borrowBpsAnnual: 0,
};

/** Hours represented by one bar, for converting a funding rate to a per-bar drag. */
export const HOURS_PER_BAR: Record<string, number> = {
  "1m": 1 / 60, "5m": 1 / 12, "15m": 0.25, "30m": 0.5,
  "1h": 1, "2h": 2, "4h": 4, "1d": 24, "1w": 168,
};

export function hoursPerBar(interval: string): number {
  return HOURS_PER_BAR[interval] ?? 8760 / (barsPerYear(interval) || 8760);
}

/**
 * Per-unit-turnover cost in fractional terms, including square-root impact.
 *
 * The impact law is `k·√(Q/ADV)`, the standard concave form: doubling order size
 * costs about 1.41×, not 2×, because a larger order is worked over more of the
 * book. It is a *model*, not a measurement — the UI says so, because a slippage
 * figure a researcher chose is an assumption they are making, not a fact the
 * backtest discovered.
 */
export function turnoverCost(model: CostModel, adv: number): number {
  const flat = (model.feeBps + model.slippageBps) / 1e4;
  if (model.impactCoefficient <= 0 || model.orderNotional <= 0 || adv <= 0) return flat;
  const participation = Math.min(1, model.orderNotional / adv);
  return flat + model.impactCoefficient * Math.sqrt(participation);
}

/** Per-bar holding cost as a fraction of equity, for a given signed position. */
export function holdingCost(model: CostModel, position: number, interval: string): number {
  if (position === 0) return 0;
  const hours = hoursPerBar(interval);
  const funding = (model.fundingBpsPer8h / 1e4) * (hours / 8) * Math.abs(position);
  const borrow = position < 0
    ? (model.borrowBpsAnnual / 1e4) * (hours / 8760) * Math.abs(position)
    : 0;
  return funding + borrow;
}

/** Average daily volume in quote currency, from the bar series. */
export function averageDailyVolume(bars: Bar[], interval: string): number {
  if (!bars.length) return 0;
  const barsPerDay = 24 / hoursPerBar(interval);
  let quoteVolume = 0;
  for (const bar of bars) quoteVolume += bar.v * bar.c;
  return (quoteVolume / bars.length) * barsPerDay;
}

// --------------------------------------------------------------------------
// Promotion gate
// --------------------------------------------------------------------------

/**
 * The gates a candidate must clear before it may be handed to execution.
 *
 * Every one is a *veto*, and they are shown whether they pass or fail. A gate
 * panel that only appears on success teaches people that the absence of a
 * warning means safety; showing the full vector every time makes the one red row
 * the thing you read.
 */
export function promotionGate(input: {
  deflatedSharpe: number;
  walkForwardOosSharpe: number | null;
  medianEfficiency: number | null;
  stability: CellKind | null;
  alphaTStat: number | null;
  maxDrawdown: number;
  trades: number;
}): PromotionGate {
  const checks: PromotionCheck[] = [
    {
      id: "dsr",
      label: "Deflated Sharpe",
      value: input.deflatedSharpe.toFixed(3),
      hurdle: "≥ 0.95",
      passed: input.deflatedSharpe >= 0.95,
      why: "Prices the search itself: the probability the edge is real after paying for how many combinations were tried.",
    },
    {
      id: "oos",
      label: "Walk-forward OOS Sharpe",
      value: input.walkForwardOosSharpe === null ? "—" : input.walkForwardOosSharpe.toFixed(2),
      hurdle: "> 0",
      passed: (input.walkForwardOosSharpe ?? -1) > 0,
      why: "Measured on data the parameters never saw. In-sample results are a fit; this is a test.",
    },
    {
      id: "wfe",
      label: "Walk-forward efficiency",
      value: input.medianEfficiency === null ? "—" : input.medianEfficiency.toFixed(2),
      hurdle: "≥ 0.5",
      passed: (input.medianEfficiency ?? -1) >= 0.5,
      why: "How much of the in-sample edge survives out-of-sample. Below half means the backtest is mostly fitting.",
    },
    {
      id: "stability",
      label: "Parameter neighbourhood",
      value: input.stability ?? "—",
      hurdle: "plateau or slope",
      passed: input.stability === "plateau" || input.stability === "slope",
      why: "A real edge degrades smoothly as parameters move. An isolated spike is a coordinate found in noise.",
    },
    {
      id: "alpha",
      label: "Alpha t-statistic",
      value: input.alphaTStat === null ? "—" : input.alphaTStat.toFixed(2),
      hurdle: "|t| ≥ 2",
      passed: Math.abs(input.alphaTStat ?? 0) >= 2,
      why: "Return not explained by market, trend or volatility exposure — otherwise it is a factor bet in disguise.",
    },
    {
      id: "sample",
      label: "Trade count",
      value: String(input.trades),
      hurdle: "≥ 30",
      passed: input.trades >= 30,
      why: "Below about thirty trades the Sharpe is dominated by a handful of outcomes and its confidence interval spans zero.",
    },
  ];

  const passed = checks.filter((c) => c.passed).length;
  return { checks, passed, total: checks.length, eligible: passed === checks.length };
}

// ---------------------------------------------------------------------------
// Position sizing
//
// The research surface answers "does this work". It has never answered "how
// much", and that is not the smaller question — a genuine edge sized at full
// Kelly still ruins the book. Mirrors `quant_risk.kelly_fraction` in the Python
// gateway so a fraction quoted in Telegram and a fraction shown on this tab
// cannot disagree.
// ---------------------------------------------------------------------------

/** No single strategy takes more than a fifth of the book, whatever Kelly says. */
export const MAX_STRATEGY_FRACTION = 0.2;

/** The default fraction of full Kelly. See the argument in `kellySizing`. */
export const DEFAULT_KELLY_FRACTION = 0.25;

export interface KellySizing {
  /** `f* = W − (1−W)/R`. Negative means no edge at these odds. */
  fullKelly: number;
  /** The multiplier applied to `fullKelly` — 0.25 by default. */
  fractionUsed: number;
  /** What the fraction would allocate before the ceiling is applied. */
  uncappedFraction: number;
  /** What to actually allocate, after flooring at zero and capping. */
  recommendedFraction: number;
  recommendedNotional: number;
  /** The ceiling that was in force, so a capped number is never anonymous. */
  maxFraction: number;
  winRate: number;
  /** Average win over average loss. 0 when either is unmeasurable. */
  payoffRatio: number;
  /** Expected return per trade in units of the average loss. */
  edgePerTrade: number;
  cappedBy: "no_edge" | "max_fraction" | null;
  /**
   * True when the payoff ratio came from too few trades to mean much.
   *
   * Not cosmetic. On live BTC/4h at the defaults, `ma_cross` produced a 17.7%
   * allocation — $1.77M of a $10M book — from **six** trades. The formula is
   * indifferent to whether R came from six samples or six hundred; the
   * consequence of being wrong is not, because Kelly punishes over-betting
   * super-linearly. The estimate is still shown, and it is labelled.
   */
  thinSample: boolean;
}

/** Same hurdle the promotion gate uses, so one number does not mean two things. */
export const MIN_TRADES_FOR_SIZING = 30;

/**
 * Kelly sizing from a sweep's own realised trades.
 *
 * The payoff ratio comes from `avgWin`/`avgLoss`, which the engine accumulates
 * per trade. It cannot be recovered from the summary statistics afterwards: a
 * win rate and a total return leave the split between win size and loss size
 * underdetermined, and guessing it would be a fabricated input to a formula
 * whose entire output is a position size.
 *
 * Three deliberate refusals:
 *
 *  - A strategy with no losing trades has an *undefined* payoff ratio, not an
 *    infinite one. Treating it as infinite drives Kelly to the win rate itself
 *    and would size a small, lucky sample at maximum. It returns zero.
 *  - A negative `f*` returns zero rather than an inverted position.
 *  - The result is capped, and `cappedBy` says so, because a fraction that
 *    silently stopped growing reads as a recommendation rather than a limit.
 */
export function kellySizing(input: {
  winRate: number;
  avgWin: number;
  avgLoss: number;
  equity: number;
  /** Sample the odds were measured on. Omitted means "unknown", not "enough". */
  trades?: number;
  fraction?: number;
  maxFraction?: number;
}): KellySizing {
  const fraction = input.fraction ?? DEFAULT_KELLY_FRACTION;
  const maxFraction = input.maxFraction ?? MAX_STRATEGY_FRACTION;
  const winRate = Math.min(Math.max(input.winRate, 0), 1);

  // avgLoss is carried as a positive magnitude; a zero means either no losing
  // trades or no trades at all, and neither supports a ratio.
  const payoffRatio =
    input.avgLoss > 0 && input.avgWin > 0 ? input.avgWin / input.avgLoss : 0;

  const fullKelly = payoffRatio > 0 ? winRate - (1 - winRate) / payoffRatio : 0;
  const edgePerTrade = winRate * payoffRatio - (1 - winRate);

  const uncappedFraction = Math.max(0, fullKelly) * fraction;

  let cappedBy: KellySizing["cappedBy"] = null;
  let recommendedFraction = uncappedFraction;
  if (fullKelly <= 0) {
    cappedBy = "no_edge";
    recommendedFraction = 0;
  } else if (uncappedFraction > maxFraction) {
    cappedBy = "max_fraction";
    recommendedFraction = maxFraction;
  }

  return {
    fullKelly,
    fractionUsed: fraction,
    uncappedFraction,
    recommendedFraction,
    recommendedNotional: recommendedFraction * Math.max(0, input.equity),
    maxFraction,
    winRate,
    payoffRatio,
    edgePerTrade,
    cappedBy,
    thinSample: (input.trades ?? 0) < MIN_TRADES_FOR_SIZING,
  };
}
