/**
 * The shape every strategy rule is written against.
 *
 * WHY A REGISTRY AND NOT A CHAIN
 *
 * `longState` was a 737-line `if (strategy === ...) { ... return out; }` chain
 * whose LAST branch had no condition: `rsi_reversion` was the fall-through, so
 * a strategy added to the `Strategy` union and forgotten here did not fail — it
 * quietly traded RSI reversion under another name, and the sweep reported it
 * under the name that was asked for. The registry in `./index` is typed
 * `Record<Strategy, LongStateRule>`, which turns that omission into a compile
 * error, and the lookup throws on a string that is not in the union at all.
 *
 * WHY A RULE FILLS AN ARRAY IT IS HANDED
 *
 * Not an optimisation. `lib/engine.ts` is the browser half of a three-way
 * parity contract — `modules/backtester/signals.py` is the reference and
 * `tests/fixtures/parity.json` pins the two together combination by
 * combination — so every one of the forty-six bodies had to move out of the
 * chain with not one operand reordered. Handing each rule the `out` it used to
 * close over is what made that a move rather than a re-typing.
 */

import type { Strategy } from "../types";

/** The columns a rule may read. `n` is `close.length`, carried so the loops read as they did. */
export interface SignalInput {
  readonly close: Float64Array;
  readonly high: Float64Array;
  readonly low: Float64Array;
  readonly volume: Float64Array;
  readonly n: number;
}

/**
 * One strategy's "should I be long?" rule.
 *
 * Writes 1 or 0 per bar into `out` and returns it. Two conventions bind every
 * implementation and are pinned by the parity suite — see `longState` in
 * `./index` for what they are and what breaks when they are dropped.
 */
export type LongStateRule = (
  input: SignalInput,
  fast: number,
  slow: number,
  out: Uint8Array,
) => Uint8Array;

/**
 * What one family module exports.
 *
 * Deliberately `Partial`: no single family is the whole catalogue. The
 * completeness check happens once, where the families are merged.
 */
export type RuleSet = Partial<Record<Strategy, LongStateRule>>;
