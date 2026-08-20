/**
 * The strategy catalogue: forty-six rules, one lookup.
 *
 * Grouped into modules by the same families the picker groups them by
 * (`STRATEGY_FAMILY` in `lib/types.ts`), so a rule and its label cannot drift
 * into disagreeing about what kind of thing it is.
 */

import type { Strategy } from "../types";

import { BREAKOUT_RULES } from "./breakout";
import { FITTED_RULES } from "./fitted";
import { MEAN_REVERSION_RULES } from "./mean-reversion";
import { MOMENTUM_RULES } from "./momentum";
import { TREND_RULES } from "./trend";
import { VOLATILITY_RULES } from "./volatility";
import { VOLUME_RULES } from "./volume";
import type { LongStateRule } from "./types";

export type { LongStateRule, RuleSet, SignalInput } from "./types";

/**
 * Every rule in the catalogue, by id.
 *
 * The annotation is the point. `Record<Strategy, LongStateRule>` is exhaustive,
 * so a strategy added to the union without a rule fails `tsc` here instead of
 * falling through to whichever branch happened to be last.
 */
export const LONG_STATE_RULES: Record<Strategy, LongStateRule> = {
  ...TREND_RULES,
  ...BREAKOUT_RULES,
  ...MEAN_REVERSION_RULES,
  ...MOMENTUM_RULES,
  ...VOLUME_RULES,
  ...VOLATILITY_RULES,
  ...FITTED_RULES,
};

/**
 * The strategy's "should I be long?" state, bar by bar.
 *
 * Mirrors `build_signals` in the Python reference, including two details that
 * are easy to get wrong and that the parity suite pins:
 *
 *  1. **Exit dominates entry.** The reference assigns the entry mask and then
 *     the exit mask, so a bar where both fire ends up flat. Written as an
 *     if/else-if chain the entry wins instead — which turns RSI reversion from
 *     2 trades into 70, because oversold and below-trend nearly always coincide.
 *  2. **NaN comparisons are false.** Before an indicator's lookback is filled it
 *     has no opinion, and "no opinion" is not "exit".
 */
export function longState(
  strategy: Strategy,
  close: Float64Array,
  high: Float64Array,
  low: Float64Array,
  volume: Float64Array,
  fast: number,
  slow: number,
): Uint8Array {
  const n = close.length;
  const out = new Uint8Array(n);
  const rule = LONG_STATE_RULES[strategy];
  // Unreachable while the types hold, and both routes already refuse an
  // unknown id with a warning that names the substitution. Reachable only from
  // a cast, and the old chain answered one of those with `rsi_reversion` and no
  // sign that it had — a wrong number under the right name. This says so.
  if (!rule) throw new Error(`Unknown strategy "${strategy}" — no rule in the catalogue.`);
  return rule({ close, high, low, volume, n }, fast, slow, out);
}
