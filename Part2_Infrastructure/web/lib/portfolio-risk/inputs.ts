// --------------------------------------------------------------------------
// Inputs
// --------------------------------------------------------------------------

export interface RiskPosition {
  symbol: string;
  /** Signed: long positive, short negative. */
  signedNotional: number;
}

/** Daily (or per-bar) return series per symbol, aligned by index. */
export type ReturnsBySymbol = Record<string, number[]>;
