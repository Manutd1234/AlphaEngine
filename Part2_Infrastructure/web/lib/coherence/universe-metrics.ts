/**
 * What the watched universe is worth, holds and risks — read off one payload.
 *
 * A pure module on purpose. `npm test` has no DOM and never will (CLAUDE.md,
 * fact 6), so a figure computed inline in JSX is a figure no suite can check.
 * Everything here takes the universe payload and returns numbers, which is what
 * lets `coherence-universe-parity.test.ts` hold these readings against a
 * payload the gateway actually built.
 *
 * ── Three rules, each a way these numbers could lie ────────────────────────
 *
 * **A measured zero is not an absence.** Kalshi reports `"0.0000"` resting
 * liquidity on a market it has looked at and found nothing on, and reports no
 * field at all when the venue stopped sending one. The first is a fact and
 * prints as `0`; the second is unknown and prints as a dash with a reason.
 * Every reading below keeps `0` and `null` distinct all the way out, and the
 * `counted` / `absent` fields exist so a tile can say which it is looking at.
 *
 * **A total built from the contributors that answered understates the whole by
 * exactly the ones it skipped.** So the size totals are strict: one family
 * without a figure withholds the watchlist total and says how many caused it.
 * This is `sumPrices`' rule and `_size_total`'s rule in the gateway, kept the
 * same on this side so the two halves cannot disagree about what a total means.
 *
 * **The two reasons a basket has no price are different facts.** A family the
 * exchange does not call mutually exclusive has no basket to price — the
 * question does not apply. A mutually exclusive family with an unquoted leg has
 * a basket nobody can price — the question applies and has no answer. They are
 * counted apart, because a composition that pooled them would tell a reader
 * "cannot say" about families where there is nothing to say.
 *
 * Arithmetic is in integer centicents throughout, via `fixed-point.ts`. Nothing
 * here goes near binary64: these strings are the exchange's own fixed point and
 * their last places decide an answer.
 */

import { fromCenticents, toCenticents } from "./fixed-point";
import type { CoherenceEventView, CoherenceUniverse } from "./types";

/** A strict sum: absent anywhere means absent overall, and it says how many. */
export interface Total {
  /** The sum in centicent units, or null when a contributor carried no figure.
   *  A `0` here is a measurement — the exchange looked and found nothing. */
  totalCc: number | null;
  /** Contributors that carried a figure. */
  counted: number;
  /** Contributors that carried none. Non-zero is why `totalCc` is null. */
  absent: number;
}

/** What a dollar of the watchlist costs, and why some families cannot say. */
export interface BasketValue {
  /** Summed cost of buying one basket of every family that is priced as one. */
  totalCc: number | null;
  counted: number;
  /** No basket exists: the exchange does not call these mutually exclusive. */
  notExclusive: number;
  /** A basket exists and nobody can price it: a leg is unquoted. */
  unpriceable: number;
}

/** One asset class, and how much of the watchlist it is. */
export interface CategoryShare {
  /** Kalshi's own category, or null for a series it would not answer for. */
  category: string | null;
  families: number;
}

/** One price band of a family, and the size resting in it. */
export interface Band {
  /** Inclusive lower and exclusive upper bound of the band, in centicents. */
  lowCc: number;
  highCc: number;
  /** Open interest whose outcome is offered inside this band. */
  contractsCc: number;
  /** This band's share of the family, or null when there is no denominator. */
  share: number | null;
}

/** A strict sum over one nullable string field of every family. */
function strictTotal(events: readonly CoherenceEventView[], pick: (e: CoherenceEventView) => string | null): Total {
  let total = 0;
  let counted = 0;
  let absent = 0;
  for (const event of events) {
    const parsed = toCenticents(pick(event));
    if (parsed == null) absent += 1;
    else {
      total += parsed;
      counted += 1;
    }
  }
  // Absent anywhere withholds the whole figure — but the count of what DID
  // answer survives, so the tile can say "two of three families" rather than
  // just dashing.
  return { totalCc: absent || !counted ? null : total, counted, absent };
}

/** Contracts outstanding across the watchlist. */
export function activeContracts(universe: CoherenceUniverse): Total {
  return strictTotal(universe.events, (event) => event.open_interest_total);
}

/** Resting-order dollars across the watchlist, as the venue publishes them. */
export function liquidityDepth(universe: CoherenceUniverse): Total {
  return strictTotal(universe.events, (event) => event.liquidity_total);
}

/**
 * What buying one basket of every priceable family costs.
 *
 * Not `strictTotal`: a family with no basket is usually not a missing
 * measurement but an inapplicable question, and withholding the total because
 * two families are not mutually exclusive would dash a figure that is perfectly
 * well defined over the families that ARE baskets.
 */
export function basketValue(universe: CoherenceUniverse): BasketValue {
  let total = 0;
  let counted = 0;
  let notExclusive = 0;
  let unpriceable = 0;
  for (const event of universe.events) {
    if (!event.mutually_exclusive) {
      notExclusive += 1;
      continue;
    }
    const parsed = toCenticents(event.yes_ask_total);
    if (parsed == null) unpriceable += 1;
    else {
      total += parsed;
      counted += 1;
    }
  }
  return { totalCc: counted ? total : null, counted, notExclusive, unpriceable };
}

/**
 * The watchlist by asset class, largest first.
 *
 * Reads Kalshi's own `category` for the series, never a ticker prefix. A series
 * the exchange would not answer for groups under `null` rather than being
 * guessed at, and that group sorts last however large it is — it is an absence
 * of information, not a category competing with the others.
 */
export function categoryShares(universe: CoherenceUniverse): CategoryShare[] {
  const counts = new Map<string | null, number>();
  for (const event of universe.events) {
    // An empty string is not a category. The gateway sends the label it read;
    // anything falsy means it read none.
    const label = universe.categories[event.series_ticker] || null;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([category, families]) => ({ category, families }))
    .sort((a, b) =>
      a.category === null ? 1 : b.category === null ? -1 : b.families - a.families || a.category.localeCompare(b.category),
    );
}

/** The band edges alone, for a header row that has no family to read yet.
 *  One definition of where the cuts fall, so a table's columns and its cells
 *  can never disagree about which band is which. */

/** How many bands a family is cut into. Eight: readable at a glance, and fine
 *  enough that a tail and a mid-price outcome never share one. */
export const BAND_COUNT = 8;

/**
 * A family's open interest, banded by what its outcomes are offered at.
 *
 * The question is where the size sits: pennies in the tails, or real money
 * across the middle. Bands are fixed $0–$1 rather than scaled to the family, so
 * two families can be read against each other — the same choice `DollarBar` and
 * `BasketOverview` both record.
 *
 * A leg with no ask is NOT placed. It has no price to band by, and dropping it
 * into the first band would read as a penny outcome. Compare the summed
 * `contractsCc` against the family's own total — or call
 * `unplacedContractsCc` — to say how much did not fit.
 */
export function bandEdges(bands = BAND_COUNT): Array<{ lowCc: number; highCc: number }> {
  const width = Math.round(10_000 / bands);
  return Array.from({ length: bands }, (_, index) => ({
    lowCc: index * width,
    highCc: (index + 1) * width,
  }));
}

export function exposureBands(event: CoherenceEventView, bands = BAND_COUNT): Band[] {
  const width = Math.round(10_000 / bands);
  const placed = Array.from({ length: bands }, () => 0);
  for (const market of event.markets) {
    const ask = toCenticents(market.yes_ask);
    const size = toCenticents(market.open_interest);
    if (ask == null || size == null) continue;
    // A leg offered at exactly $1 belongs in the last band, not past the end.
    const index = Math.min(bands - 1, Math.max(0, Math.floor(ask / width)));
    placed[index] += size;
  }
  const denominator = toCenticents(event.open_interest_total);
  const edges = bandEdges(bands);
  return placed.map((contractsCc, index) => ({
    ...edges[index],
    contractsCc,
    // 0/0 is undefined, not zero. A never-traded family has no shares to show,
    // and printing 0% of nothing would say the size is elsewhere.
    share: denominator == null || denominator === 0 ? null : contractsCc / denominator,
  }));
}

/** Open interest this family carries that no band could place, or null when
 *  the family's own total is unknown. */
export function unplacedContractsCc(event: CoherenceEventView, bands = BAND_COUNT): number | null {
  const denominator = toCenticents(event.open_interest_total);
  if (denominator == null) return null;
  return denominator - exposureBands(event, bands).reduce((sum, band) => sum + band.contractsCc, 0);
}

/**
 * A dollar figure for display, or a dash.
 *
 * Four places, always: every Kalshi price is a four-decimal quantity and a
 * trailing zero the venue sent is a digit, not padding. `null` is a dash — and
 * `0` is `0.0000`, which is the whole point of keeping the two apart.
 */
export function dollarsLabel(totalCc: number | null): string {
  return fromCenticents(totalCc) ?? "—";
}

/**
 * A contract count for display, or a dash.
 *
 * Counts are quoted to two places (`open_interest_fp` is `"164.40"`), so the
 * four-place centicent form is padded for them. The last two digits are dropped
 * ONLY when they are both zero: a count that somehow carries finer precision
 * keeps all four places rather than having a digit trimmed off it, because a
 * silently shortened number is the same defect as a rounded one.
 */
export function contractsLabel(totalCc: number | null): string {
  const text = fromCenticents(totalCc);
  if (text == null) return "—";
  return text.endsWith("00") ? text.slice(0, -2) : text;
}
