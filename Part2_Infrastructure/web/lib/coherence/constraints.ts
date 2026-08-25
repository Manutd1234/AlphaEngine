/**
 * The inequalities a family's own quotes must satisfy, and the room each has left.
 *
 * WHY THE BROWSER DERIVES THESE when the gateway already returns a verdict.
 * The Proof view's only drawing was a two-row bar of `rows_tested` against
 * `rows_untestable`, which on the family a reader opens is 189 against 0 — a
 * full-width bar and a 1px hairline, the hairline being `ValueStrip`'s floor for
 * a zero value, with nothing saying so because that strip excludes exact zeros
 * from its own floor note. Two numbers the certificate already prints in words,
 * drawn as a picture of themselves.
 *
 * What a proof owes a reader is not how many rows were checked but HOW CLOSE
 * ANY OF THEM CAME TO FAILING. That is a quantity per constraint, it is a shape
 * rather than a number, and it does not go flat when the answer is the usual
 * one. It is also computable here: every field it needs is already on the
 * universe read the section is built from, so the figure that draws it fetches
 * nothing.
 *
 * THE TWO CENSUSES ARE DIFFERENT AND THE FIGURE MUST SAY WHICH IT DRAWS. The
 * gateway's programme works over INTERVALS on one side of the book — "189
 * intervals cut by 188 strike(s)", bid basis — and reports `rows_untestable: 0`.
 * This works over QUOTED PAIRS and needs both sides of each book it touches.
 * Measured on the live tape, `KXBTCD-26AUG2514` carries 188 markets: 121 with a
 * yes bid, 83 with an ask, 16 with both. So the programme sees nothing
 * untestable and this sees 344, and both are honest about different questions.
 * Neither number may be printed under the other's name.
 *
 * Centicents throughout. These are money, and `0.1 + 0.2` is not `0.3`.
 */

import { DOLLAR_CC, toCenticents } from "./fixed-point";
import type { CoherenceEventView, CoherenceMarketView } from "./types";

export type ConstraintKind = "book" | "ladder" | "partition";

export interface Constraint {
  kind: ConstraintKind;
  /** What must hold, in words a reader can check against the drawing. */
  claim: string;
  /** The market or pair it is about. */
  subject: string;
  /** Room left before it fails, in centicents. Negative is an arbitrage. */
  slack: number;
  /**
   * Whether this one FAILS, carried rather than derived at every reading site.
   *
   * `slack < 0` is one comparison and the temptation is to leave it to the
   * caller, but the figure asks it per mark, the key asks it per kind and the
   * summary asks it per set — three sites, one of which is inside a render
   * loop, and three chances to write `<=` once.
   */
  violated: boolean;
}

export interface ConstraintSet {
  /** Every constraint that could be evaluated, tightest first. */
  tested: readonly Constraint[];
  /** How many could not be, because a side of a book is unquoted. */
  untestable: number;
  /** Why, in the venue's own words where it gave them. Null when none were skipped. */
  untestableReason: string | null;
  /** How many of the tested ones fail. */
  violations: number;
  /** The tightest slack, or null when nothing could be tested. */
  tightest: number | null;
  /** How many of each kind were tested, for the figure's key. */
  kinds: Record<ConstraintKind, number>;
}

/**
 * The yes side's bid, read through the no side when the yes side is silent.
 *
 * `no_ask` and `yes_bid` are the same statement about the same market — a
 * resting bid to buy yes at p IS an offer to sell no at 1 − p — and the venue
 * publishes whichever side the order actually sat on. Reading only the literal
 * `yes_bid` is how 172 of 188 live markets look unquoted when every one of them
 * is quoted.
 */
function yesBid(market: CoherenceMarketView): number | null {
  const direct = toCenticents(market.yes_bid);
  if (direct != null) return direct;
  const noAsk = toCenticents(market.no_ask);
  return noAsk == null ? null : DOLLAR_CC - noAsk;
}

/** The yes side's offer, read through the no side's bid for the same reason. */
function yesAsk(market: CoherenceMarketView): number | null {
  const direct = toCenticents(market.yes_ask);
  if (direct != null) return direct;
  const noBid = toCenticents(market.no_bid);
  return noBid == null ? null : DOLLAR_CC - noBid;
}

/** The strike this market is cut at, as a number for ORDERING only. */
function strikeOf(market: CoherenceMarketView): number | null {
  const raw = market.strike_kind === "less" ? market.cap_strike : market.floor_strike;
  if (raw == null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

interface Working {
  tested: Constraint[];
  untestable: number;
  reasons: string[];
}

/**
 * No crossed book: what a market offers may not be below what it bids.
 *
 * The one constraint every market carries whatever the family's shape is, and
 * the only one that is an arbitrage inside a single ticker — buy the yes at the
 * offer, sell it at the higher bid, keep the difference against no risk at all.
 */
function bookConstraints(markets: readonly CoherenceMarketView[], into: Working): void {
  for (const market of markets) {
    const bid = yesBid(market);
    const ask = yesAsk(market);
    if (bid == null || ask == null) {
      into.untestable += 1;
      if (market.unquoted_reason) into.reasons.push(market.unquoted_reason);
      continue;
    }
    into.tested.push({
      kind: "book",
      claim: "the offer may not sit below the bid",
      subject: market.yes_sub_title || market.ticker,
      slack: ask - bid,
      violated: ask - bid < 0,
    });
  }
}

/**
 * A threshold ladder is monotone: a strictly smaller event may not cost more.
 *
 * For a `greater` ladder P(X ≥ k) falls as k rises, so buying the LOWER strike
 * at its offer and selling the HIGHER at its bid must not be free money. For a
 * `less` ladder P(X ≤ k) rises with k and the pair reads the other way round.
 *
 * Only when every market in the family is the same threshold kind. A family
 * that mixes `between` buckets with open ends is a partition, not a ladder, and
 * pairing its rows would compare events that are not nested.
 */
function ladderConstraints(markets: readonly CoherenceMarketView[], into: Working): void {
  const kinds = new Set(markets.map((market) => market.strike_kind));
  if (kinds.size !== 1) return;
  const kind = [...kinds][0];
  if (kind !== "greater" && kind !== "less") return;

  const rungs = markets
    .map((market) => ({ market, strike: strikeOf(market) }))
    .filter((rung): rung is { market: CoherenceMarketView; strike: number } => rung.strike != null)
    .sort((a, b) => a.strike - b.strike);

  for (let index = 0; index + 1 < rungs.length; index += 1) {
    const lower = rungs[index].market;
    const higher = rungs[index + 1].market;
    // The cheaper leg is the one whose event CONTAINS the other's.
    const [wider, narrower] = kind === "greater" ? [lower, higher] : [higher, lower];
    const ask = yesAsk(wider);
    const bid = yesBid(narrower);
    if (ask == null || bid == null) {
      into.untestable += 1;
      continue;
    }
    into.tested.push({
      kind: "ladder",
      claim: "a strictly smaller event may not bid above this one's offer",
      subject: `${wider.yes_sub_title || wider.ticker} against ${narrower.yes_sub_title || narrower.ticker}`,
      slack: ask - bid,
      violated: ask - bid < 0,
    });
  }
}

/**
 * A partition costs a dollar: one leg settles, so the set is worth exactly $1.
 *
 * Two constraints and not one, because a partition is bounded from both sides.
 * Buying every leg for less than a dollar wins a dollar; selling every leg for
 * more than a dollar owes a dollar. Only for a family the VENUE marks mutually
 * exclusive — the desk may not decide that a set of buckets covers the outcome
 * space, because a set that nearly does looks identical and is not an
 * arbitrage.
 */
function partitionConstraints(event: CoherenceEventView, into: Working): void {
  if (!event.mutually_exclusive) return;
  const bids = event.markets.map(yesBid);
  const asks = event.markets.map(yesAsk);

  if (bids.every((bid): bid is number => bid != null)) {
    const slack = DOLLAR_CC - bids.reduce((total, bid) => total + bid, 0);
    into.tested.push({
      kind: "partition",
      claim: "sell every leg and the set may not raise more than the dollar it owes",
      subject: `all ${bids.length} legs, at their bids`,
      slack,
      violated: slack < 0,
    });
  } else {
    into.untestable += 1;
  }

  if (asks.every((ask): ask is number => ask != null)) {
    const slack = asks.reduce((total, ask) => total + ask, 0) - DOLLAR_CC;
    into.tested.push({
      kind: "partition",
      claim: "buy every leg and the set may not cost less than the dollar it pays",
      subject: `all ${asks.length} legs, at their offers`,
      slack,
      violated: slack < 0,
    });
  } else {
    into.untestable += 1;
  }
}

/** The most common reason a side was unquoted, in the venue's own words. */
function commonest(reasons: readonly string[]): string | null {
  if (!reasons.length) return null;
  const counts = new Map<string, number>();
  for (const reason of reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export function constraintsOf(event: CoherenceEventView): ConstraintSet {
  const working: Working = { tested: [], untestable: 0, reasons: [] };
  bookConstraints(event.markets, working);
  ladderConstraints(event.markets, working);
  partitionConstraints(event, working);

  // TIGHTEST FIRST, which is the reading a proof owes. The leftmost mark is the
  // constraint the family came closest to breaking, and the curve to its right
  // is how much room the rest had — a shape, not a number, and one that stays a
  // shape on the ordinary answer.
  const tested = [...working.tested].sort((a, b) => a.slack - b.slack);
  const kinds: Record<ConstraintKind, number> = { book: 0, ladder: 0, partition: 0 };
  for (const constraint of tested) kinds[constraint.kind] += 1;

  return {
    tested,
    untestable: working.untestable,
    untestableReason: working.untestable
      ? commonest(working.reasons) ?? "a side of the book carried no resting order"
      : null,
    violations: tested.filter((constraint) => constraint.violated).length,
    tightest: tested.length ? tested[0].slack : null,
    kinds,
  };
}
