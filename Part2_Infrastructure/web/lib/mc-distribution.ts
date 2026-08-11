/**
 * Terminal-outcome Monte Carlo for the Risk tab.
 *
 * Same drivers, different question from `montecarlo.ts`: the band resamples
 * the winner's realised per-bar returns to draw a cone *along* the historical
 * sample, while this simulates a forward horizon and keeps only where each
 * path *ends* — the distribution VaR-style loss markers are read from. It
 * deliberately shares the stationary bootstrap and the seeded PRNG, so the
 * two never disagree about what the driver distribution is.
 *
 * Pure and chunk-steppable: the worker steps it between progress posts and
 * the main-thread fallback steps it between yields, and chunk boundaries must
 * not change the draw stream — the PRNG advances identically either way.
 */

import { stationaryBootstrapIndices } from "./montecarlo";
import { percentile } from "./quant";
import { mulberry32 } from "./random";
import { histogramBins } from "./stats";

export interface McDistributionRequest {
  /** The winner's realised per-bar returns — `SweepResponse.bestRunReturns`. */
  returns: number[];
  /** Forward length of each simulated path, in bars of the run's interval. */
  horizonBars: number;
  /** Path count. Clamped to [100, 100_000]. */
  paths: number;
  /** From `mcSeedFor` — the band's seed derivation. */
  seed: number;
  /** Book equity in dollars; outcomes are reported as $ P&L against it. */
  equity: number;
}

export interface McDistributionResult {
  paths: number;
  horizonBars: number;
  seed: number;
  equity: number;
  meanBlockLength: number;
  /** Dollar P&L landmarks of the terminal distribution. */
  pnl: { mean: number; p50: number; best: number; worst: number };
  /**
   * VaR-convention dollar losses: `p95` is the loss not exceeded in 95% of
   * paths (= −5th percentile of P&L). A negative value means even that tail
   * quantile ended in profit.
   */
  loss: { p50: number; p95: number; p99: number };
  /** Share of paths that ended below the starting equity. */
  probLoss: number;
  /** Histogram over $ P&L. `edges.length === counts.length + 1`. */
  histogram: { edges: number[]; counts: number[] } | null;
}

export interface McSimulation {
  readonly total: number;
  readonly done: number;
  /** Advance up to `count` paths; returns paths completed so far. */
  step(count: number): number;
  /** Valid only once `done === total`. */
  finish(): McDistributionResult;
}

export const MC_DIST_MIN_PATHS = 100;
export const MC_DIST_MAX_PATHS = 100_000;
export const MC_DIST_HISTOGRAM_BINS = 32;

export function createMcSimulation(req: McDistributionRequest): McSimulation {
  const returns = req.returns.filter((r) => Number.isFinite(r));
  const n = returns.length;
  if (n === 0) throw new Error("The driver distribution is empty.");
  const horizonBars = Math.max(1, Math.floor(req.horizonBars));
  const paths = Math.min(MC_DIST_MAX_PATHS, Math.max(MC_DIST_MIN_PATHS, Math.floor(req.paths)));
  const equity = req.equity;
  // Same block-length heuristic as the band — the driver's autocorrelation
  // does not change with the question being asked of it.
  const meanBlockLength = Math.min(100, Math.max(5, Math.round(Math.sqrt(n))));
  const rand = mulberry32(req.seed);
  const drivers = Float64Array.from(returns);
  const outcomes = new Float64Array(paths);
  let done = 0;

  return {
    total: paths,
    get done() {
      return done;
    },
    step(count: number): number {
      const until = Math.min(paths, done + Math.max(1, Math.floor(count)));
      for (; done < until; done++) {
        const idx = stationaryBootstrapIndices(horizonBars, meanBlockLength, rand);
        let multiple = 1;
        for (let i = 0; i < horizonBars; i++) multiple *= 1 + drivers[idx[i] % n];
        outcomes[done] = equity * (multiple - 1);
      }
      return done;
    },
    finish(): McDistributionResult {
      if (done !== paths) throw new Error("finish() before the simulation completed");
      const pnl = Array.from(outcomes);
      const sorted = [...pnl].sort((a, b) => a - b);
      const mean = pnl.reduce((acc, v) => acc + v, 0) / paths;
      const losses = pnl.filter((v) => v < 0).length;
      return {
        paths,
        horizonBars,
        seed: req.seed,
        equity,
        meanBlockLength,
        pnl: {
          mean,
          p50: percentile(sorted, 50),
          best: sorted[sorted.length - 1],
          worst: sorted[0],
        },
        loss: {
          p50: -percentile(sorted, 50),
          p95: -percentile(sorted, 5),
          p99: -percentile(sorted, 1),
        },
        probLoss: losses / paths,
        histogram: histogramBins(pnl, MC_DIST_HISTOGRAM_BINS),
      };
    },
  };
}

export type McWorkerMessage =
  | { type: "progress"; done: number; total: number }
  | { type: "result"; result: McDistributionResult }
  | { type: "error"; error: string };
