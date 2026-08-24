/**
 * The diffusion estimator, in the browser. Python remains the reference.
 *
 * Ported from `modules/coherence/diffusion/` — `decay.py` for the crossing and
 * the two fits, `gaussian.py` and `sampler.py` for the closed-form information
 * spectrum. It exists so the Diffusion tab can let a reader WORK the estimator
 * rather than only read its output: set an absorbed curve and watch where the
 * half-life lands, push the noise up until the gate refuses, move the
 * eigenvalues and watch the spectrum's mass slide along the resolution axis.
 * A round trip per keystroke would make all three unusable.
 *
 * `tests/diffusion-model-parity.test.ts` holds every function here to answers
 * `tools/export_diffusion_parity.py` writes from the reference. The house rule
 * (CLAUDE.md) is that a formula changed on one side makes the other side fail,
 * so regenerate the fixture deliberately rather than loosening the tolerance.
 *
 * THREE THINGS ARE PORTED EXACTLY, AND EACH HAD A TEMPTING WRONG VERSION.
 *
 * **The crossing is interpolated in LOG x.** The horizon grid is roughly
 * geometric — 1m, 2m, 5m, 10m, 15m, 30m — so a linear reading between 15m and
 * 30m places the crossing at the arithmetic midpoint of a cell that spans a
 * doubling. Snapping to the later horizon instead, the other obvious choice,
 * quantises every half-life onto the grid and makes the distribution a picture
 * of the sampler rather than of the market.
 *
 * **The fits are selected in u-SPACE**, where `u = 1 - absorbed` is the unpriced
 * fraction. Fitting `log(u - u_inf)` and then choosing `u_inf` by the residual
 * of THAT regression is the trap `decay.py` names: the log compresses the
 * residual range as `u_inf` rises, so the search walks the asymptote up until
 * the fit looks good. The linearisation is still used to get `tau` in closed
 * form; the SELECTION is on the sum of squares of what was actually asked.
 *
 * **The absorbed fraction is never clipped.** A path that overshoots and comes
 * back has `absorbed > 1` somewhere, and that is a real thing markets do.
 * Clipping to [0, 1] would turn every overshoot into "fully absorbed early" and
 * make the half-life shorter than it was.
 *
 * AND ONE THING THE SPECTRUM MUST NOT DO: whiten. Whitening sends every
 * `log lambda_i` to zero, which collapses the spectrum to a single bump at
 * `alpha = 0` and destroys the resolution axis the whole instrument reads. It is
 * the natural thing to reach for and it deletes the measurement.
 */

/** Where the crossing is, or the reason there is not one. */
export type HalfLifeState = "ok" | "at_or_before_first" | "never_reached" | "too_few_points";

export interface HalfLife {
  state: HalfLifeState;
  /** The crossing, in whatever clock `x` was measured in. Null unless `ok`. */
  value: number | null;
  /** The two grid points it sits between, for a reader asking how much of the
   *  number is interpolation. */
  lower: number | null;
  upper: number | null;
  reason: string | null;
}

export type FitModel = "exponential" | "power" | "none";

export interface DecayFit {
  model: FitModel;
  halfLife: number | null;
  /** Where the exponential says the unpriced fraction settles. Null for power. */
  terminalUnpricedFraction: number | null;
  /** Sum of squares in u-space, so the two models are comparable. */
  sse: number | null;
  nPoints: number;
  /** How many horizons overshot — `absorbed > 1`. Counted, never clipped. */
  overshootPoints: number;
  reason: string | null;
}

/** Finite pairs with a positive clock, sorted by x. The reference drops the rest. */
function usable(xs: readonly number[], ys: readonly number[]): Array<[number, number]> {
  const rows: Array<[number, number]> = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i += 1) {
    const x = xs[i];
    const y = ys[i];
    if (Number.isFinite(x) && Number.isFinite(y) && x > 0) rows.push([x, y]);
  }
  return rows.sort((a, b) => a[0] - b[0]);
}

/**
 * Where `absorbed` first reaches `level`, interpolated in log-x.
 *
 * `x` is whatever clock the caller is measuring in — seconds for the wall clock,
 * accumulated control variance for the volatility clock. The function does not
 * care, which is the point: the two are the same arithmetic on two different
 * axes and must not drift apart in two implementations.
 */
export function halfLife(
  xs: readonly number[],
  absorbed: readonly number[],
  level = 0.5,
): HalfLife {
  const rows = usable(xs, absorbed);
  if (rows.length < 2) {
    return {
      state: "too_few_points", value: null, lower: null, upper: null,
      reason: `${rows.length} measured horizons is not a curve`,
    };
  }
  if (rows[0][1] >= level) {
    return {
      state: "at_or_before_first", value: rows[0][0], lower: null, upper: rows[0][0],
      reason: "the first measured horizon was already past the level, "
        + "so the crossing is not resolved by this grid",
    };
  }
  const index = rows.findIndex(([, value]) => value >= level);
  if (index === -1) {
    return {
      state: "never_reached", value: null, lower: rows[rows.length - 1][0], upper: null,
      reason: `the path never reached ${level} of its terminal move inside the window`,
    };
  }
  const [lowX, lowValue] = rows[index - 1];
  const [highX, highValue] = rows[index];
  // A flat pair across the crossing has no interpolant, so the reference takes
  // the later horizon rather than dividing by zero or inventing a midpoint.
  if (highValue === lowValue) {
    return { state: "ok", value: highX, lower: lowX, upper: highX, reason: null };
  }
  const weight = (level - lowValue) / (highValue - lowValue);
  const value = Math.exp(Math.log(lowX) + weight * (Math.log(highX) - Math.log(lowX)));
  return { state: "ok", value, lower: lowX, upper: highX, reason: null };
}

/** Slope and intercept of `y = slope*x + intercept`, least squares over two parameters. */
function leastSquares(xs: readonly number[], ys: readonly number[]): [number, number] {
  const n = xs.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i += 1) {
    sumX += xs[i];
    sumY += ys[i];
    sumXY += xs[i] * ys[i];
    sumXX += xs[i] * xs[i];
  }
  const denominator = n * sumXX - sumX * sumX;
  const slope = denominator === 0 ? 0 : (n * sumXY - sumX * sumY) / denominator;
  return [slope, (sumY - slope * sumX) / n];
}

function sumSquares(observed: readonly number[], predicted: readonly number[]): number {
  let total = 0;
  for (let i = 0; i < observed.length; i += 1) total += (observed[i] - predicted[i]) ** 2;
  return total;
}

/** The asymptote grid the reference searches: 0.00 to 0.80 in twentieths. */
const ASYMPTOTES = Array.from({ length: 17 }, (_, index) => index * 0.05);

/** `u(h) = u_inf + A e^(-h/tau)`, selected on the u-space residual. */
export function fitExponential(
  seconds: readonly number[],
  absorbed: readonly number[],
  asymptotes: readonly number[] = ASYMPTOTES,
): DecayFit {
  const rows = usable(seconds, absorbed.map((value) => 1 - value));
  const overshoot = rows.filter(([, unpriced]) => unpriced < 0).length;
  if (rows.length < 3) {
    return {
      model: "none", halfLife: null, terminalUnpricedFraction: null, sse: null,
      nPoints: rows.length, overshootPoints: overshoot,
      reason: "fewer than three measured horizons",
    };
  }
  const xs = rows.map(([x]) => x);
  const unpriced = rows.map(([, u]) => u);

  let best: DecayFit | null = null;
  for (const asymptote of asymptotes) {
    const keep = unpriced.map((u) => u > asymptote + 1e-9);
    if (keep.filter(Boolean).length < 3) continue;
    const fitX = xs.filter((_, i) => keep[i]);
    const fitY = unpriced.filter((_, i) => keep[i]).map((u) => Math.log(u - asymptote));
    const [slope, intercept] = leastSquares(fitX, fitY);
    // A non-decaying fit is not a decay. The reference skips it rather than
    // reporting a negative tau that reads as a half-life.
    if (slope >= 0) continue;
    const tau = -1 / slope;
    const coefficient = Math.exp(intercept);
    const predicted = xs.map((x) => asymptote + coefficient * Math.exp(-x / tau));
    const sse = sumSquares(unpriced, predicted);
    if (best === null || (best.sse !== null && sse < best.sse)) {
      best = {
        model: "exponential", halfLife: tau * Math.LN2, terminalUnpricedFraction: asymptote,
        sse, nPoints: rows.length, overshootPoints: overshoot, reason: null,
      };
    }
  }
  if (best === null) {
    return {
      model: "none", halfLife: null, terminalUnpricedFraction: null, sse: null,
      nPoints: rows.length, overshootPoints: overshoot,
      reason: "no asymptote left three points above it with a decaying fit",
    };
  }
  return best;
}

/** `u(h) = c h^(-b)`, scored in u-space so it compares with the exponential. */
export function fitPower(seconds: readonly number[], absorbed: readonly number[]): DecayFit {
  const rows = usable(seconds, absorbed.map((value) => 1 - value));
  const overshoot = rows.filter(([, unpriced]) => unpriced < 0).length;
  const keep = rows.filter(([, unpriced]) => unpriced > 1e-9);
  if (keep.length < 3) {
    return {
      model: "none", halfLife: null, terminalUnpricedFraction: null, sse: null,
      nPoints: rows.length, overshootPoints: overshoot,
      reason: "fewer than three horizons with a positive unpriced fraction",
    };
  }
  const [slope, intercept] = leastSquares(
    keep.map(([x]) => Math.log(x)),
    keep.map(([, u]) => Math.log(u)),
  );
  const coefficient = Math.exp(intercept);
  const predicted = rows.map(([x]) => coefficient * x ** slope);
  const sse = sumSquares(rows.map(([, u]) => u), predicted);
  const life = slope < 0 && coefficient > 0 ? (0.5 / coefficient) ** (1 / slope) : null;
  return {
    model: "power", halfLife: life, terminalUnpricedFraction: null, sse,
    nPoints: rows.length, overshootPoints: overshoot,
    reason: life === null ? "the fitted exponent does not decay" : null,
  };
}

/* ------------------------------------------------ the Gaussian instrument -- */

/** The variance-preserving channel's signal share at a given log-SNR. */
export function sigmoid(value: number): number {
  return value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value));
}

/**
 * Bayes-optimal squared error at each log-SNR, summed over dimensions.
 *
 * `mmse(a) = sum_i sigmoid(a + log lambda_i)`. A model that cannot beat this
 * curve has learned nothing, which is what makes it the automated gate rather
 * than something to eyeball.
 */
export function mmse(alphas: readonly number[], logEigs: readonly number[]): number[] {
  return alphas.map((alpha) => logEigs.reduce((total, logEig) => total + sigmoid(alpha + logEig), 0));
}

/**
 * `g(a)`, the information density over resolution.
 *
 * `g(a) = 1/2 sum_i [sigmoid(a + log lambda_i) - sigmoid(a + log mu_i)]`, and it
 * is a DENSITY rather than a total: mass at low alpha means the conditioning
 * explains structure that survives heavy noise — the coarse, headline-shaped
 * part — and mass at high alpha means it explains detail that only appears once
 * the noise is nearly gone. The centroid therefore says at what RESOLUTION one
 * text explains another, which is a different question from how much.
 */
export function gaussianSpectrum(
  alphas: readonly number[],
  logLambda: readonly number[],
  logMu: readonly number[],
): number[] {
  const unconditional = mmse(alphas, logLambda);
  const conditional = mmse(alphas, logMu);
  return unconditional.map((value, index) => 0.5 * (value - conditional[index]));
}

/**
 * `I(x;c)` in nats, by the exact integral of the spectrum.
 *
 * `integral g da = 1/2 sum_i (log lambda_i - log mu_i)`. That identity is why the
 * instrument ships before the model does: the spectrum and its total can be
 * computed for every event with no network, no training and no torch.
 */
export function gaussianInformation(
  logLambda: readonly number[],
  logMu: readonly number[],
): number {
  const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
  return 0.5 * (sum(logLambda) - sum(logMu));
}

/** `h = d/2 log(2 pi e) + 1/2 sum log lambda_i`, the matched Gaussian's entropy. */
export function entropyNats(logEigs: readonly number[]): number {
  const sum = logEigs.reduce((total, value) => total + value, 0);
  return 0.5 * logEigs.length * Math.log(2 * Math.PI * Math.E) + 0.5 * sum;
}
