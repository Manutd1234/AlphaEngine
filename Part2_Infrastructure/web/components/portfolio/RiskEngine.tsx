"use client";

/**
 * What the book is actually risking.
 *
 * The gateway reports notional, and notional is not risk. A $1.15M short in BNB
 * and a $1.45M long in SOL are similar numbers that do opposite things to the
 * variance of the book, and no exposure table can show that. So this panel
 * decomposes total volatility into per-position contributions that **sum to the
 * total** — the Euler decomposition — which is what makes "cut this to lose the
 * most risk per dollar" answerable.
 *
 * Two numbers are shown for the same quantity on purpose. Parametric VaR assumes
 * normality; historical VaR replays the current book over real returns and
 * assumes nothing. In crypto the second is routinely worse, and the gap between
 * them *is* the fat tail. Reporting only the parametric figure would be the
 * tidier screen and the more dangerous one.
 */

import { fmt, pct, usd } from "@/lib/format";
import type { CovarianceModel, PortfolioRisk, VarBacktest } from "@/lib/portfolio-risk";

interface RiskEngineProps {
  risk: PortfolioRisk | null;
  model: CovarianceModel | null;
  equity: number;
  loading: boolean;
  /** Symbols whose history could not be fetched — excluded from every figure. */
  missing: string[];
  /**
   * Kupiec back-test of the VaR figure above.
   *
   * Without it every number on this card is an unverified claim: a model that
   * has never been scored against realised losses is an opinion with a
   * confidence interval printed on it.
   */
  validation?: VarBacktest | null;
}

const ZONE_STYLE: Record<string, { glyph: string; label: string; tone: string }> = {
  green: { glyph: "✓", label: "validated", tone: "var(--success-text)" },
  yellow: { glyph: "▲", label: "on watch", tone: "var(--warning-text)" },
  red: { glyph: "✕", label: "rejected", tone: "var(--critical-text)" },
};

export default function RiskEngine({ risk, model, equity, loading, missing, validation }: RiskEngineProps) {
  if (loading) {
    return (
      <div className="card">
        <div className="portfolio-card-heading">
          <div>
            <span className="page-kicker">Quantitative risk</span>
            <h2>Risk engine</h2>
          </div>
        </div>
        <div className="skeleton" style={{ height: 150 }} />
      </div>
    );
  }

  if (!risk || !model) {
    return (
      <div className="card">
        <div className="portfolio-card-heading">
          <div>
            <span className="page-kicker">Quantitative risk</span>
            <h2>Risk engine</h2>
          </div>
        </div>
        <p className="sub">
          Not enough price history to estimate a covariance for this book. Volatility, VaR and risk
          contributions need at least 20 aligned observations per instrument — nothing is shown rather
          than a figure built on an assumed correlation.
        </p>
      </div>
    );
  }

  const tailGap = risk.historicalVar95 !== null ? risk.historicalVar95 - risk.var95 : null;

  return (
    <div className="card">
      <div className="portfolio-card-heading">
        <div>
          <span className="page-kicker">Quantitative risk</span>
          <h2>Risk engine</h2>
        </div>
        <span>{risk.observations} daily observations</span>
      </div>

      <div className="tiles stability-tiles">
        <div className="stability-tile">
          <span>Book volatility</span>
          <strong className="num">{pct(risk.annualisedVolatility, 1)}</strong>
          <small>annualised · {pct(risk.volatility, 2)} per day</small>
        </div>
        <div className="stability-tile">
          <span>VaR 95 · 1 day</span>
          <strong className="num" style={{ color: "var(--critical-text)" }}>{usd(risk.var95, 0)}</strong>
          <small>parametric · normal assumption</small>
        </div>
        <div className="stability-tile">
          <span>Historical VaR 95</span>
          <strong className="num" style={{ color: "var(--critical-text)" }}>
            {risk.historicalVar95 === null ? "—" : usd(risk.historicalVar95, 0)}
          </strong>
          <small>this book replayed over real returns</small>
        </div>
        <div className="stability-tile">
          <span>Expected shortfall 95</span>
          <strong className="num" style={{ color: "var(--critical-text)" }}>
            {risk.historicalCvar95 === null ? usd(risk.cvar95, 0) : usd(risk.historicalCvar95, 0)}
          </strong>
          <small>{risk.historicalCvar95 === null ? "parametric" : "average loss beyond VaR"}</small>
        </div>
      </div>

      {tailGap !== null && tailGap > risk.var95 * 0.15 && (
        <div className="banner warn" role="status" style={{ marginTop: 12 }}>
          <span aria-hidden>!</span>
          <div>
            <strong>Realised losses are fatter than the normal model.</strong> Historical VaR is{" "}
            {usd(tailGap, 0)} worse than parametric ({pct(tailGap / Math.max(1, risk.var95), 0)} more).
            The normal assumption is understating this book&apos;s tail — size against the historical
            figure, not the parametric one.
          </div>
        </div>
      )}

      {validation && (
        <div className="var-validation">
          <div className="var-validation__head">
            <span>VaR model backtest</span>
            {/* icon + word + colour, never colour alone */}
            <strong style={{ color: ZONE_STYLE[validation.zone].tone }}>
              <span aria-hidden>{ZONE_STYLE[validation.zone].glyph}</span>{" "}
              {ZONE_STYLE[validation.zone].label}
            </strong>
          </div>
          <p>
            {validation.exceptions} exceptions in {validation.observations} observations, against{" "}
            {validation.expectedExceptions} expected at 95%. Kupiec p ={" "}
            {validation.kupiecPValue.toFixed(3)}.
          </p>
          <p className="research-note">
            {validation.verdict} The forecast is re-fitted on a rolling window and scored on the next
            bar, so it is never judged on data it was fitted to.
          </p>
        </div>
      )}

      {missing.length > 0 && (
        <p className="research-note">
          Excluded for want of price history: {missing.join(", ")}. Every figure above describes only
          the instruments that could be measured, so total risk is understated by whatever those carry.
        </p>
      )}

      <p className="console-subhead">
        Risk contribution
        <small className="muted"> — sums to the book&apos;s total volatility, so it answers what to cut.</small>
      </p>

      <div className="table-wrap">
        <table>
          <caption className="sr-only">
            Per-position share of notional against share of portfolio volatility, with standalone
            volatility.
          </caption>
          <thead>
            <tr>
              <th scope="col">Instrument</th>
              <th scope="col">Notional</th>
              <th scope="col">Share of book</th>
              <th scope="col">Standalone vol</th>
              <th scope="col">Risk share</th>
              <th scope="col">Contribution</th>
            </tr>
          </thead>
          <tbody>
            {risk.contributions.map((c) => {
              const notionalShare = equity > 0 ? Math.abs(c.signedNotional) / Math.max(1, totalGross(risk)) : 0;
              const diverges = Math.abs(c.contributionShare - notionalShare) > 0.1;
              return (
                <tr key={c.symbol}>
                  <td>{c.symbol}</td>
                  <td className={c.signedNotional >= 0 ? "pos" : "neg"}>{usd(c.signedNotional, 0)}</td>
                  <td>{pct(notionalShare, 1)}</td>
                  <td>{pct(c.standaloneVol, 1)}</td>
                  <td className={c.contributionShare < 0 ? "pos" : undefined}>
                    {pct(c.contributionShare, 1)}
                    {/* A hedge takes risk OUT. Worth naming, since a negative
                        percentage is easy to read as an error. */}
                    {c.contributionShare < 0 && <span className="muted"> · hedge</span>}
                    {diverges && c.contributionShare >= 0 && (
                      <span className="muted"> · {c.contributionShare > notionalShare ? "over" : "under"}-risks its size</span>
                    )}
                  </td>
                  <td>
                    <span className="risk-bar" role="img" aria-label={`${pct(c.contributionShare, 1)} of book volatility`}>
                      <i
                        style={{
                          width: `${Math.min(100, Math.abs(c.contributionShare) * 100)}%`,
                          background: c.contributionShare < 0 ? "var(--series-3)" : "var(--series-1)",
                        }}
                        aria-hidden
                      />
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="console-subhead">
        Correlation
        <small className="muted"> — diversification is only real while these stay low.</small>
      </p>

      {risk.worstCorrelation && Math.abs(risk.worstCorrelation.corr) >= 0.8 && (
        <div className="banner warn" role="status">
          <span aria-hidden>!</span>
          <div>
            <strong>
              {risk.worstCorrelation.a} and {risk.worstCorrelation.b} correlate at{" "}
              {fmt(risk.worstCorrelation.corr, 2)}.
            </strong>{" "}
            Two positions this correlated are close to one position of their combined size — the book
            is less diversified than the position count suggests.
          </div>
        </div>
      )}

      <div className="table-wrap">
        <table className="corr-matrix">
          <caption className="sr-only">Pairwise return correlation between held instruments.</caption>
          <thead>
            <tr>
              <th scope="col"></th>
              {model.symbols.map((s) => (
                <th scope="col" key={s}>{s.replace("USDT", "")}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.symbols.map((rowSymbol, i) => (
              <tr key={rowSymbol}>
                <th scope="row">{rowSymbol.replace("USDT", "")}</th>
                {model.symbols.map((colSymbol, j) => {
                  const c = model.correlation[i][j];
                  return (
                    <td key={colSymbol} className="corr-cell">
                      <span
                        title={`${rowSymbol} vs ${colSymbol}: ${fmt(c, 3)}`}
                        style={{
                          // Alpha carries magnitude, hue carries sign, and the
                          // number is always printed — readable with no colour
                          // perception at all.
                          background:
                            i === j
                              ? "var(--surface-3)"
                              : c >= 0
                                ? `color-mix(in srgb, var(--diverging-pos) ${Math.round(Math.abs(c) * 55)}%, transparent)`
                                : `color-mix(in srgb, var(--diverging-neg) ${Math.round(Math.abs(c) * 55)}%, transparent)`,
                        }}
                      >
                        {fmt(c, 2)}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="research-note">
        Covariance measured from {risk.observations} daily closes of the instruments actually held —
        not from assumed factor loadings. Parametric VaR additionally assumes normal returns, which is
        why the historical figure is shown beside it rather than instead of it.
      </p>
    </div>
  );
}

function totalGross(risk: PortfolioRisk): number {
  return risk.contributions.reduce((acc, c) => acc + Math.abs(c.signedNotional), 0);
}
