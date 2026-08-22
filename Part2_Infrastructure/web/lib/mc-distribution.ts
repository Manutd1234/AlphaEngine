/**
 * Terminal-outcome Monte Carlo for the Risk tab.
 *
 * Same drivers, different question from `montecarlo.ts`: the band resamples
 * the winner's realised per-bar returns to draw a cone *along* the historical
 * sample, while this simulates a forward horizon and keeps only where each
 * path *ends* — the distribution VaR-style loss markers are read from.
 *
 * Why everything is inlined in one factory: the simulation must run in a
 * dedicated worker, and Turbopack (Next 16.3) emits `new Worker(new URL(...))`
 * targets as raw assets rather than compiled entries — so the worker is built
 * from a Blob whose source is this factory, stringified. A stringified
 * function cannot reach imports. The factory is therefore fully
 * self-contained, and it is the ONE implementation: the worker, the
 * main-thread fallback and the tests all call the same code.
 * `tests/mc-distribution.test.ts` pins the inlined PRNG and bootstrap
 * draw-for-draw against `lib/random` and `lib/montecarlo`, so the band and
 * this distribution cannot quietly disagree about the driver stream.
 */

/**
 * Which resampler drew the paths.
 *
 * `stationary` is the block bootstrap (Politis & Romano 1994) the equity band
 * uses; `iid` draws every bar independently. The two are not comparable, so a
 * result must be able to say which one ran — `mcResamplerOf` reads it back off
 * the result, and `MonteCarlo.resampler` in `modules/quant_risk/var.py` states
 * it from the same rule, so the gateway and the browser cannot name a run two
 * different things.
 */
export type McResampler = "stationary" | "iid";

/** How each resampler is named in prose, in one place rather than five. */
export const MC_RESAMPLER_LABELS: Record<McResampler, string> = {
  stationary: "stationary bootstrap",
  iid: "i.i.d. bootstrap",
};

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
  /** Ignored by the math — changes request identity to force a re-run. */
  nonce?: number;
  /**
   * Which resampler draws the paths. Omitted, it is inferred from
   * `meanBlockLength` — a block of 1 is the i.i.d. draw, anything else is the
   * stationary bootstrap — so a request written before this field existed
   * still means exactly what it meant.
   *
   * Worth knowing before choosing `iid`: it destroys the volatility clustering
   * crypto returns actually have, and reports a cone too narrow in exactly the
   * tail the cone exists to show.
   *
   * The gateway's `bootstrap_terminal_distribution` takes the same argument
   * with the same two names and the same refusals. Its *unstated* default is
   * the other one — i.i.d., because that is the draw the Telegram card has
   * always shown, as the derived block is the draw this card has always shown
   * — so a caller who cares which resampler ran says which one. Naming it
   * gives the identical resampler on both sides.
   */
  resampler?: McResampler;
  /**
   * Mean block length for the stationary bootstrap, in bars. Omitted, the
   * driver's own √N heuristic is used — the same one the equity band uses,
   * because the autocorrelation does not change with the question being asked
   * of it. That derived value is the default, not a fixed constant.
   *
   * A block of 1 IS the i.i.d. draw: with pNew = 1 every draw starts a new
   * block, so blocks never form. Asking for `iid` alongside a longer block, or
   * for `stationary` alongside a block of 1, is a contradiction the simulation
   * refuses rather than resolving on the caller's behalf.
   */
  meanBlockLength?: number;
  /**
   * The three loss confidences to report, e.g. [50, 95, 99]. Omitted, those
   * three are used and the result is byte-identical to a request that never
   * mentioned them — which is what keeps lib/mc-parity.ts's committed
   * reference valid.
   */
  lossConfidences?: [number, number, number];
}

export interface McDistributionResult {
  paths: number;
  horizonBars: number;
  seed: number;
  equity: number;
  /**
   * The block length the run actually used, which also states the resampler:
   * 1 is the i.i.d. draw, anything above it the stationary bootstrap. Read it
   * through `mcResamplerOf` rather than re-deriving the rule at a call site —
   * that is what keeps the card's label and the run's maths one statement, and
   * what the Python side agrees with.
   */
  meanBlockLength: number;
  /** Dollar P&L landmarks of the terminal distribution. */
  pnl: { mean: number; p50: number; best: number; worst: number };
  /**
   * VaR-convention dollar losses: `p95` is the loss not exceeded in 95% of
   * paths (= −5th percentile of P&L). A negative value means even that tail
   * quantile ended in profit.
   */
  loss: { p50: number; p95: number; p99: number };
  /**
   * The requested confidences and their losses, present only when the caller
   * asked for something other than the default 50/95/99. Absent by default so
   * a default result serialises exactly as it always has — lib/mc-parity.ts
   * compares the canonical JSON byte for byte.
   */
  lossBands?: Array<{ confidence: number; loss: number }>;
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

/**
 * Self-contained builder — no references to module scope, see the module doc.
 * The inlined helpers are exact copies of `mulberry32` (lib/random.ts),
 * `stationaryBootstrapIndices` (lib/montecarlo.ts), `percentile`
 * (lib/quant.ts) and `histogramBins` (lib/stats.ts); the parity test fails
 * the build if any of them drifts from its original.
 *
 * `bootstrapIndices` carries the library's four-parameter shape for the same
 * reason the library has it: `n` is the INDEX RANGE (the whole driver) and
 * `count` is the STEP COUNT (the forward horizon). This card is the caller
 * that needs them to differ — the horizon is short and the history is long —
 * so passing the horizon as the range, as this file once did, resampled only
 * the driver's oldest `horizonBars` bars.
 */
export function mcSimulationFactory(): (req: McDistributionRequest) => McSimulation {
  const MIN_PATHS = 100;
  const MAX_PATHS = 100_000;
  const BINS = 32;

  const mulberry32 = (seed: number): (() => number) => {
    let state = (seed >>> 0) || 1;
    return () => {
      state |= 0;
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  const bootstrapIndices = (
    n: number,
    meanBlockLength: number,
    rand: () => number,
    count: number = n,
  ): Uint32Array => {
    const out = new Uint32Array(count);
    if (count === 0 || n === 0) return out;
    const pNew = 1 / Math.max(1, meanBlockLength);
    let cur = Math.floor(rand() * n);
    out[0] = cur;
    for (let i = 1; i < count; i++) {
      cur = rand() < pNew ? Math.floor(rand() * n) : (cur + 1) % n;
      out[i] = cur;
    }
    return out;
  };

  const percentileOf = (sorted: number[], p: number): number => {
    if (!sorted.length) return 0;
    const rank = Math.ceil((p / 100) * sorted.length);
    return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
  };

  const histogram = (values: number[], binCount: number) => {
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
  };

  return (req: McDistributionRequest): McSimulation => {
    const returns = req.returns.filter((r) => Number.isFinite(r));
    const n = returns.length;
    if (n === 0) throw new Error("The driver distribution is empty.");
    const horizonBars = Math.max(1, Math.floor(req.horizonBars));
    const paths = Math.min(MAX_PATHS, Math.max(MIN_PATHS, Math.floor(req.paths)));
    const equity = req.equity;
    // The resampler and its block length are one decision, so they are
    // resolved together and a contradiction between them is refused rather
    // than quietly resolved in the caller's favour — a run that silently used
    // the other resampler is the one failure this card cannot report.
    //
    // Defaults are unchanged by the two fields existing: no resampler and no
    // block length still means the band's own √N heuristic, because the
    // driver's autocorrelation does not change with the question asked of it.
    const derivedBlock = Math.min(100, Math.max(5, Math.round(Math.sqrt(n))));
    const askedBlock = req.meanBlockLength != null
      ? Math.min(100, Math.max(1, Math.round(req.meanBlockLength)))
      : null;
    const resampler = req.resampler ?? (askedBlock === 1 ? "iid" : "stationary");
    if (resampler === "iid" && askedBlock !== null && askedBlock !== 1) {
      throw new Error(
        `An i.i.d. bootstrap draws no blocks, so a mean block of ${askedBlock} bars cannot be honoured. `
          + "Ask for the stationary bootstrap, or drop the block length.",
      );
    }
    if (resampler === "stationary" && askedBlock === 1) {
      throw new Error(
        "A mean block of 1 bar is the i.i.d. draw, not a stationary bootstrap. "
          + "Ask for the i.i.d. resampler, or for a block above 1 bar.",
      );
    }
    const meanBlockLength = resampler === "iid" ? 1 : (askedBlock ?? derivedBlock);
    // The three confidences, and whether they were asked for. Default 50/95/99
    // maps to the 50th, 5th and 1st percentiles of P&L.
    const customConfidences = req.lossConfidences != null;
    const confidences: [number, number, number] = customConfidences
      ? (req.lossConfidences!.map((c) => Math.min(99.99, Math.max(0.01, c))) as [number, number, number])
      : [50, 95, 99];
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
          // `n` is the range drawn from, `horizonBars` the number of steps.
          // No `% n` on the read: after the split `idx[i] < n` by
          // construction, and restating that invariant at the read was what
          // made drawing from `[0, horizonBars)` look deliberate.
          const idx = bootstrapIndices(n, meanBlockLength, rand, horizonBars);
          let multiple = 1;
          for (let i = 0; i < horizonBars; i++) multiple *= 1 + drivers[idx[i]];
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
            p50: percentileOf(sorted, 50),
            best: sorted[sorted.length - 1],
            worst: sorted[0],
          },
          // A confidence C is the loss not exceeded in C% of paths, which is
          // the (100 − C)th percentile of P&L negated.
          loss: {
            p50: -percentileOf(sorted, 100 - confidences[0]),
            p95: -percentileOf(sorted, 100 - confidences[1]),
            p99: -percentileOf(sorted, 100 - confidences[2]),
          },
          // Present ONLY when the caller asked for something other than the
          // default three. Adding this key unconditionally would change the
          // canonical serialisation of every result and invalidate the
          // committed parity reference, which is the one thing this file may
          // not do.
          ...(customConfidences ? { lossBands: confidences.map((confidence) => ({
            confidence,
            loss: -percentileOf(sorted, 100 - confidence),
          })) } : {}),
          probLoss: losses / paths,
          histogram: histogram(pnl, BINS),
        };
      },
    };
  };
}

export const createMcSimulation = mcSimulationFactory();

/**
 * Which resampler drew this result, read off the result rather than
 * remembered from the request.
 *
 * A block of 1 bar is the i.i.d. draw and anything longer is the stationary
 * bootstrap — one rule, stated once, so no label can name a resampler the
 * simulation did not run. `MonteCarlo.resampler` in
 * `modules/quant_risk/var.py` derives its answer from the identical rule, and
 * `tests/fixtures/mc-resampler-parity.json` is the table both sides are held
 * to.
 */
export function mcResamplerOf(result: Pick<McDistributionResult, "meanBlockLength">): McResampler {
  return result.meanBlockLength <= 1 ? "iid" : "stationary";
}

/**
 * The three confidences a result was computed at.
 *
 * `lossBands` is present only when the caller asked for something other than
 * the default three — that absence is what keeps a default result's canonical
 * JSON byte-identical for lib/mc-parity.ts. So its absence MEANS 50/95/99, and
 * reading it through here is how every label stays true to its figure.
 */
export function mcLossConfidences(result: McDistributionResult): [number, number, number] {
  const bands = result.lossBands;
  if (!bands || bands.length !== 3) return [50, 95, 99];
  return [bands[0].confidence, bands[1].confidence, bands[2].confidence];
}

export type McWorkerMessage =
  | { type: "progress"; done: number; total: number }
  | { type: "result"; result: McDistributionResult }
  | { type: "error"; error: string };

/**
 * The worker program, composed from the SAME stringified factory — there is
 * no second implementation to drift. Consumed as a Blob URL by the hook.
 */
export function mcWorkerSource(): string {
  return `"use strict";
// Some compilers (esbuild keepNames, tsx in tests) inject __name(fn, "fn")
// calls into function bodies. The stringified factory carries them into a
// scope where the helper does not exist — define it as the identity.
const __name = (target) => target;
const createMcSimulation = (${mcSimulationFactory.toString()})();
const CHUNK = 500;
self.onmessage = (event) => {
  try {
    const sim = createMcSimulation(event.data);
    while (sim.done < sim.total) {
      sim.step(CHUNK);
      self.postMessage({ type: "progress", done: sim.done, total: sim.total });
    }
    self.postMessage({ type: "result", result: sim.finish() });
  } catch (err) {
    self.postMessage({ type: "error", error: err && err.message ? err.message : "The simulation failed." });
  }
};`;
}
