import type { PortfolioPayload, SessionAttribution } from "@/lib/portfolio";
import type { RiskPosition } from "@/lib/portfolio-risk";

import { finite, positiveZero } from "./numbers";
import type { PnlLeg } from "./types";

// --------------------------------------------------------------------------
// Market leg
// --------------------------------------------------------------------------

export interface MarketLeg {
  leg: PnlLeg;
  unmeasuredSymbols: string[];
  referenceSymbol: string | null;
  referenceReturn: number | null;
}

export function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

/**
 * The generated market leg the sandbox supplies for itself.
 *
 * Read verbatim, never recomputed. The sandbox book's P&L is invented, so the
 * only internally consistent market leg is the one invented alongside it —
 * running measured betas against a real Binance return would attribute part of
 * a synthetic number to a real market move, and would additionally make the
 * panel render differently on the server and on the client.
 */
export function generatedMarketLeg(session: SessionAttribution): MarketLeg {
  const marketPnl = finite(session.market_pnl);
  const referenceSymbol = session.reference_symbol ?? null;
  const referenceReturn = finite(session.reference_return);

  if (marketPnl === null) {
    return {
      leg: {
        key: "market", label: "Market (beta)", value: null, basis: "withheld",
        note: "Withheld: this is the generated sandbox book and its attribution block supplies no "
          + "market leg, and measuring one against real prices would attribute a synthetic P&L to "
          + "a real market move.",
      },
      unmeasuredSymbols: [],
      // Nulled for the same reason `unmeasuredSymbols` is emptied above: the
      // panel's closing paragraph is gated on this pair alone, so leaving it
      // populated makes it print "the market leg uses X at Y%, applied through
      // each position's measured beta" about a leg that was withheld. Two of the
      // four withheld-market paths already null it; a field that survives on
      // some of them and not others is a field the reader cannot trust.
      referenceSymbol: null,
      referenceReturn: null,
    };
  }

  return {
    leg: {
      key: "market",
      label: "Market (beta)",
      value: positiveZero(marketPnl),
      basis: "generated",
      note: `Generated with the sandbox book from a ${referenceSymbol ?? "reference"} move of `
        + `${referenceReturn === null ? "an unstated size" : percent(referenceReturn)} — the book `
        + `is synthetic and so is this leg.`,
    },
    unmeasuredSymbols: [],
    referenceSymbol,
    referenceReturn,
  };
}

/**
 * Σ signedNotional × beta × the reference return, over the positions that have
 * a beta at all.
 *
 * `beta()` in `lib/portfolio-risk.ts` returns null rather than defaulting to 1,
 * and that null has to survive to here: a missing beta silently treated as 1
 * would move an unmeasurable instrument exactly with the reference and produce
 * a market leg indistinguishable from a measured one.
 *
 * Computed on *closing* exposure, because closing exposure is what the payload
 * carries. A book that traded during the session did not hold this exposure all
 * day, so the leg carries that error — which is one of the several things
 * living in the residual, and one of the several reasons it is not alpha.
 */
export function measuredMarketLeg(
  positions: RiskPosition[],
  betaBySymbol: Map<string, number | null>,
  referenceSymbol: string,
  referenceReturn: number,
): MarketLeg {
  const exposed = positions.filter((p) => finite(p.signedNotional) !== null && p.signedNotional !== 0);
  const measured = exposed.filter((p) => finite(betaBySymbol.get(p.symbol)) !== null);
  const unmeasuredSymbols = exposed
    .filter((p) => finite(betaBySymbol.get(p.symbol)) === null)
    .map((p) => p.symbol);

  // A flat book has no market exposure, and saying so is a measurement rather
  // than a guess — this is the one zero in this module that is a real answer.
  if (!exposed.length) {
    return {
      leg: {
        key: "market", label: "Market (beta)", value: 0, basis: "measured",
        note: `The book holds no position, so there is no exposure for the ${referenceSymbol} `
          + `move of ${percent(referenceReturn)} to act on.`,
      },
      unmeasuredSymbols: [],
      referenceSymbol,
      referenceReturn,
    };
  }

  // Every held name is unmeasurable. Zero here would read as "the market
  // contributed nothing", which is the opposite of "we could not tell".
  if (!measured.length) {
    return {
      leg: {
        key: "market", label: "Market (beta)", value: null, basis: "withheld",
        note: `Withheld: not one of the ${exposed.length} held positions — `
          + `${unmeasuredSymbols.join(", ")} — has a measurable beta against ${referenceSymbol}, `
          + `so any market leg here would be an assumption wearing the shape of a measurement.`,
      },
      // Empty, not `unmeasuredSymbols`. The field means "excluded from a market
      // leg that exists", and the panel spends a paragraph on it saying the leg
      // "excludes them and is understated by whatever they moved" — false when
      // there is no leg to understate. The no-reference-return path already
      // returns `[]` for exactly this reason; two withheld market legs that
      // disagree about it would make the field mean one thing on one path and
      // the opposite on the other. The names are in the note above instead.
      unmeasuredSymbols: [],
      // Nulled for the same reason `unmeasuredSymbols` is emptied above: the
      // panel's closing paragraph is gated on this pair alone, so leaving it
      // populated makes it print "the market leg uses X at Y%, applied through
      // each position's measured beta" about a leg that was withheld. Two of the
      // four withheld-market paths already null it; a field that survives on
      // some of them and not others is a field the reader cannot trust.
      referenceSymbol: null,
      referenceReturn: null,
    };
  }

  let value = 0;
  for (const position of measured) {
    value += position.signedNotional * (betaBySymbol.get(position.symbol) as number) * referenceReturn;
  }

  const complete = unmeasuredSymbols.length === 0;
  return {
    leg: {
      key: "market",
      label: "Market (beta)",
      value: positiveZero(value),
      basis: "measured",
      note: complete
        ? `Σ signed notional × measured beta × the ${referenceSymbol} session return of `
          + `${percent(referenceReturn)}, across all ${measured.length} held positions.`
        : `Σ signed notional × measured beta × the ${referenceSymbol} session return of `
          + `${percent(referenceReturn)}, across ${measured.length} of ${exposed.length} held `
          + `positions — ${unmeasuredSymbols.join(", ")} have no measurable beta, so this leg is `
          + `understated and their P&L falls into the residual instead.`,
    },
    unmeasuredSymbols,
    referenceSymbol,
    referenceReturn,
  };
}
