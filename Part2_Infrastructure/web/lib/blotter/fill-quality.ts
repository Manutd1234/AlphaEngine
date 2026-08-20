import { BlotterRow } from "./types";

// --------------------------------------------------------------------------
// Fill quality — cost decomposition
//
// What is derivable here, and what is not, traced to the gateway rather than
// assumed. `risk_proxy.py` computes `slippage_bps = (price - mark)/mark * 1e4`
// and `mark()` resolves through `tca_engine.py` to `consolidated_mid(symbol)`
// at decision time. So the reference price these figures are measured against
// IS M_decision, which makes `2 * |slippageBps|` the textbook effective spread
// exactly rather than a stand-in for it.
//
// Realized spread needs the mid a few minutes AFTER the fill. The gateway
// records mids in its `tca_snapshots` table but publishes no endpoint that
// serves them by timestamp, and `/api/tca` returns a live report rather than a
// historical one. It is therefore not derivable here, and the chart draws it
// as an empty column rather than at zero — a spread measured at zero and a
// spread nobody measured are opposite claims.
// --------------------------------------------------------------------------

/** Below this many priced fills a per-venue breakdown is noise, not evidence. */
export const MIN_PRICED_FILLS = 8;

/** Rendered under the spread chart. Exported so a test can pin that the
 *  withheld leg still explains itself rather than merely vanishing. */
export const REALIZED_SPREAD_WITHHELD =
  "Realized spread needs the consolidated mid a few minutes after each fill. The gateway "
  + "records mids in its tca_snapshots table but publishes no endpoint that serves them by "
  + "timestamp, so no post-trade reference exists here. The column is drawn empty rather than "
  + "at zero: a spread measured at zero and a spread nobody measured are opposite claims.";

/**
 * Effective spread in bps for one fill: `2 x |slippage|`.
 *
 * Null in, null out. A fill nobody priced has no effective spread, and zero
 * would claim it traded exactly at the mid.
 */
export function effectiveSpreadBps(row: BlotterRow): number | null {
  if (row.slippageBps == null || !Number.isFinite(row.slippageBps)) return null;
  return 2 * Math.abs(row.slippageBps);
}

/** Explicit cost in bps. Null unless BOTH a fee and a non-zero notional exist. */
export function feeBps(row: BlotterRow): number | null {
  if (row.feeUsd == null || row.notional == null) return null;
  if (!Number.isFinite(row.feeUsd) || !Number.isFinite(row.notional) || row.notional === 0) return null;
  return (row.feeUsd / Math.abs(row.notional)) * 1e4;
}

export interface VenueQuality {
  venue: string;
  fills: number;
  notional: number;
  /** Mean of 2x|slip| over this venue's priced fills. */
  effectiveSpreadBps: number | null;
  meanFeeBps: number | null;
  /** Signed — the sign is the maker/taker story the absolute value hides. */
  meanSlippageBps: number | null;
  improvedFills: number;
  /** Always null. See REALIZED_SPREAD_WITHHELD. */
  realizedSpreadBps: null;
}

export interface VenueMix {
  venues: VenueQuality[];
  totalFills: number;
  /**
   * Fills carrying no venue tag. Reported rather than absorbed, so the donut's
   * denominator and the KPI row's fill count reconcile on screen.
   */
  unattributed: number;
}

const mean = (values: number[]): number | null =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

/**
 * Fill quality grouped by venue.
 *
 * NOTE a per-venue *fill ratio* is not computable and this does not pretend
 * otherwise: `venue` is non-null only on fills, because an order that never
 * filled never reached a venue. What this returns is the venue MIX of fills.
 */
export function venueQuality(rows: BlotterRow[]): VenueMix {
  const fills = rows.filter((r) => r.status === "FILLED");
  const buckets = new Map<string, BlotterRow[]>();
  let unattributed = 0;

  for (const row of fills) {
    if (!row.venue) {
      unattributed += 1;
      continue;
    }
    const bucket = buckets.get(row.venue);
    if (bucket) bucket.push(row);
    else buckets.set(row.venue, [row]);
  }

  const venues = [...buckets.entries()]
    .map(([venue, bucket]) => {
      // The denominator for each mean is the count that HAS the measure, never
      // the fill count — averaging over rows that carry no figure would drag
      // every mean toward zero.
      const spreads = bucket.map(effectiveSpreadBps).filter((v): v is number => v != null);
      const fees = bucket.map(feeBps).filter((v): v is number => v != null);
      const slips = bucket.map((r) => r.slippageBps).filter((v): v is number => v != null);
      return {
        venue,
        fills: bucket.length,
        notional: bucket.reduce((sum, r) => sum + Math.abs(r.notional ?? 0), 0),
        effectiveSpreadBps: mean(spreads),
        meanFeeBps: mean(fees),
        meanSlippageBps: mean(slips),
        improvedFills: slips.filter((v) => v < 0).length,
        realizedSpreadBps: null as null,
      };
    })
    .sort((a, b) => b.fills - a.fills);

  return { venues, totalFills: fills.length, unattributed };
}

export interface PriceImprovement {
  /** Priced fills considered. */
  n: number;
  /** Fills that executed inside the reference mid. */
  improved: number;
  /** Null when n === 0 — "no fills" and "no improvement" are different facts. */
  rate: number | null;
  /** Mean improvement across improved fills, as a positive number of bps. */
  meanBps: number | null;
}

/**
 * Fills that beat the reference mid.
 *
 * Negative signed slippage is a gateway-authored signal, not a construct:
 * `_maker_fill` in risk_proxy.py documents that a resting fill's slippage is
 * "usually negative — price improvement against the mark".
 */
export function priceImprovement(rows: BlotterRow[]): PriceImprovement {
  const slips = rows
    .filter((r) => r.status === "FILLED")
    .map((r) => r.slippageBps)
    .filter((v): v is number => v != null);
  const improved = slips.filter((v) => v < 0);
  return {
    n: slips.length,
    improved: improved.length,
    rate: slips.length ? improved.length / slips.length : null,
    meanBps: improved.length ? mean(improved.map(Math.abs)) : null,
  };
}
