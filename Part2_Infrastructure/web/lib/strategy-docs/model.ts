/**
 * The shape of a strategy card, and the rules every entry obeys.
 *
 * `whenItFails` is mandatory and is never a hedge. Every entry names a specific
 * market condition, because "may underperform in some conditions" is the same
 * sentence for all forty-six and therefore tells a reader nothing.
 * `strategy-docs.test.ts` enforces that: a minimum length per field, a regime
 * word in every failure, no two entries failing in the same words, no promise
 * in a summary, and every `similar` id resolving to a real strategy.
 */

import type { Strategy } from "@/lib/types";

export interface StrategyDoc {
  /** One sentence a reader can decide from. */
  summary: string;
  /** The rule as implemented, in words rather than code. */
  formula: string;
  /** The market condition it is built for. */
  whenItWorks: string;
  /** The market condition that takes it apart. Never a hedge. */
  whenItFails: string;
  /** Strategies worth comparing against, by id. */
  similar: Strategy[];
}
