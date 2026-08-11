/**
 * Monte Carlo bands around the winner's equity curve.
 * ===================================================
 *
 * Answers the question a single equity line cannot: how much of this curve is
 * the path and how much is the strategy? We resample the winner's own per-bar
 * returns and recompound, so the cone shows what other histories the same
 * return distribution could have produced.
 *
 * The resampler is the stationary bootstrap (Politis & Romano 1994): blocks of
 * geometric length with expected size √N bars. Crypto returns carry little
 * linear autocorrelation but strong volatility clustering — iid resampling
 * destroys the clustering and reports a cone that is too narrow exactly where
 * it matters, in the tails. Mean block length 1 degenerates to iid, which the
 * tests exploit.
 *
 * Seeded with the run's data fingerprint and winning parameters, so the same
 * sweep always draws the same cone — this is provenance, not decoration.
 */

import { percentile } from "./quant";
import { mulberry32 } from "./random";
import type { MonteCarloBands } from "./types";

/**
 * One resample's bar indices. With probability 1/meanBlockLength start a new
 * block at a uniform position; otherwise continue sequentially, wrapping mod n
 * so end-of-sample bars are not under-drawn.
 */
export function stationaryBootstrapIndices(
  n: number,
  meanBlockLength: number,
  rand: () => number,
): Uint32Array {
  const out = new Uint32Array(n);
  if (n === 0) return out;
  const pNew = 1 / Math.max(1, meanBlockLength);
  let cur = Math.floor(rand() * n);
  out[0] = cur;
  for (let i = 1; i < n; i++) {
    cur = rand() < pNew ? Math.floor(rand() * n) : (cur + 1) % n;
    out[i] = cur;
  }
  return out;
}

/**
 * Seed derived from the data identity and the winning parameters. Exported so
 * the engine's band and the Risk tab's terminal-distribution worker draw from
 * the same stream for the same run — rerunning the same sweep draws the same
 * cone, a different winner draws a fresh one.
 */
export function mcSeedFor(dataHash: string, fast: number, slow: number): number {
  return (parseInt(dataHash.slice(0, 8), 16) ^ Math.imul(fast, 0x9e3779b1) ^ slow) >>> 0;
}

export function monteCarloBands(
  returns: Float64Array,
  sampleIndices: number[],
  seed: number,
  opts: { paths?: number; meanBlockLength?: number } = {},
): MonteCarloBands {
  const n = returns.length;
  const paths = Math.max(1, Math.floor(opts.paths ?? 300));
  const meanBlockLength = Math.max(
    1,
    Math.floor(
      opts.meanBlockLength ?? Math.min(100, Math.max(5, Math.round(Math.sqrt(n)))),
    ),
  );
  const m = sampleIndices.length;
  const rand = mulberry32(seed);

  // Column-major: all paths' equities at sampled bar j sit contiguously.
  const vals = new Float64Array(m * paths);
  const finals = new Float64Array(paths).fill(1);

  for (let p = 0; p < paths; p++) {
    const idx = stationaryBootstrapIndices(n, meanBlockLength, rand);
    let eq = 1;
    let j = 0;
    for (let i = 0; i < n; i++) {
      eq *= 1 + returns[idx[i]];
      if (j < m && sampleIndices[j] === i) {
        vals[j * paths + p] = eq;
        j++;
      }
    }
    finals[p] = eq;
  }

  const p05 = new Array<number>(m);
  const p25 = new Array<number>(m);
  const p50 = new Array<number>(m);
  const p75 = new Array<number>(m);
  const p95 = new Array<number>(m);
  const scratch = new Array<number>(paths);
  for (let j = 0; j < m; j++) {
    for (let p = 0; p < paths; p++) scratch[p] = vals[j * paths + p];
    scratch.sort((a, b) => a - b);
    p05[j] = percentile(scratch, 5);
    p25[j] = percentile(scratch, 25);
    p50[j] = percentile(scratch, 50);
    p75[j] = percentile(scratch, 75);
    p95[j] = percentile(scratch, 95);
  }

  const sortedFinals = [...finals].sort((a, b) => a - b);
  let losing = 0;
  for (let p = 0; p < paths; p++) if (finals[p] < 1) losing++;

  return {
    method: "stationary-bootstrap",
    seed,
    paths,
    meanBlockLength,
    p05,
    p25,
    p50,
    p75,
    p95,
    terminal: {
      p05: percentile(sortedFinals, 5),
      p50: percentile(sortedFinals, 50),
      p95: percentile(sortedFinals, 95),
      probLoss: losing / paths,
    },
  };
}
