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
