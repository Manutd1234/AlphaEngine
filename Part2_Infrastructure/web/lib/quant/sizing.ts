import { mean, normCdf, stdev } from "../stats";

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
