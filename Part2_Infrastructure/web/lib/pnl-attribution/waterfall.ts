import type { PortfolioPayload } from "@/lib/portfolio";
import type { RiskPosition } from "@/lib/portfolio-risk";

import { costLegs, withheldCostNote } from "./costs";
import { generatedMarketLeg, measuredMarketLeg } from "./market";
import type { MarketLeg } from "./market";
import { finite, positiveZero, sessionReturn } from "./numbers";
import { readSession } from "./session";
import { RECONCILIATION_TOLERANCE } from "./types";
import type { LegBasis, PnlLeg, PnlWaterfall } from "./types";

// --------------------------------------------------------------------------
// The waterfall
// --------------------------------------------------------------------------

const RESIDUAL_NOTE =
  "The plug: day P&L less every other leg, holding genuine idiosyncratic moves together with "
  + "intraday trading P&L, beta-estimation error, and the error from computing the market leg on "
  + "closing rather than opening exposure — which is why it is called a residual and not alpha.";

const UNATTRIBUTED_NOTE =
  "Day P&L less whatever costs could be measured. With no market leg there is nothing to "
  + "residualise against, so this remainder is not attributed to anything — calling it a residual "
  + "would be day P&L wearing a more flattering name.";

/**
 * The four-bar decomposition of one session's P&L.
 *
 * Returns null only when the payload cannot support any decomposition at all —
 * a missing or non-finite equity block. Every other degradation is expressed as
 * a withheld leg, because "the gateway is older than this feature" and "the
 * gateway is broken" must not render the same.
 */
export function buildPnlWaterfall(input: {
  book: PortfolioPayload;
  positions: RiskPosition[];
  betaBySymbol: Map<string, number | null>;
  referenceSymbol: string;
  referenceReturn: number | null;
}): PnlWaterfall | null {
  const { book, positions, betaBySymbol, referenceSymbol, referenceReturn } = input;

  const equity = book?.equity;
  const dayPnl = finite(equity?.daily_pnl);
  const startEquity = finite(equity?.start_of_day);
  const endEquity = finite(equity?.current);
  if (dayPnl === null || startEquity === null || endEquity === null) return null;

  const sandbox = book.sandbox === true;
  const read = readSession(book, sandbox);
  const { slippage, fees, lowerBound } = costLegs(read, book);

  // The sandbox never runs the beta path — not even when a reference return is
  // available, which it usually is, since the market data routes answer
  // regardless of whether the gateway does.
  const market: MarketLeg = sandbox
    ? read.state === "ok"
      ? generatedMarketLeg(read.session)
      : {
          leg: {
            key: "market", label: "Market (beta)", value: null, basis: "withheld",
            note: "Withheld: this is the generated sandbox book, and attributing part of a "
              + "generated P&L to a real measured market move would be a fabricated attribution.",
          },
          unmeasuredSymbols: [],
          referenceSymbol: null,
          referenceReturn: null,
        }
    : referenceReturn === null || finite(referenceReturn) === null
      ? {
          leg: {
            key: "market", label: "Market (beta)", value: null, basis: "withheld",
            note: `Withheld: the ${referenceSymbol} session return could not be measured against `
              + `this book's session, so there is no reference move to apply the betas to.`,
          },
          unmeasuredSymbols: [],
          // Nulled alongside the return rather than left standing. The panel
          // gates its closing paragraph on this pair, and a symbol with no move
          // beside it still reads as "the market leg uses BTCUSDT" — naming a
          // reference for an attribution that was withheld. The symbol is
          // already in the note above, where it explains what could not be
          // measured instead of implying something was.
          referenceSymbol: null,
          referenceReturn: null,
        }
      : measuredMarketLeg(positions, betaBySymbol, referenceSymbol, referenceReturn);

  const knownCosts = (slippage.value ?? 0) + (fees.value ?? 0);

  // Named individually, because a cost leg that *was* measured has already been
  // subtracted out and the remainder is not carrying it. A note that blames both
  // legs whenever either is missing tells a reader to mentally re-add a number
  // that is already accounted for — double-counting the one leg the module got
  // right. Fees first so the pair reads as "fee and slippage".
  const withheldCosts = [
    fees.value === null ? "fee" : null,
    slippage.value === null ? "slippage" : null,
  ].filter((name): name is string => name !== null);
  const absorbed = withheldCosts.length
    ? `${withheldCosts.join(" and ")} ${withheldCosts.length > 1 ? "legs" : "leg"}`
    : null;

  // The remainder, and what it is allowed to be called. With a market leg it is
  // a residual; without one the same arithmetic is just day P&L minus costs,
  // and it gets a name that admits it.
  const remainder = market.leg.value === null
    ? {
        key: "unattributed" as const,
        label: "Unattributed",
        value: positiveZero(dayPnl - knownCosts),
        basis: "derived" as LegBasis,
        note: UNATTRIBUTED_NOTE
          + (absorbed ? ` It also absorbs the withheld ${absorbed}.` : ""),
      }
    : {
        key: "residual" as const,
        label: "Residual",
        value: positiveZero(dayPnl - market.leg.value - knownCosts),
        basis: "derived" as LegBasis,
        note: RESIDUAL_NOTE
          + (absorbed
            ? ` It is also absorbing the withheld ${absorbed}, which `
              + `${withheldCosts.length > 1 ? "are" : "is"} inside day P&L but could not be `
              + `separated out.`
            : ""),
      };

  const legs: PnlLeg[] = [market.leg, remainder, slippage, fees];

  // `complete` is a statement about arithmetic closure — every leg present, and
  // the four of them summing to the number they decompose. It is deliberately
  // *not* a quality claim: a waterfall can be complete while its market leg is
  // understated by an unmeasurable beta. `unmeasuredSymbols` and
  // `slippageIsLowerBound` carry that, and a caller that wants "trustworthy"
  // rather than "closed" has to read all three.
  const present = legs.every((leg) => leg.value !== null);
  const total = legs.reduce((acc, leg) => acc + (leg.value ?? 0), 0);
  const complete = present && Math.abs(total - dayPnl) <= RECONCILIATION_TOLERANCE;

  const realized = finite(equity?.realized_pnl);
  const unrealized = finite(equity?.unrealized_pnl);

  // Every figure that leaves here goes through `positiveZero`, not just the leg
  // values: the header renders `dayPnl` with the same `>= 0` colour test the
  // table uses on a leg, so a −0 day P&L prints "$-0" in the gain colour there
  // too. One rule for every number the module emits is also one rule to state.
  return {
    startEquity: positiveZero(startEquity),
    endEquity: positiveZero(endEquity),
    dayPnl: positiveZero(dayPnl),
    legs,
    unmeasuredSymbols: market.unmeasuredSymbols,
    carriedMarkToMarket:
      realized === null || unrealized === null
        ? null
        : positiveZero(dayPnl - (realized + unrealized)),
    referenceSymbol: market.referenceSymbol,
    referenceReturn: market.referenceReturn,
    slippageIsLowerBound: lowerBound,
    complete,
  };
}
