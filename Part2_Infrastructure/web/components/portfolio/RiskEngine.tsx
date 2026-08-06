"use client";

/**
 * What the book is actually risking.
 *
 * Two numbers are shown for the same quantity on purpose. Parametric VaR assumes
 * normality; historical VaR replays the current book over real returns and
 * assumes nothing. In crypto the second is routinely worse, and the gap between
 * them *is* the fat tail. Reporting only the parametric figure would be the
 * tidier screen and the more dangerous one.
 *
 * Three cards, split by question rather than by widget: this one answers *how
 * much can this book lose*, RiskContributions answers *who is causing it*, and
 * CorrelationMatrix answers *why does it all move together*. They were one card
 * holding a whole page.
 *
 * This component calls no hooks, which is what makes its three early returns
 * safe. Keep it that way — anything needing state belongs in a child.
 */

import CorrelationMatrix from "@/components/portfolio/CorrelationMatrix";
import RiskContributions from "@/components/portfolio/RiskContributions";
import { pct, usd } from "@/lib/format";
import type { CovarianceModel, PortfolioRisk, VarBacktest, VarSeries } from "@/lib/portfolio-risk";

interface RiskEngineProps {
  risk: PortfolioRisk | null;
  model: CovarianceModel | null;
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
  /**
   * The per-observation series behind `validation`.
   *
   * Rendered inside this card rather than as a sibling in the workspace: the
   * forecast and its scorecard can never describe different data, and they
   * cannot if they are one card fed by one prop source.
   */
  varSeries?: VarSeries | null;
  /** True when the notionals came from the generated sandbox book. */
  sandbox?: boolean;
}

const ZONE_STYLE: Record<string, { glyph: string; label: string; tone: string }> = {
  green: { glyph: "✓", label: "validated", tone: "var(--success-text)" },
  yellow: { glyph: "▲", label: "on watch", tone: "var(--warning-text)" },
  red: { glyph: "✕", label: "rejected", tone: "var(--critical-text)" },
};

export default function RiskEngine({ risk, model, loading, missing, validation }: RiskEngineProps) {
  if (loading) {
    return (
      <div className="card" aria-busy="true" aria-live="polite">
        <div className="portfolio-card-heading">
          <div>
            <span className="page-kicker">Quantitative risk</span>
            <h2>Risk engine</h2>
          </div>
        </div>
        <div className="skeleton" style={{ height: 150 }} aria-hidden />
        <span className="sr-only">Measuring portfolio volatility and loss estimates.</span>
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
    <>
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

      <p className="research-note">
        Parametric VaR assumes normal returns, which is why the historical figure is shown beside it
        rather than instead of it.
      </p>
    </div>

    <div className="compact-grid-2col">
      <RiskContributions contributions={risk.contributions} />
      <CorrelationMatrix model={model} worst={risk.worstCorrelation} observations={risk.observations} />
    </div>
    </>
  );
}
