// --------------------------------------------------------------------------
// Output
// --------------------------------------------------------------------------

export type LegBasis = "measured" | "audited" | "derived" | "generated" | "withheld";

export interface PnlLeg {
  key: "market" | "residual" | "unattributed" | "slippage" | "fees";
  label: string;
  /**
   * Signed as a contribution to day P&L, so the legs sum to `dayPnl` and a
   * waterfall can draw them without re-deciding what a cost means: slippage and
   * fees are therefore **negative** in the ordinary case.
   *
   * Null when the leg cannot be computed truthfully. NEVER 0 as a stand-in — a
   * leg measured at zero and a leg nobody could measure are opposite claims.
   */
  value: number | null;
  basis: LegBasis;
  /** One sentence naming where the number came from, or why it is absent. */
  note: string;
}

export interface PnlWaterfall {
  startEquity: number;
  endEquity: number;
  dayPnl: number;
  legs: PnlLeg[];
  /**
   * Held symbols excluded from the market leg because their beta could not be
   * measured. Non-empty means the market leg is understated by exactly their
   * exposure, and the residual is carrying it.
   *
   * Therefore **empty whenever the market leg is withheld**, on every path that
   * withholds it. There is no leg for those names to have been excluded from and
   * nothing for them to understate, and the panel that reads this field says in
   * so many words that "the market leg excludes them and is understated by
   * whatever they moved" — a sentence that is false about a leg which does not
   * exist. The withheld leg's own note carries the reason instead.
   */
  unmeasuredSymbols: string[];
  /** dayPnl - (realised + unrealised). Legitimately non-zero in a correct multi-day
   *  book — mark-to-market carried in on positions opened before the session. */
  carriedMarkToMarket: number | null;
  referenceSymbol: string | null;
  referenceReturn: number | null;
  /**
   * Some — but not all — of this session's fills carried no measured slippage,
   * so the leg is a floor on execution cost rather than a measurement of it.
   *
   * False when *none* of them did: that leg is withheld, and a caveat about how
   * far a bar understates the truth is meaningless next to a bar nobody drew.
   */
  slippageIsLowerBound: boolean;
  /** True only when every leg is present and they reconcile to dayPnl. */
  complete: boolean;
}

/**
 * How close the legs must sum to day P&L before the decomposition is called
 * complete. One cent: the residual is a plug, so the only error possible is
 * float accumulation, and anything larger than this is a bug rather than a
 * rounding artefact.
 */
export const RECONCILIATION_TOLERANCE = 0.01;
