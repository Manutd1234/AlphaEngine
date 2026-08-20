import { mean, stdev } from "../stats";
import { ReturnsBySymbol } from "./inputs";

// --------------------------------------------------------------------------
// Covariance
// --------------------------------------------------------------------------

export interface CovarianceModel {
  symbols: string[];
  /** Realised volatility per symbol, per bar. */
  vol: number[];
  /** Symmetric correlation matrix, symbols × symbols. */
  correlation: number[][];
  /** Symmetric covariance matrix, symbols × symbols. */
  covariance: number[][];
  /** Observations the estimate is built from — small n is a weak covariance. */
  observations: number;
}

export function covariance(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let s = 0;
  for (let i = 0; i < n; i++) s += (a[i] - ma) * (b[i] - mb);
  return s / (n - 1);
}

/**
 * Covariance across the symbols actually held.
 *
 * Series are truncated to the shortest common length rather than padded. A
 * symbol with less history than the others would otherwise contribute zeros to
 * the overlap, which reads as *low* volatility and *no* correlation — the two
 * errors that both make a book look safer than it is.
 */
export function buildCovariance(
  symbols: string[],
  returns: ReturnsBySymbol,
): CovarianceModel | null {
  const usable = symbols.filter((s) => (returns[s]?.length ?? 0) >= 20);
  if (usable.length === 0) return null;

  const n = Math.min(...usable.map((s) => returns[s].length));
  if (n < 20) return null;

  // Align to the most recent `n` observations of each series.
  const series = usable.map((s) => returns[s].slice(-n));
  const vol = series.map((r) => stdev(r, 1));

  const cov = series.map((a) => series.map((b) => covariance(a, b)));
  const corr = cov.map((row, i) =>
    row.map((c, j) => {
      const d = vol[i] * vol[j];
      return d > 0 ? Math.max(-1, Math.min(1, c / d)) : 0;
    }),
  );

  return { symbols: usable, vol, correlation: corr, covariance: cov, observations: n };
}
