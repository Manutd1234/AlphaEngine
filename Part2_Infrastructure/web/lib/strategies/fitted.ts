/**
 * The fitted family: ordinary least squares on features the bar already knows.
 *
 * One strategy, and it is different in kind from the other forty-five rather
 * than one more row in the same table — which is why it has a module to itself
 * and a family of its own in the picker.
 */

import { sma } from "../indicators";
import type { RuleSet } from "./types";

/**
 * The one strategy in this catalogue whose parameters are not chosen by the
 * user.
 *
 * Every other model here is parametric: a lookback and a threshold, applied
 * unchanged to every bar. This one estimates its coefficients from the data,
 * which makes it different IN KIND rather than one more row in the same table —
 * and the difference is exactly where a reader is most likely to be misled, so
 * `fast` and `slow` still control the fit (window length, entry threshold)
 * while the coefficients themselves are never exposed as sliders.
 *
 * NO LOOK-AHEAD, AND THE PROOF IS IN THE INDEX ARITHMETIC
 *
 * The target for row j is the return from bar j to bar j+1, so a row is only
 * usable once bar j+1 has closed. The refit at bar i uses rows j <= i-1, whose
 * targets need closes up to bar i — all of which have happened. The prediction
 * at bar i then uses features from bar i, and the engine executes it at i+1
 * like every other signal. `tests/engine-linreg.test.ts` pins this by feeding a
 * series whose future is unknowable and asserting the fit cannot see it.
 *
 * WHY THE REFIT IS PERIODIC AND NOT PER-BAR
 *
 * A coefficient set that changes every bar is fitting the last observation.
 * Refitting every 20 bars keeps the estimate responsive to a regime change
 * within roughly a month of daily data while leaving each fit something to
 * average over. The cadence is fixed rather than swept because a third axis for
 * it would multiply every grid without telling anyone anything they could act
 * on — the same reasoning that fixes MACD's signal span at 9.
 */
const LINREG_REFIT_EVERY = 20;
/** Intercept + three features. Named so the degrees-of-freedom maths is legible. */
const LINREG_COLS = 4;
/** Below this many usable rows the fit is memorising, not estimating. */
const LINREG_MIN_ROWS = 30;
/** First bar at which all three features have a value. */
const LINREG_WARMUP = 20;

/**
 * Solve a small symmetric system by Gaussian elimination with partial pivoting.
 *
 * Written out rather than delegated because `_linreg_forecast` in
 * `modules/backtester/indicators.py` runs the identical loop in the identical
 * order. A library solve on either side — numpy on one, a hand-rolled inverse
 * on the other — would agree to about eight digits, and eight digits is enough
 * for the two engines to disagree about whether a prediction cleared its
 * threshold, which is a different trade count and a failed parity test that
 * looks like a modelling bug.
 *
 * Returns null on a singular system, which is the honest answer for a
 * degenerate feature set and leaves the strategy flat rather than trading on a
 * fabricated coefficient.
 */
function solveSmall(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (!(Math.abs(a[pivot][col]) > 1e-12)) return null;
    if (pivot !== col) {
      const swap = a[pivot]; a[pivot] = a[col]; a[col] = swap;
      const tmp = b[pivot]; b[pivot] = b[col]; b[col] = tmp;
    }
    for (let row = col + 1; row < n; row++) {
      const factor = a[row][col] / a[col][col];
      if (factor === 0) continue;
      for (let k = col; k < n; k++) a[row][k] -= factor * a[col][k];
      b[row] -= factor * b[col];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = b[row];
    for (let k = row + 1; k < n; k++) sum -= a[row][k] * x[k];
    x[row] = sum / a[row][row];
  }
  return x.every((v) => Number.isFinite(v)) ? x : null;
}

function linregForecast(close: Float64Array, window: number, thresholdSd: number): Uint8Array {
  const n = close.length;
  const out = new Uint8Array(n);
  const trainRows = Math.max(LINREG_MIN_ROWS, Math.round(window));

  // Features, all known at the bar they are indexed by.
  const feat: Float64Array[] = [
    new Float64Array(n), new Float64Array(n), new Float64Array(n), new Float64Array(n),
  ];
  const mean20 = sma(close, LINREG_WARMUP);
  for (let i = 0; i < n; i++) {
    feat[0][i] = 1;
    feat[1][i] = i >= 1 && close[i - 1] !== 0 ? close[i] / close[i - 1] - 1 : NaN;
    feat[2][i] = i >= 5 && close[i - 5] !== 0 ? close[i] / close[i - 5] - 1 : NaN;
    feat[3][i] = mean20[i] > 0 ? (close[i] - mean20[i]) / mean20[i] : NaN;
  }
  const target = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    target[i] = i + 1 < n && close[i] !== 0 ? close[i + 1] / close[i] - 1 : NaN;
  }

  const usable = (j: number) =>
    Number.isFinite(feat[1][j]) && Number.isFinite(feat[2][j])
    && Number.isFinite(feat[3][j]) && Number.isFinite(target[j]);

  let coef: number[] | null = null;
  let residSd = 0;
  let state = 0;

  for (let i = 0; i < n; i++) {
    const sinceWarmup = i - LINREG_WARMUP;
    if (sinceWarmup >= 0 && sinceWarmup % LINREG_REFIT_EVERY === 0) {
      // Rows j <= i-1 only: row j's target needs close[j+1], which is close[i]
      // at the newest usable row. Nothing here has not already happened.
      const first = Math.max(0, i - trainRows);
      const xtx: number[][] = [];
      for (let r = 0; r < LINREG_COLS; r++) xtx.push(new Array<number>(LINREG_COLS).fill(0));
      const xty = new Array<number>(LINREG_COLS).fill(0);
      let yy = 0;
      let rows = 0;
      // Ascending order, accumulated one row at a time. The Python reference
      // walks the same indices in the same direction so the float sums match.
      for (let j = first; j <= i - 1; j++) {
        if (!usable(j)) continue;
        rows++;
        const y = target[j];
        yy += y * y;
        for (let r = 0; r < LINREG_COLS; r++) {
          const fr = feat[r][j];
          xty[r] += fr * y;
          for (let c = r; c < LINREG_COLS; c++) xtx[r][c] += fr * feat[c][j];
        }
      }
      if (rows >= LINREG_MIN_ROWS) {
        for (let r = 0; r < LINREG_COLS; r++) for (let c = 0; c < r; c++) xtx[r][c] = xtx[c][r];
        const solved = solveSmall(xtx.map((row) => row.slice()), xty.slice());
        if (solved) {
          let explained = 0;
          for (let r = 0; r < LINREG_COLS; r++) explained += solved[r] * xty[r];
          const dof = Math.max(1, rows - LINREG_COLS);
          coef = solved;
          residSd = Math.sqrt(Math.max(0, yy - explained) / dof);
        }
      }
    }

    if (coef && Number.isFinite(feat[1][i]) && Number.isFinite(feat[2][i]) && Number.isFinite(feat[3][i])) {
      let pred = 0;
      for (let r = 0; r < LINREG_COLS; r++) pred += coef[r] * feat[r][i];
      if (pred > thresholdSd * residSd) state = 1;
      if (pred < 0) state = 0; // exit overrides, as everywhere else in this file
    }
    out[i] = state;
  }
  return out;
}

export const FITTED_RULES = {
  linreg_forecast: ({ close }, fast, slow, out) => {
    return linregForecast(close, fast, slow);
  },
} satisfies RuleSet;
