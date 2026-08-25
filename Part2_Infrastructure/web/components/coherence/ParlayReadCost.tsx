"use client";

/**
 * What a parlay read costs the venue, and where this one stopped.
 *
 * "Parlay cannot load" — and what the pane said about it was one sentence:
 * "The parlays could not be read: The risk gateway did not answer within
 * 25000ms." A dead pane with a number in it, and the number was wrong twice
 * over: the request that rendered it had waited about five seconds, not
 * twenty-five, because it had joined an earlier poll's still-open promise; and
 * nothing on the screen said what the read had been trying to do when it ran
 * out.
 *
 * THE HOUSE RULE IS THAT AN EMPTY STATE DRAWS TOO. A view whose failure branch
 * is a grey sentence reads as a broken tab rather than as a venue that did not
 * answer, and on a keyless or rate-limited deployment that branch IS the view.
 * So the failure gets the same treatment as the success: a figure, with the
 * stage that failed marked.
 *
 * WHY THE STAGES ARE WORTH DRAWING AT ALL. A parlay read is not one call, and
 * its shape is the reason it is the slowest thing on this tab: one listing call
 * for every open combo the exchange publishes, then ONE bulk book call covering
 * the parlays taken plus every leg they name — capped at a hundred tickers,
 * across shards, because a parlay on one shard references markets on another.
 * A reader who can see that can tell "the venue is slow" from "the venue is
 * not listing anything" without opening a fold.
 *
 * It draws through `FormationDiagram`, which already owns the chain grammar and
 * the marks; nothing here is a second way of drawing a chain. It reads nothing:
 * every figure comes off the payload the pane already has, or off its absence.
 */

import FormationDiagram, { type FormationStage } from "./FormationDiagram";
import type { CoherenceCombos } from "@/lib/coherence/types-lab";

/** One bulk orderbook call carries this many tickers. Mirrors the syscall. */
const BULK_TICKERS = 100;

export default function ParlayReadCost({ data, error, ticker }: {
  /** The read, when one landed. Null on the branch this figure exists for. */
  data: CoherenceCombos | null;
  /** Why it did not, in the boundary's own words. */
  error: string | null;
  /** The parlay a reader asked for by name, if they did. */
  ticker: string | null;
}) {
  const combos = data?.combos ?? [];
  const legs = combos.reduce((total, combo) => total + combo.legs.length, 0);
  const books = combos.length + legs;
  const listed = data ? combos.length > 0 : null;

  const stages: FormationStage[] = [
    {
      title: "List what is open",
      value: data ? `${combos.length} taken` : "—",
      note: ticker
        ? "one call, then the named parlay is picked out of it"
        : "one call for every open combo the exchange publishes",
      holds: listed,
    },
    {
      title: "Fetch their books",
      value: data ? `${books} ticker(s)` : "—",
      note: books > BULK_TICKERS
        ? `one bulk call carries ${BULK_TICKERS}, so this read is short of ${books - BULK_TICKERS}`
        : "one per leg plus one per parlay, in a single bulk call across shards",
      holds: data ? books > 0 : null,
    },
    {
      title: "Bound each price",
      value: data ? `${data.quoted} priced` : "—",
      note: "a band needs every leg quoted; a missing leg leaves the band unbounded, not zero",
      holds: data ? data.quoted > 0 : null,
    },
    {
      title: "Compare",
      value: data ? `${data.outside_band} outside` : "—",
      note: "the only reading on this view that is a mispricing",
      holds: data ? data.outside_band === 0 : null,
    },
  ];

  return (
    <FormationDiagram
      stages={stages}
      caption="What this read asks the venue for, and how far it got"
      keyLine="Each box is a call or a computation on what it returned; a box marked ◌ was never reached."
      reading={
        error
          ? "The read stopped at the first box that could not answer; everything right of it was never asked."
          : listed === false
            ? "The listing answered and had nothing open in it, so no book was fetched."
            : `Every box answered: ${combos.length} parlay(s) bounded from ${legs} leg(s).`
      }
      missing={error ? `The venue did not answer this read: ${error}` : null}
      notes={[
        "A parlay is cross-shard by construction — one on the events shard references markets on "
        + "another — so its legs cannot be read from the same book call as the parlay itself, and the "
        + "count above is the whole cost of one poll.",
        ticker
          ? "A named parlay is picked out of the same listing rather than fetched directly, so asking "
            + "for one costs the listing call either way."
          : "Asking for a ticker reads a specific parlay instead of the few with the tightest bands.",
      ]}
    />
  );
}
