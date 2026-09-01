import type { CoherenceDispersion } from "./types-lab";
import { toCenticents } from "./fixed-point";

/** A maker-to-maker range needs two usable answers and both quoted endpoints. */
export function hasDrawableMakerRange(row: CoherenceDispersion): boolean {
  return row.usable >= 2
    && row.spread != null
    && toCenticents(row.lowest) != null
    && toCenticents(row.highest) != null;
}

/** Stable per-request identity, with a rolling-deploy fallback for older rows. */
export function makerPanelKey(row: CoherenceDispersion, index: number): string {
  return row.rfq_id?.trim() || `${row.market_ticker}:${index}`;
}

/** Distinguish two open RFQs on one ticker without exposing the private RFQ id. */
export function makerPanelLabel(
  row: CoherenceDispersion,
  index: number,
  rows: CoherenceDispersion[],
): string {
  const peers = rows.filter((candidate) => candidate.market_ticker === row.market_ticker);
  if (peers.length < 2) return row.market_ticker;
  const ordinal = rows.slice(0, index + 1)
    .filter((candidate) => candidate.market_ticker === row.market_ticker).length;
  return `${row.market_ticker}, request ${ordinal}`;
}
