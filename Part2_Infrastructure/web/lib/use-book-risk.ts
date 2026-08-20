/**
 * Everything the book implies about risk, derived once for every tab.
 *
 * Portfolio and Risk are two questions asked of one snapshot, and these are the
 * answers neither of them may compute for itself: the covariance, the VaR and
 * its backtest, each position's share of book volatility, the betas, and the
 * caps the gateway will actually enforce. Two tabs deriving them separately is
 * two tabs quoting different risk from the same book.
 *
 * Every memo here is unconditional, and that is load-bearing rather than
 * stylistic: `use-book` calls this before any caller can branch, so the hook
 * count cannot change between renders. The component this logic came from
 * returned early while loading and called `useMemo` further down — React's
 * "rendered more hooks than during the previous render", reachable by clicking
 * into the sandbox from the unconfigured state.
 *
 * Null is a real answer throughout. With no measured returns there is no
 * covariance, so `risk`, `varValidation` and `varSeries` are null rather than
 * zero, and `missingHistory` names the symbols that could not enter.
 */

import { useMemo } from "react";

import type { SessionBars } from "@/lib/book-bars";
import { sessionReturn } from "@/lib/pnl-attribution";
import type { PortfolioPayload } from "@/lib/portfolio";
import {
  type AllocationLimits,
  type CovarianceModel,
  type PortfolioRisk,
  type ReturnsBySymbol,
  type RiskPosition,
  type VarBacktest,
  type VarSeries,
  beta,
  buildCovariance,
  portfolioRisk,
  rollingVarBacktest,
  rollingVarSeries,
} from "@/lib/portfolio-risk";
import { BARS_PER_YEAR } from "@/lib/types";

interface BookRiskInput {
  book: PortfolioPayload | null;
  /** The join of held symbols — a stable dependency where `positions` is not. */
  heldSymbols: string;
  returns: ReturnsBySymbol;
  barTimes: Record<string, number[]>;
  sessionBars: SessionBars;
}

export interface BookRisk {
  riskPositions: RiskPosition[];
  covarianceModel: CovarianceModel | null;
  risk: PortfolioRisk | null;
  varValidation: VarBacktest | null;
  varSeries: VarSeries | null;
  missingHistory: string[];
  referenceSymbol: string;
  riskShare: Map<string, number>;
  referenceSessionReturn: number | null;
  betaBySymbol: Map<string, number | null>;
  allocationLimits: AllocationLimits;
}

export function useBookRisk(
  { book, heldSymbols, returns, barTimes, sessionBars }: BookRiskInput,
): BookRisk {
  const positions = book?.exposure.positions ?? [];

  // Signed notionals: a short must reduce the book's variance, and it only can
  // if the sign survives into the covariance maths.
  const riskPositions = useMemo(
    () =>
      positions
        .filter((position) => position.notional > 0)
        .map((position) => ({
          symbol: position.symbol,
          signedNotional: position.side === "SHORT" ? -position.notional : position.notional,
        })),
    // `positions` is a fresh array each render; its content is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [heldSymbols, book?.as_of],
  );

  const covarianceModel = useMemo(
    () => (riskPositions.length ? buildCovariance(riskPositions.map((r) => r.symbol), returns) : null),
    [riskPositions, returns],
  );

  const equityNow = book?.equity.current ?? 0;
  const risk = useMemo(
    // One annualisation constant, shared with the factor decomposition. Two
    // literals that must agree is one too many.
    () => (covarianceModel ? portfolioRisk(riskPositions, equityNow, covarianceModel, BARS_PER_YEAR["1d"], returns) : null),
    [covarianceModel, riskPositions, equityNow, returns],
  );

  // Does the VaR above actually hold up? Computed from the same returns, so the
  // forecast and its scorecard can never describe different data.
  const varValidation = useMemo(
    () => (riskPositions.length ? rollingVarBacktest(riskPositions, returns) : null),
    [riskPositions, returns],
  );

  // The same points the scorer counts, kept rather than discarded. Recomputing
  // is deliberate and cheap — `returns` only changes when the OHLCV fetch
  // resolves, not on the 15s poll — and it buys one exported entry point per
  // question instead of a scorer that also returns a chart payload.
  const varSeries = useMemo(
    () => (riskPositions.length ? rollingVarSeries(riskPositions, returns, { times: barTimes }) : null),
    [riskPositions, returns, barTimes],
  );

  const missingHistory = useMemo(() => {
    const measured = new Set(covarianceModel?.symbols ?? []);
    return riskPositions.map((r) => r.symbol).filter((symbol) => !measured.has(symbol));
  }, [covarianceModel, riskPositions]);

  const referenceSymbol = riskPositions[0]?.symbol ?? "BTCUSDT";

  // Beta against the largest position, and each position's share of book
  // volatility. Both belong on the positions row: a PM reading exposure should
  // not have to open the risk tab to learn that the third-largest line carries
  // the most risk.
  const riskShare = useMemo(
    () => new Map(risk?.contributions.map((c) => [c.symbol, c.contributionShare]) ?? []),
    [risk],
  );

  const referenceSessionReturn = useMemo(
    () => sessionReturn(sessionBars[referenceSymbol], book?.session_date ?? ""),
    [sessionBars, referenceSymbol, book?.session_date],
  );

  const betaBySymbol = useMemo(
    () =>
      new Map<string, number | null>(
        riskPositions.map((r) => [
          r.symbol,
          r.symbol === referenceSymbol ? 1 : beta(r.symbol, referenceSymbol, returns),
        ]),
      ),
    [riskPositions, referenceSymbol, returns],
  );

  // The same caps the risk gateway enforces, read off the payload rather than
  // duplicated as constants — a proposal built against a stale limit would be
  // rejected order by order at the gate.
  const allocationLimits = useMemo<AllocationLimits>(
    () => ({
      maxSymbolNotional: positions[0]
        ? positions[0].symbol_limit.used + positions[0].symbol_limit.remaining
        : undefined,
      maxGrossNotional: book?.risk_budget.gross_exposure.limit,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [heldSymbols, book?.risk_budget.gross_exposure.limit, book?.as_of],
  );

  return {
    riskPositions, covarianceModel, risk, varValidation, varSeries,
    missingHistory, referenceSymbol, riskShare, referenceSessionReturn,
    betaBySymbol, allocationLimits,
  };
}
