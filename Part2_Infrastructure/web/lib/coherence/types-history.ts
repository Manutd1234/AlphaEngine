/**
 * The browser's view of the recorded tape, where `types-lab.ts` runs out of room.
 *
 * A third module rather than a shave: `types-lab.ts` sits at 391 of the 400-line
 * house ceiling, and the rule is to split. The gateway made the same split for
 * the same reason on the same day — `modules/schemas_coherence_history.py` —
 * and the seam is identical on both sides, which is the point: everything here
 * describes a series read back off `book_snapshots`, the recorder's own table.
 *
 * FOUR STATES, NOT AN EMPTY LIST. Every one of them reaches a reader as "no
 * data" otherwise, and only one of them is normal:
 *
 *     unavailable    the tape would not open. An outage.
 *     unconfigured   the recorder never ran here; nothing was ever written.
 *     empty          the tape is real and holds nothing for THIS market.
 *     ok             a series.
 *
 * `RfqPane`'s four-state table defends the same distinction for the signed
 * channel, and it exists there because those four kept being confused.
 */

/** Narrow an unknown payload to an object before reading fields off it.
 *  A local copy of `types-lab`'s own three-line helper, because exporting it
 *  from there would widen that module's surface to buy nothing. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** One recorded book, as prices rather than ladders. */
export interface CoherenceBookHistoryPoint {
  ts_ns: number;
  ticker: string;
  event_ticker: string | null;
  series_ticker: string | null;
  /** What the venue actually sent. */
  best_yes_bid: string | null;
  best_no_bid: string | null;
  /**
   * A dollar less the NO bid — DERIVED, and named so nothing mistakes it for a
   * quote. Null whenever the NO side was unquoted: a market with no NO bid has
   * no implied ask, and a zero there would be a free option.
   */
  implied_yes_ask: string | null;
  depth: string;
  source: string;
}

/** One market's recorded quotes, oldest first so a chart can plot it. */
export interface CoherenceBookHistory {
  state: string;
  ticker: string | null;
  points: CoherenceBookHistoryPoint[];
  /** What the tape DOES hold, when it holds nothing for the ticker asked for. */
  recorded: string[];
  notes: string[];
}

export function isCoherenceBookHistory(value: unknown): value is CoherenceBookHistory {
  return isRecord(value) && typeof value.state === "string" && Array.isArray(value.points);
}


/** The three components at one price, for a fixed size and fill count. */
export interface CoherenceFeeCurvePoint {
  price: string;
  trade_fee: string;
  rounding_fee: string;
  rebate: string;
  net: string;
  notional: string;
  /** Null only at a price of zero, which the route excludes. */
  as_fraction_of_notional: string | null;
}

/** The fee at every price the venue quotes, computed by the gateway's kernel. */
export interface CoherenceFeeCurve {
  state: string;
  contracts: string;
  fills: number;
  multiplier: string;
  balance_precision: string;
  points: CoherenceFeeCurvePoint[];
  notes: string[];
}

export function isCoherenceFeeCurve(value: unknown): value is CoherenceFeeCurve {
  return isRecord(value) && typeof value.state === "string" && Array.isArray(value.points);
}
