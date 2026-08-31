import type { CoherenceProofEvidence } from "./types-proof";

export interface CoherenceCertificateLeg {
  ticker: string;
  label: string;
  direction: string;
  price: string;
  size: string;
  notional: string;
  trade_fee: string;
  rounding_fee: string;
  rebate: string;
  net_fee: string;
}

export interface CoherenceCertificate {
  /** The venue reading's age in seconds; see `CoherenceUniverse`. Null, never zero. */
  observed_age_s: number | null;
  verdict: string;
  /** A price incoherence whose portfolio no longer survives fees. */
  priced_out?: boolean;
  engine: string;
  component_id: string;
  series_ticker: string;
  exchange_index: number;
  family: string;
  because: string;
  scope: string;
  tier: number;
  tier_note: string;
  legs: CoherenceCertificateLeg[];
  gross_edge: string | null;
  worst_case_payoff: string | null;
  total_fees: string | null;
  net_edge: string | null;
  /** Signed solver optimum; null when no linear programme ran. */
  margin: string | null;
  worth_doing: boolean;
  rows_tested: number;
  rows_untestable: number;
  /** Structured evidence from the exact observation and solver run. */
  proof_evidence?: CoherenceProofEvidence | null;
  notes: string[];
  proof: string;
}
