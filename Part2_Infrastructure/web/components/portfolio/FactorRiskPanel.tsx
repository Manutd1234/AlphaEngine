"use client";

/**
 * Systematic vs Idiosyncratic Factor Risk Decomposition Panel.
 */

import { decomposeBookRisk, betaContributions } from "@/lib/factor-risk";
import type { RiskPosition } from "@/lib/portfolio-risk";

interface FactorRiskPanelProps {
  positions: RiskPosition[];
  equity: number;
  returnsMap: Record<string, number[]>;
  referenceSymbol: string;
}

export default function FactorRiskPanel({
  positions,
  equity,
  returnsMap,
  referenceSymbol,
}: FactorRiskPanelProps) {
  const refSeries = returnsMap[referenceSymbol];
  const bookSeries = returnsMap[positions[0]?.symbol ?? referenceSymbol];

  const factorDec = decomposeBookRisk(bookSeries, refSeries, referenceSymbol);
  const betaRes = betaContributions(positions, equity, returnsMap, referenceSymbol);

  if (!factorDec) {
    return (
      <div className="card">
        <div className="portfolio-card-heading">
          <div>
            <span className="page-kicker">Factor Decomposition</span>
            <h2>Systematic Risk</h2>
          </div>
        </div>
        <p className="sub">
          Insufficient historical return observations ({refSeries?.length ?? 0}/60 min) to decompose factor loadings against {referenceSymbol}.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="portfolio-card-heading">
        <div>
          <span className="page-kicker">Factor Decomposition</span>
          <h2>Systematic vs Idiosyncratic Risk</h2>
        </div>
        <span>
          Ref: <strong>{referenceSymbol}</strong> · {factorDec.observations} observations
        </span>
      </div>

      <p className="sub">
        Decomposes total volatility into systematic loading against {referenceSymbol} versus asset-specific idiosyncratic variance.
      </p>

      {/* Variance Split Bar */}
      <div style={{ margin: "14px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "4px" }}>
          <span>Systematic: {(factorDec.systematicShare * 100).toFixed(1)}% (${(factorDec.systematicVolAnnualised * equity).toFixed(0)} ann. vol)</span>
          <span>Idiosyncratic: {(factorDec.idiosyncraticShare * 100).toFixed(1)}% (${(factorDec.idiosyncraticVolAnnualised * equity).toFixed(0)} ann. vol)</span>
        </div>
        <div style={{ height: "12px", background: "var(--surface-3)", borderRadius: "6px", display: "flex", overflow: "hidden" }}>
          <div style={{ width: `${factorDec.systematicShare * 100}%`, background: "var(--series-1)" }} />
          <div style={{ width: `${factorDec.idiosyncraticShare * 100}%`, background: "var(--series-2)" }} />
        </div>
      </div>

      <div className="table-wrap" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Weight</th>
              <th>Beta (vs {referenceSymbol})</th>
              <th>Beta Contribution</th>
            </tr>
          </thead>
          <tbody>
            {betaRes.rows.map((row) => (
              <tr key={row.symbol}>
                <td><strong>{row.symbol}</strong></td>
                <td>{(row.weight * 100).toFixed(1)}%</td>
                <td>{row.beta !== null ? row.beta.toFixed(2) : "—"}</td>
                <td>{row.betaContribution !== null ? row.betaContribution.toFixed(3) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="research-note" style={{ marginTop: "12px" }}>
        Book Beta: <strong>{betaRes.bookBeta.toFixed(2)}</strong>. Beta contribution measures directional sensitivity to {referenceSymbol}; Euler risk contribution measures individual variance contribution to portfolio volatility.
      </p>
    </div>
  );
}
