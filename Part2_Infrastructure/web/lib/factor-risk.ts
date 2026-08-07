/**
 * Systematic vs Idiosyncratic Factor Risk Decomposition.
 *
 * Decomposes portfolio risk relative to reference symbol closes using linear regression.
 */

import { BARS_PER_YEAR } from "@/lib/types";
import { regress } from "@/lib/quant";
import type { RiskPosition } from "@/lib/portfolio-risk";

export const MIN_FACTOR_OBSERVATIONS = 60;

export interface FactorDecomposition {
  bookBeta: number;
  systematicShare: number;
  idiosyncraticShare: number;
  systematicVolAnnualised: number;
  idiosyncraticVolAnnualised: number;
  totalVolAnnualised: number;
  rSquared: number;
  tStat: number;
  observations: number;
  referenceSymbol: string;
}

export interface BetaContributionRow {
  symbol: string;
  weight: number;
  beta: number | null;
  betaContribution: number | null;
}

export function decomposeBookRisk(
  bookReturns: number[],
  refReturns: number[],
  referenceSymbol: string
): FactorDecomposition | null {
  if (
    !bookReturns ||
    !refReturns ||
    bookReturns.length < MIN_FACTOR_OBSERVATIONS ||
    bookReturns.length !== refReturns.length
  ) {
    return null;
  }

  const ann = Math.sqrt(BARS_PER_YEAR["1d"]);
  const fit = regress(bookReturns, [{ name: referenceSymbol, values: refReturns }], ann);
  if (!fit) return null;

  const loading = fit.loadings[0];
  const beta = loading ? loading.beta : 0;
  const tStat = loading ? loading.tStat : 0;

  const totalVol = fit.alphaAnnualised; // total annualised scale
  const systematicShare = fit.rSquared;
  const idiosyncraticShare = fit.idiosyncraticShare;
  const systematicVol = totalVol * Math.sqrt(Math.max(0, systematicShare));
  const idiosyncraticVol = totalVol * Math.sqrt(Math.max(0, idiosyncraticShare));

  return {
    bookBeta: beta,
    systematicShare,
    idiosyncraticShare,
    systematicVolAnnualised: systematicVol,
    idiosyncraticVolAnnualised: idiosyncraticVol,
    totalVolAnnualised: totalVol,
    rSquared: fit.rSquared,
    tStat,
    observations: bookReturns.length,
    referenceSymbol,
  };
}

export function betaContributions(
  positions: RiskPosition[],
  equity: number,
  returnsMap: Record<string, number[]>,
  refSymbol: string
): { rows: BetaContributionRow[]; bookBeta: number; unmeasurableCount: number } {
  const refSeries = returnsMap[refSymbol];
  let totalBeta = 0;
  let unmeasurable = 0;
  const rows: BetaContributionRow[] = [];
  const ann = Math.sqrt(BARS_PER_YEAR["1d"]);

  for (const pos of positions) {
    const weight = equity > 0 ? pos.signedNotional / equity : 0;
    const posSeries = returnsMap[pos.symbol];
    if (!posSeries || !refSeries || posSeries.length !== refSeries.length) {
      unmeasurable++;
      rows.push({ symbol: pos.symbol, weight, beta: null, betaContribution: null });
      continue;
    }

    const fit = regress(posSeries, [{ name: refSymbol, values: refSeries }], ann);
    const posBeta = fit?.loadings[0]?.beta ?? null;
    const contrib = posBeta !== null ? weight * posBeta : null;
    if (contrib !== null) totalBeta += contrib;

    rows.push({
      symbol: pos.symbol,
      weight,
      beta: posBeta,
      betaContribution: contrib,
    });
  }

  return { rows, bookBeta: totalBeta, unmeasurableCount: unmeasurable };
}
