/**
 * When the terminal distribution is not a distribution.
 *
 * WHAT WENT WRONG ON SCREEN
 * ------------------------------------------------------------------------
 * The Monte Carlo card was reported fully populated and entirely zero: paths
 * 50,000, a resampler, a block length, a seed, and then "MEAN OUTCOME $0",
 * "P50 LOSS $-0", "P95 LOSS $-0", "P99 LOSS $-0", "WORST CASE $0", "0.0% of
 * paths end in loss", a histogram that was one solid block from "$0" to "$0",
 * and a verdict reading "Within headroom." A trader reads that as a measured
 * claim of safety over 50,000 simulated futures. It was nothing of the kind.
 *
 * WHERE THE ZEROS COME FROM, TRACED RATHER THAN GUESSED
 * ------------------------------------------------------------------------
 * `lib/engine/combo.ts` computes each bar's strategy return as
 * `lagged * pxRet[i] - turnover * cost - holding`. A parameter combination
 * that never takes a position — a slow window longer than the sample, a
 * crossover that never crosses, a filter that never admits a bar — holds
 * `lagged === 0` for every bar, which makes turnover and the holding charge
 * zero too, so every element of `returns` is EXACTLY 0. `lib/engine.ts` ships
 * that array as `bestRunReturns`, and `lib/use-sweep-run.ts` builds `mcDriver`
 * from it after testing `bestRunReturns?.length` — a LENGTH test, not a
 * content test. So the driver arrives non-null and useless: the card's "No
 * completed run" branch (which tests `driver === null`) correctly does not
 * fire, the simulation runs, every resampled path multiplies 1 + 0 together
 * for the whole horizon, and every terminal outcome is `equity * (1 - 1)`.
 *
 * Zero is then a legitimate arithmetic answer to an illegitimate question, and
 * the card had no vocabulary for that difference. "$0" is a VALUE. "This could
 * not be computed from the drivers it was given" is a FACT ABOUT THE INPUTS.
 * Printing the second as the first is the defect this codebase is most alert
 * to, wearing five stat tiles instead of a `?? 0`.
 *
 * WHY THE GUARD LIVES HERE AND NOT AT THE PRODUCER
 * ------------------------------------------------------------------------
 * The rejected alternative was to screen the driver where it is built, in
 * `lib/use-sweep-run.ts`, and hand the card a null. That is worth doing as
 * well — it stops a worker being spun up for a simulation whose answer is
 * already known — but it must not be the ONLY guard, and it cannot be the one
 * the card relies on, for two reasons. First, a null driver renders "No
 * completed run", which is a different and untrue statement: research DID
 * complete, and what it produced was a winner that never traded. The reader
 * needs that sentence, not a suggestion to run research again. Second, a
 * degenerate driver is not the only way to reach a degenerate result — any
 * future resampler, block length or horizon that collapses the outcomes would
 * arrive at the same five zero tiles — so the refusal is stated over the
 * RESULT as well, where it cannot be routed around.
 *
 * Both checks are dispersion tests, not equality-to-zero tests. A driver of
 * all 0.001 and a driver of all 0 are the same defect: every path is the same
 * path, and a "distribution" of one repeated number has no quantiles to read.
 */

import { usd } from "@/lib/format";
import type { McDistributionResult } from "@/lib/mc-distribution";

/**
 * A named reason the card is refusing to draw, in the shape the rest of this
 * tree gives absence: a typed state with a reason, never an exception and
 * never an empty list meaning "could not".
 *
 * `kind` is for code, `headline` and `detail` are for the reader, and
 * `observations` / `paths` carry the measurement the sentence is making so no
 * caller has to re-derive it to print it.
 */
export type McDegeneracy =
  | { kind: "driver-empty"; headline: string; detail: string; observations: number }
  | { kind: "driver-never-traded"; headline: string; detail: string; observations: number }
  | { kind: "driver-constant"; headline: string; detail: string; observations: number }
  | { kind: "outcomes-unmoved"; headline: string; detail: string; paths: number }
  | { kind: "outcomes-identical"; headline: string; detail: string; paths: number };

/**
 * Dollars, with anything that rounds to zero printed as zero.
 *
 * `usd(-0, 0)` is `"$-0"`, and so is `usd(-0.4, 0)`: `toLocaleString` keeps the
 * sign of a value that rounds away. The loss figures are negated percentiles —
 * `-percentileOf(sorted, 5)` — so a break-even quantile becomes negative zero
 * by construction and the card printed "P95 LOSS $-0" on a book that had lost
 * nothing at all. `pct` in lib/format.ts already normalises exactly this for
 * axis labels and states the reason in its own comment; this is that rule for
 * money, kept here rather than added to `usd` so the change cannot alter the
 * hundred other call sites that were never wrong.
 *
 * Null and non-finite pass through to `usd`, which dashes them. A missing
 * measurement must not become "$0" on the way through a formatter whose whole
 * job is to stop a sign appearing.
 */
export function mcUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return usd(value, 0);
  return usd(Math.abs(value) < 0.5 ? 0 : value, 0);
}

/** True once the figure has rounded away, so a tone cannot colour a zero. */
export const mcRoundsToZero = (value: number): boolean =>
  Number.isFinite(value) && Math.abs(value) < 0.5;

/**
 * Whether these drivers can produce a distribution at all.
 *
 * Called BEFORE the request is built, so a degenerate driver never reaches the
 * worker: there is no answer worth the CPU, and a running skeleton followed by
 * a refusal reads as a failure rather than as a fact about the inputs.
 */
export function mcDriverDegeneracy(returns: number[]): McDegeneracy | null {
  const finite = returns.filter((value) => Number.isFinite(value));
  if (finite.length === 0) {
    return {
      kind: "driver-empty",
      observations: returns.length,
      headline: "No usable driver returns.",
      detail:
        `The winning run reported ${returns.length} bar${returns.length === 1 ? "" : "s"}, `
        + "none of them a finite return. There is nothing to resample, so nothing was simulated.",
    };
  }
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  if (hi !== lo) return null;
  // Every bar identical. The all-zero case is the one the sweep actually
  // produces and it has a cause worth naming, so it gets its own sentence
  // rather than being folded into the general one.
  if (lo === 0) {
    return {
      kind: "driver-never-traded",
      observations: finite.length,
      headline: "The winning run never took a position.",
      detail:
        `All ${finite.length.toLocaleString()} of its bar returns are exactly zero, which is what a `
        + "combination that never entered the market produces. Resampling zeroes returns zeroes, so "
        + "the tiles below would read $0 for every confidence — a statement about the parameters, "
        + "not a measurement of this book's risk. Nothing was simulated.",
    };
  }
  return {
    kind: "driver-constant",
    observations: finite.length,
    headline: "The driver returns carry no dispersion.",
    detail:
      `All ${finite.length.toLocaleString()} bar returns are the same value, so every resampled path `
      + "is the same path and the loss quantiles would all be one repeated number. A distribution "
      + "needs returns that differ. Nothing was simulated.",
  };
}

/**
 * Whether a completed run actually produced a distribution.
 *
 * The second half of the guard, and the one that cannot be routed around: it
 * reads the finished result rather than the inputs, so a collapse introduced
 * by any future resampler, block length or horizon is caught here even when
 * the drivers themselves looked healthy.
 */
export function mcResultDegeneracy(result: McDistributionResult): McDegeneracy | null {
  const { best, worst } = result.pnl;
  if (!Number.isFinite(best) || !Number.isFinite(worst) || best !== worst) return null;
  if (worst === 0) {
    return {
      kind: "outcomes-unmoved",
      paths: result.paths,
      headline: "Every simulated path ended exactly where it started.",
      detail:
        `All ${result.paths.toLocaleString()} paths finished at break-even, so the distribution has `
        + "no spread and no tail to read a loss quantile off. The zeroes below would be arithmetic, "
        + "not a measured chance of losing nothing.",
    };
  }
  return {
    kind: "outcomes-identical",
    paths: result.paths,
    headline: "Every simulated path ended at the same value.",
    detail:
      `All ${result.paths.toLocaleString()} paths finished at ${mcUsd(worst)}. A distribution with one `
      + "outcome has no quantiles: every confidence would report that same figure, which says "
      + "nothing about how much this book can lose.",
  };
}
