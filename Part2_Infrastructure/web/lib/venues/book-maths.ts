import { Level } from "./types";

// --------------------------------------------------------------------------- //
// Book maths (identical semantics to the Python gateway)
// --------------------------------------------------------------------------- //
export function depthUsd(levels: Level[], depth = 20): number {
  return levels.slice(0, depth).reduce((acc, [p, q]) => acc + p * q, 0);
}

/** Default band for depth/imbalance measurement, in basis points either side of mid. */
export const DEPTH_BAND_BPS = 10;

/**
 * Notional resting within `bps` of mid.
 *
 * Counting "the top N levels" is not comparable across venues or symbols: N
 * levels of a merged two-venue book spans a far narrower price band than N
 * levels of one venue, and a fine-tick instrument packs more levels into the
 * same band than a coarse one. Depth inside a *price* band is invariant to both,
 * which is what makes bid-vs-ask and venue-vs-venue comparisons mean anything.
 */
export function depthWithinBps(
  levels: Level[],
  mid: number | null,
  side: "bid" | "ask",
  bps = DEPTH_BAND_BPS,
): number {
  if (!mid) return 0;
  const bound = side === "bid" ? mid * (1 - bps / 1e4) : mid * (1 + bps / 1e4);
  let total = 0;
  for (const [price, size] of levels) {
    if (side === "bid" ? price < bound : price > bound) break;
    total += price * size;
  }
  return total;
}

/** Depth imbalance inside the band: +1 all bid, -1 all ask, 0 balanced. */
export function bandImbalance(
  bids: Level[],
  asks: Level[],
  mid: number | null,
  bps = DEPTH_BAND_BPS,
): number | null {
  const b = depthWithinBps(bids, mid, "bid", bps);
  const a = depthWithinBps(asks, mid, "ask", bps);
  return b + a > 0 ? (b - a) / (b + a) : null;
}

export function spreadBps(bid: number | null, ask: number | null): number | null {
  if (!bid || !ask) return null;
  const mid = (bid + ask) / 2;
  return mid > 0 ? ((ask - bid) / mid) * 1e4 : null;
}
