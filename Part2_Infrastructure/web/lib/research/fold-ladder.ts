/**
 * The walk-forward as a ladder: where each fold's in-sample winner PLACED out
 * of sample, among every combination scored on that fold.
 *
 * `WalkForwardTimeline` draws in-sample against out-of-sample Sharpe, which
 * answers "did the fit's number hold". This answers the sharper question the
 * fold shape carries and nothing drew: `oosRank` of `combosRanked`. Rank 1 of
 * 40 means the choice held up; rank 33 of 40 means the fold selected noise —
 * and a fold can post a respectable out-of-sample Sharpe while ranking 33rd,
 * because the whole grid did well that quarter. The rank is the question the
 * Sharpe cannot answer.
 *
 * A PURE MODULE, grammar rule 4. The reference is the MEDIAN rank — where a
 * choice no better than chance would land — so a fold above it beat chance
 * and a fold below it did not, and the sentence under the figure can count
 * them.
 *
 * NULL HONESTY. `oosRank` and `combosRanked` are optional on the wire; a fold
 * without them is withheld with that reason, never drawn at rank 0 as if it
 * had won.
 */

import type { WalkForwardFold } from "@/lib/types/sweep";

export interface FoldRung {
  fold: number;
  /** 1 is best. Null when the fold carried no rank. */
  rank: number | null;
  of: number | null;
  /** rank / of, in (0, 1]; lower is better. Null when withheld. */
  placing: number | null;
  /** Beat the median rank of its own grid. Null when withheld. */
  beatChance: boolean | null;
  chosenFast: number;
  chosenSlow: number;
  oosSharpe: number;
  withheld: string | null;
}

export interface FoldLadder {
  rungs: FoldRung[];
  scored: number;
  withheld: number;
  beatChance: number;
}

export function foldLadder(folds: readonly WalkForwardFold[]): FoldLadder {
  let scored = 0;
  let withheld = 0;
  let beat = 0;
  const rungs = folds.map((f): FoldRung => {
    const base = { fold: f.fold, chosenFast: f.chosenFast, chosenSlow: f.chosenSlow, oosSharpe: f.oosSharpe };
    if (f.oosRank == null || f.combosRanked == null || !(f.combosRanked > 0)) {
      withheld += 1;
      return { ...base, rank: null, of: null, placing: null, beatChance: null, withheld: "this fold carried no out-of-sample rank" };
    }
    scored += 1;
    const placing = f.oosRank / f.combosRanked;
    // Median rank of the grid. Strictly better than the median beats chance;
    // exactly the median is chance and does not count.
    const beatChance = f.oosRank < (f.combosRanked + 1) / 2;
    if (beatChance) beat += 1;
    return { ...base, rank: f.oosRank, of: f.combosRanked, placing, beatChance, withheld: null };
  });
  return { rungs, scored, withheld, beatChance: beat };
}

export function ladderReading(ladder: FoldLadder): string {
  if (ladder.scored === 0) return "No fold carried an out-of-sample rank, so nothing here is scored.";
  return `${ladder.beatChance} of ${ladder.scored} folds placed their in-sample winner above the median out of sample`
    + (ladder.beatChance === ladder.scored ? " — every choice held up."
      : ladder.beatChance === 0 ? " — no choice held up; the folds selected noise."
      : ".");
}
