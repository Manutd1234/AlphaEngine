/**
 * What `useBook` hands every tab, written down once.
 *
 * `BookView` is the desk's widest shared type — Portfolio, Risk, Overview,
 * Execution and half a dozen panels below them all read fields off it — so the
 * field-by-field notes here are the contract, not decoration. Two of them are
 * the honesty rules the whole book rests on: `risk` and its companions are
 * `null` when nothing could be measured rather than zero, and `tier` says what
 * the numbers on screen are made of, including when they are generated.
 *
 * It lives beside the hook rather than inside it because it is the half other
 * modules import; `lib/use-book.ts` imports it back and re-exports it, so no
 * consumer had to change.
 */

import type { DataTier, Provenance, TierCause } from "@/lib/data-tier";
import type { AdvBySymbol, SessionBars } from "@/lib/book-bars";
import type { PeriodReturns } from "@/lib/book-history";
import type { EquityPoint, PortfolioPayload } from "@/lib/portfolio";
import type { DeskStreamState } from "@/lib/use-desk-stream";
import type {
  AllocationLimits,
  CovarianceModel,
  PortfolioRisk,
  ReturnsBySymbol,
  RiskPosition,
  VarBacktest,
  VarSeries,
} from "@/lib/portfolio-risk";

export interface BookError {
  code?: string;
  error: string;
  hint?: string;
}

export type BookConnectionState = "live" | "stale" | "unconfigured" | "error";


export interface BookView {
  /** Null only while the first request is in flight, or when it failed. */
  book: PortfolioPayload | null;
  loading: boolean;
  refreshing: boolean;
  error: BookError | null;
  connectionState: BookConnectionState;
  /**
   * What the book on screen is made of, in the desk-wide vocabulary. Prefer this
   * over `connectionState` in anything new: it has a word for generated data and
   * it distinguishes a gateway that is absent by design from one that is broken.
   */
  tier: DataTier;
  cause: TierCause | null;
  /** Ready to hand to `describeTier` for a badge. */
  provenance: Provenance;
  /** A book is on screen but the most recent refresh failed. Writes are disabled. */
  isStale: boolean;
  lastSuccessAt: Date | null;
  streamState: DeskStreamState;
  refresh: (q?: boolean) => Promise<boolean>;  // false is what lets a tick back off

  sandbox: boolean;
  setSandbox: (on: boolean) => void;
  /**
   * This visitor's sandbox seed, so every surface that generates its own
   * stand-in generates the *same* desk. Undefined on the server pass and until
   * the first effect runs, which is deliberate — see the note where it is
   * resolved. A consumer that generates from its own unseeded call would put a
   * second, different fiction beside this one.
   */
  seed: number | undefined;

  /** Measured, not assumed — see `returns` below. */
  risk: PortfolioRisk | null;
  covarianceModel: CovarianceModel | null;
  varValidation: VarBacktest | null;
  /** Per-observation series behind `varValidation`. Null when it could not be built. */
  varSeries: VarSeries | null;
  riskPositions: RiskPosition[];
  returns: ReturnsBySymbol;
  riskLoading: boolean;
  /** Held symbols with too little aligned history to enter the covariance. */
  missingHistory: string[];
  referenceSymbol: string;
  /** The newest daily bar per symbol, so a consumer can verify its own alignment. */
  sessionBars: SessionBars;
  /** Bar open-times, index-aligned with `returns[symbol]`. Same measured-source rule. */
  barTimes: Record<string, number[]>;
  /** Quote-currency ADV per symbol, measured from the same bars as `returns`. */
  advBySymbol: AdvBySymbol;
  /**
   * The reference instrument's session-to-date return, or null when the newest
   * daily bar does not cover the gateway's session. Checked rather than assumed:
   * a restarted or stale gateway can carry a session_date that is not today's.
   */
  referenceSessionReturn: number | null;
  riskShare: Map<string, number>;
  betaBySymbol: Map<string, number | null>;
  allocationLimits: AllocationLimits;

  equityTrack: EquityPoint[];
  periods: PeriodReturns | null;
  historyBackfilled: boolean;
}
