import type { CoherenceDispersion } from "./types-lab";
import { toCenticents } from "./fixed-point";

/** A maker-to-maker range needs two usable answers and both quoted endpoints. */
export function hasDrawableMakerRange(row: CoherenceDispersion): boolean {
  return row.usable >= 2
    && row.spread != null
    && toCenticents(row.lowest) != null
    && toCenticents(row.highest) != null;
}
