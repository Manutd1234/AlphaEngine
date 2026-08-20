import { mean, normCdf, stdev } from "../stats";

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

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
