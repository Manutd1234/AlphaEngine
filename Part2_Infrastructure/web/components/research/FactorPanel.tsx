"use client";

/**
 * Alpha or beta?
 *
 * A long-only crypto strategy that holds through a bull market earns a good
 * Sharpe by owning the asset. Nothing else on this page can tell that apart from
 * skill: the equity curve goes up, the drawdown is tolerable, the trade count is
 * respectable. Regressing the strategy's own returns against the asset is the
 * cheapest check there is, and it is the one that most often ends the
 * conversation.
 *
 * Three things are shown that a bare beta table would omit:
 *
 *  - **The residual share**, because "what fraction of this is unexplained" is
 *    the number a researcher is actually asking for.
 *  - **The collinearity between factors**, because with correlated regressors an
 *    individual beta is unstable and its t-statistic is inflated — a caveat that
 *    belongs next to the number, not in a methodology appendix.
 *  - **What each factor literally is.** These are time-series factors built from
 *    this one instrument. Calling them "momentum" and letting a reader assume
 *    cross-sectional academic momentum would be the sort of borrowed authority
 *    this whole surface exists to refuse.
 */

import { fmt, pct, signedPct } from "@/lib/format";
import type { FactorReport } from "@/lib/types";

/** |t| at which a coefficient is conventionally called significant. */
const T_SIGNIFICANT = 2;
/** Above this, two regressors are close enough that their betas stop being separable. */
const COLLINEARITY_WARN = 0.8;

export default function FactorPanel({ report }: { report: FactorReport | null }) {
  if (!report) {
    return (
      <div className="card">
        <div className="section-heading compact">
          <div>
            <span className="page-kicker">Attribution</span>
            <h2>Factor exposure</h2>
          </div>
        </div>
        <p className="sub">
          The regression could not be estimated — either too few bars, or the factor set was
          perfectly collinear on this series. No loadings are shown rather than unstable ones.
        </p>
      </div>
    );
  }

  const { regression: r } = report;
  const alphaSignificant = Math.abs(r.alphaTStat) >= T_SIGNIFICANT;
  const worstCollinearity = r.collinearity.reduce(
    (worst, c) => (Math.abs(c.corr) > Math.abs(worst?.corr ?? 0) ? c : worst),
    null as (typeof r.collinearity)[number] | null,
  );

  return (
    <div className="card">
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">Attribution</span>
          <h2>Factor exposure &amp; alpha decomposition</h2>
        </div>
        <span className="section-note">{r.n.toLocaleString()} bars</span>
      </div>

      <p className="sub">
        Strategy return regressed on three factors built from this instrument&apos;s own bars.
        A large loading means the edge <em>is</em> that exposure; a large residual means it is not
        explained by any of them.
      </p>

      <div className="tiles stability-tiles">
        <div className="stability-tile">
          <span>Annualised alpha</span>
          <strong
            className="num"
            style={{ color: r.alphaAnnualised >= 0 ? "var(--success-text)" : "var(--critical-text)" }}
          >
            {signedPct(r.alphaAnnualised)}
          </strong>
          <small>
            t = {fmt(r.alphaTStat, 2)} ·{" "}
            {alphaSignificant ? "distinguishable from zero" : "not distinguishable from zero"}
          </small>
        </div>
        <div className="stability-tile">
          <span>Information ratio</span>
          <strong className="num">{fmt(r.informationRatio, 2)}</strong>
          <small>alpha ÷ residual volatility</small>
        </div>
        <div className="stability-tile">
          <span>Explained by factors</span>
          <strong className="num">{pct(r.rSquared, 1)}</strong>
          <small>R² · adjusted {pct(r.adjRSquared, 1)}</small>
        </div>
        <div className="stability-tile">
          <span>Idiosyncratic</span>
          <strong className="num">{pct(r.idiosyncraticShare, 1)}</strong>
          <small>variance the factors do not explain</small>
        </div>
      </div>

      {!alphaSignificant && (
        <div className="banner warn" role="status" style={{ marginTop: 14 }}>
          <span aria-hidden>!</span>
          <div>
            <strong>Alpha is not statistically distinguishable from zero</strong> (|t| ={" "}
            {fmt(Math.abs(r.alphaTStat), 2)}, below {T_SIGNIFICANT}). Whatever this strategy returned,
            the part not explained by market, trend and volatility exposure is within the noise of the
            sample.
          </div>
        </div>
      )}

      <div className="table-wrap" tabIndex={0} style={{ marginTop: 14 }}>
        <table>
          <caption className="sr-only">
            Factor loadings with t-statistics, p-values and a bar showing relative magnitude.
          </caption>
          <thead>
            <tr>
              <th scope="col">Factor</th>
              <th scope="col">Loading</th>
              <th scope="col">t</th>
              <th scope="col">p</th>
              <th scope="col">Magnitude</th>
            </tr>
          </thead>
          <tbody>
            {r.loadings.map((loading, i) => {
              const significant = Math.abs(loading.tStat) >= T_SIGNIFICANT;
              const scale = Math.max(1, ...r.loadings.map((l) => Math.abs(l.beta)));
              const widthPct = (Math.abs(loading.beta) / scale) * 50;
              return (
                <tr key={loading.name}>
                  <td>
                    <div className="factor-name">
                      <strong>{loading.name}</strong>
                      <small className="muted">{report.descriptions[i]}</small>
                    </div>
                  </td>
                  <td className={loading.beta >= 0 ? "pos" : "neg"}>{fmt(loading.beta, 3)}</td>
                  <td>
                    {fmt(loading.tStat, 2)}
                    {/* icon + word, never colour alone */}
                    {significant && (
                      <span className="muted" title="|t| ≥ 2">
                        {" "}
                        <span aria-hidden>●</span> sig
                      </span>
                    )}
                  </td>
                  <td>{loading.pValue < 0.001 ? "<0.001" : fmt(loading.pValue, 3)}</td>
                  <td>
                    {/* Bipolar bar from a centre line: sign is position, not hue. */}
                    <span className="factor-bar" role="img" aria-label={`loading ${fmt(loading.beta, 3)}`}>
                      <i
                        style={{
                          width: `${widthPct}%`,
                          left: loading.beta >= 0 ? "50%" : `${50 - widthPct}%`,
                          background: loading.beta >= 0 ? "var(--series-1)" : "var(--series-2)",
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

      {worstCollinearity && Math.abs(worstCollinearity.corr) >= COLLINEARITY_WARN && (
        <div className="banner warn" role="status" style={{ marginTop: 12 }}>
          <span aria-hidden>!</span>
          <div>
            <strong>Factors are highly correlated.</strong> {worstCollinearity.a} and{" "}
            {worstCollinearity.b} correlate at {fmt(worstCollinearity.corr, 2)} on this series, so
            their individual loadings are not separable — the split between them is unstable even
            though their combined explanatory power is not.
          </div>
        </div>
      )}

      <details style={{ marginTop: 12 }}>
        <summary>Factor correlations and method</summary>
        <div className="table-wrap" tabIndex={0}>
          <table>
            <caption className="sr-only">Pairwise correlation between the regressors.</caption>
            <thead>
              <tr>
                <th scope="col">Pair</th>
                <th scope="col">Correlation</th>
              </tr>
            </thead>
            <tbody>
              {r.collinearity.map((c) => (
                <tr key={`${c.a}-${c.b}`}>
                  <td>
                    {c.a} · {c.b}
                  </td>
                  <td>{fmt(c.corr, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="research-note">{report.note}</p>
      </details>
    </div>
  );
}
