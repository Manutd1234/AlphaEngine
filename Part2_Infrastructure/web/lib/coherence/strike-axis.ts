/**
 * Where a family's legs sit on a strike axis — one placement rule, two figures.
 *
 * `LadderPrices` draws both sides of every leg against the dollar; `LegSizes`
 * draws the same legs' three size fields under it. They share an x extent, so
 * they must share the rule that decides it: a strike computed one way in one
 * file and another way in the other would put the same leg at two pixels and
 * the pair would read as two families.
 *
 * Split out of `LadderPrices.tsx` on 2026-08-26, when the second caller
 * arrived. Nothing here draws.
 */

import type { CoherenceMarketView } from "@/lib/coherence/types";

/** A fixed-point wire string as a number, or null when it is not one. */
export function money(raw: string | null): number | null {
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Where a leg sits on the strike axis.
 *
 * A `between` leg spans two strikes and is placed at its midpoint; the
 * one-sided kinds have only the bound they are named for. A leg whose bounds
 * are both absent has no position and is counted rather than placed.
 */
export function strikeOf(market: CoherenceMarketView): number | null {
  const floor = money(market.floor_strike);
  const cap = money(market.cap_strike);
  if (floor !== null && cap !== null) return (floor + cap) / 2;
  return floor ?? cap;
}

export interface PlacedLeg {
  market: CoherenceMarketView;
  strike: number;
}

/**
 * The legs that can be placed, in strike order, with the extent they span and
 * a count of the ones that could not be.
 *
 * `lo` and `hi` are null when nothing could be placed — never 0, which would
 * be a strike.
 */
export function placeStrikes(markets: readonly CoherenceMarketView[]): {
  placed: PlacedLeg[];
  unplaced: number;
  lo: number | null;
  hi: number | null;
} {
  const placed: PlacedLeg[] = [];
  for (const market of markets) {
    const strike = strikeOf(market);
    if (strike !== null) placed.push({ market, strike });
  }
  placed.sort((a, b) => a.strike - b.strike);
  const strikes = placed.map((leg) => leg.strike);
  return {
    placed,
    unplaced: markets.length - placed.length,
    lo: strikes.length ? Math.min(...strikes) : null,
    hi: strikes.length ? Math.max(...strikes) : null,
  };
}
