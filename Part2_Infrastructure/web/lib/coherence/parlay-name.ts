/**
 * A parlay's name, for readers rather than for the exchange's index.
 *
 * "Rename the Parlays so that we can read it, now it is a bunch of gibberish."
 * The gibberish was `KXMVE-26AUG25-LIV-9C1` printed as the subject of a row,
 * a strip label and a fold summary — and the fix needed no new data. The
 * gateway already composes `label` from the venue's own words
 * (`yes_sub_title`, falling back to the event title, falling back to the
 * ticker) and the desk rendered it in exactly one place: a paragraph inside a
 * closed fold.
 *
 * WHAT A NAME MAY NOT BE. Never the bare ticker — that is the identifier, and
 * it keeps its own place beside the name. Never invented from the ticker's
 * parts: "KXMVE" is a series code, and expanding it here would be this file
 * guessing at the venue's taxonomy. And never a restatement of the row it
 * heads — the legs, the scope and the band are columns, and a name repeating a
 * column is the copy defect the audit guards against.
 *
 * So there are two cases and no third: the venue gave words, or it did not.
 * When it did not, the parlay is "Unnamed parlay …" plus the last six
 * characters of its ticker — the tail is what tells two unnamed parlays apart,
 * for the same reason `label-metrics` truncates a long label in the middle
 * rather than at the end.
 */

import type { CoherenceCombo } from "@/lib/coherence/types-lab";

/** How much of the ticker identifies a parlay when nothing else does. */
const TAIL = 6;

/** Did the venue give this parlay words of its own? */
export function isNamed(combo: Pick<CoherenceCombo, "label" | "ticker">): boolean {
  const label = (combo.label ?? "").trim();
  return label.length > 0 && label !== combo.ticker;
}

/** The parlay's name: the venue's words, capitalised — or its tail, said to be a tail. */
export function parlayName(combo: Pick<CoherenceCombo, "label" | "ticker">): string {
  if (!isNamed(combo)) return `Unnamed parlay …${combo.ticker.slice(-TAIL)}`;
  const label = (combo.label ?? "").trim();
  // Initial cap only. Title-casing the rest would fight the venue's own
  // capitalisation — "NYC above 90" is theirs and is already right.
  return label[0].toUpperCase() + label.slice(1);
}
