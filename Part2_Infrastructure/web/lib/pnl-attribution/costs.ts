import type { PortfolioPayload, SessionAttribution } from "@/lib/portfolio";

import { finite, positiveZero } from "./numbers";
import type { SessionRead } from "./session";
import type { PnlLeg } from "./types";

// --------------------------------------------------------------------------
// Cost legs
// --------------------------------------------------------------------------

export const ABSENT_COST_NOTE =
  "Withheld: this gateway sent no session attribution block, and the lifetime totals it did send "
  + "cover every session since the audit log was opened — subtracting those from one day's P&L "
  + "would report a loss the desk did not take.";

export function withheldCostNote(read: SessionRead, book: PortfolioPayload, what: string): string {
  if (read.state === "mismatch") {
    return `Withheld: the gateway's attribution block covers ${read.blockDate} but this book's `
      + `session is ${book.session_date}, so those ${what} belong to a different day.`;
  }
  if (read.state === "inconsistent") {
    return `Withheld: this book and its attribution block disagree about whether they are `
      + `generated or audited, and ${what} cannot be read off a contradiction.`;
  }
  return ABSENT_COST_NOTE;
}

export interface CostLegs {
  slippage: PnlLeg;
  fees: PnlLeg;
  lowerBound: boolean;
}

export function costLegs(read: SessionRead, book: PortfolioPayload): CostLegs {
  if (read.state !== "ok") {
    return {
      slippage: {
        key: "slippage", label: "Slippage", value: null, basis: "withheld",
        note: withheldCostNote(read, book, "execution costs"),
      },
      fees: {
        key: "fees", label: "Fees", value: null, basis: "withheld",
        note: withheldCostNote(read, book, "fees"),
      },
      lowerBound: false,
    };
  }

  const { session, basis } = read;
  const slippageCost = finite(session.slippage_cost);
  const fees = finite(session.fees);
  const unmeasured = finite(session.fills_without_slippage) ?? 0;

  // The two counts default independently, so a block can report fills it never
  // counted — and `${unmeasured} of ${fills}` then renders the impossible
  // "4 of 0 fills". A fill count is only usable as a denominator when it is a
  // positive number; anything else means the block never stated one.
  const fills = finite(session.fills);
  const counted = fills !== null && fills > 0 ? fills : null;

  /**
   * Not one fill in the session carried a measured slippage.
   *
   * `session_costs` sums `COALESCE(notional,0) * COALESCE(slippage_bps,0)`, so
   * this session reports `slippage_cost: 0.0` — a sum over nothing, not a
   * measurement of nothing. `_maker_fill` records `slippage_bps = None` whenever
   * there is no mark, and it is the only Fill construction that writes NULL, so
   * a single mark outage across a maker-filled session produces exactly this.
   * Drawing it as an audited leg of −0 would say execution was free on a session
   * where nobody could measure what execution cost, which is the one collapse
   * this whole module exists to prevent.
   */
  const noneMeasured = counted !== null && unmeasured >= counted;

  // A lower bound is a measurement whose error has a known *direction*: some of
  // the cost was measured, the rest is missing, and the truth is at least this.
  // That claim needs at least one measured fill to stand on, so the all-NULL
  // session above is withheld rather than described as a bound on itself.
  const lowerBound = slippageCost !== null && unmeasured > 0 && !noneMeasured;

  const day = typeof session.session_date === "string" && session.session_date
    ? session.session_date
    : null;
  const source = basis === "generated"
    ? "Generated with the sandbox book"
    : day === null
      ? "Replayed from audited fills"
      : `Replayed from audited fills for session ${day}`;
  // `readSession` only rejects a date that *disagrees* with the book's. An
  // undated block passes, and naming the book's own session in its note would
  // put a claim in the block's mouth that the block never made — the same class
  // of fabrication as reading its silence about slippage as a zero.
  const undated = basis === "audited" && day === null
    ? ` The block names no session date, so these costs could not be checked against this book's `
      + `session of ${book.session_date}.`
    : "";

  // The lower-bound sentence, in the two forms the block's own counts allow: with
  // a denominator when it stated a usable fill count, and without one when it did
  // not. The bound itself holds either way — at least this many fills went
  // unmeasured — so the missing denominator weakens the sentence, not the claim.
  const boundClause = !lowerBound
    ? ""
    : counted === null
      ? ` ${unmeasured} fills carry no measured slippage — the block states no fill count to weigh `
        + `that against — so this is a lower bound on what execution actually cost.`
      : ` ${unmeasured} of ${counted} fills carry no measured slippage, so this is a lower bound `
        + `on what execution actually cost.`;

  const slippageNote = slippageCost === null
    ? "Withheld: the session block carries no slippage figure, so the gap between the decision "
      + "price and the fill price was never measured for this session."
    : noneMeasured
      ? `Withheld: not one of the ${counted} fills this session carries a measured slippage, so `
        + `the block's Σ notional × slippage bps is a sum over nothing rather than a cost of zero `
        + `— the gap between decision price and fill price went unmeasured on every fill, and `
        + `reporting that as free execution would be a fabricated measurement.`
      : `${source}: Σ notional × slippage bps ÷ 10,000, already inside day P&L because paper fills `
        + `print at the route VWAP rather than at mid.${boundClause}${undated}`;

  return {
    slippage: {
      key: "slippage",
      label: "Slippage",
      // Negated: the block reports cost as a positive number, and every leg
      // here is signed as a contribution to P&L so the four of them add up.
      value: slippageCost === null || noneMeasured ? null : positiveZero(-slippageCost),
      basis: slippageCost === null || noneMeasured ? "withheld" : basis,
      note: slippageNote,
    },
    fees: {
      key: "fees",
      label: "Fees",
      value: fees === null ? null : positiveZero(-fees),
      basis: fees === null ? "withheld" : basis,
      note: fees === null
        ? "Withheld: the session block carries no fee total for this session."
        : `${source}: already inside day P&L via \`realized_pnl -= fee\` on every fill, and `
          + `counted exactly once here.${undated}`,
    },
    lowerBound,
  };
}
