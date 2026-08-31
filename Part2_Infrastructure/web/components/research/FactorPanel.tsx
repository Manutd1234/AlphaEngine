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

import { useRef, useState, type CSSProperties } from "react";

import { fmt, metricRow, pct, signedPct } from "@/lib/format";
import type { FactorReport } from "@/lib/types";

/** |t| at which a coefficient is conventionally called significant. */
const T_SIGNIFICANT = 2;
/** Above this, two regressors are close enough that their betas stop being separable. */
const COLLINEARITY_WARN = 0.8;

export function nextFactorMatrixIndex(current: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowLeft" || key === "ArrowUp") return Math.max(0, current - 1);
  if (key === "ArrowRight" || key === "ArrowDown") return Math.min(count - 1, current + 1);
  return null;
}

function FactorExposureMatrix({ report }: { report: FactorReport }) {
  const loadings = report.regression.loadings;
  const [active, setActive] = useState(0);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const scale = Math.max(1, ...loadings.map((loading) => Math.abs(loading.beta)));
  const selected = loadings[Math.min(active, Math.max(0, loadings.length - 1))] ?? null;

  if (!loadings.length) return null;

  return (
    <section className="factor-risk-matrix" aria-labelledby="factor-risk-matrix-title">
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">Selected-strategy scope</span>
          <h3 id="factor-risk-matrix-title">Factor exposure risk matrix</h3>
        </div>
        <span className="section-note">one fitted strategy × {loadings.length} factors</span>
      </div>
      <div className="table-wrap" tabIndex={0}>
        <table>
          <caption className="sr-only">One selected strategy by its fitted factor loadings.</caption>
          <thead>
            <tr>
              <th scope="col">Scope</th>
              {loadings.map((loading) => <th key={loading.name} scope="col">{loading.name}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Selected winner</th>
              {loadings.map((loading, index) => {
                const significant = Math.abs(loading.tStat) >= T_SIGNIFICANT;
                const wash = `${Math.round(10 + (Math.abs(loading.beta) / scale) * 28)}%`;
                return (
                  <td key={loading.name}>
                    <button
                      ref={(node) => { refs.current[index] = node; }}
                      type="button"
                      data-sign={loading.beta >= 0 ? "positive" : "negative"}
                      data-active={active === index ? "true" : undefined}
                      aria-pressed={active === index}
                      aria-label={`${loading.name} loading ${fmt(loading.beta, 3)}, t ${fmt(loading.tStat, 2)}, ${significant ? "statistically significant" : "not statistically significant"}`}
                      style={{ "--factor-wash": wash } as CSSProperties}
                      tabIndex={active === index ? 0 : -1}
                      onClick={() => setActive(index)}
                      onFocus={() => setActive(index)}
                      onKeyDown={(event) => {
                        const next = nextFactorMatrixIndex(index, event.key, loadings.length);
                        if (next === null) return;
                        event.preventDefault();
                        setActive(next);
                        refs.current[next]?.focus();
                      }}
                    >
                      <span aria-hidden>{loading.beta >= 0 ? "+" : "−"}</span>
                      <strong className="num">{fmt(Math.abs(loading.beta), 3)}</strong>
                      <small>{significant ? "|t| ≥ 2" : "|t| < 2"}</small>
                    </button>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
      {selected && (
        <output className="factor-risk-matrix__reading num" aria-live="polite">
          {selected.name}: {metricRow([
            `β ${fmt(selected.beta, 3)}`,
            `t ${fmt(selected.tStat, 2)}`,
            `p ${selected.pValue < 0.001 ? "<0.001" : fmt(selected.pValue, 3)}`,
            Math.abs(selected.tStat) >= T_SIGNIFICANT ? "significant" : "not significant",
          ])}
        </output>
      )}
      <p className="research-note">
        One fitted winner, not a portfolio × strategy matrix. Sign, exact β and |t| remain readable without colour.
      </p>
    </section>
  );
}

export default function FactorPanel({ report }: { report: FactorReport | null }) {
  if (!report) {
    return (
      <div className="card">
        <div className="section-heading compact">
          <div>
            <h2>Factor exposure</h2>
          </div>
        </div>
        <p className="sub">
          The regression could not be estimated: too few bars, or a perfectly collinear factor
          set on this series.
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
          {/* The same title the !report branch above prints. This read
              "Factor exposure & alpha decomposition", so one card answered to
              two names depending on whether the regression estimated — and at
              360px, the half-width track this shares with Versus benchmark, the
              longer one wrapped to a second row while its neighbour sat on one.
              Renaming the null branch to match the longer title was the other
              way to make them agree and was rejected: "alpha decomposition"
              restates the sub beneath it, which already says the return is
              regressed on three factors and that the residual is measured. */}
          <h2>Factor exposure</h2>
        </div>
        <span className="section-note">{r.n.toLocaleString()} bars</span>
      </div>

      {/* The residual half of this sentence is two tiles below, labelled and
          measured: "Idiosyncratic — variance the factors do not explain". */}
      <p className="sub">
        Strategy return regressed on three factors built from this instrument&apos;s own bars. A large
        loading means the edge <em>is</em> that exposure.
      </p>

      <FactorExposureMatrix report={report} />

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
            t = {fmt(r.alphaTStat, 2)},{" "}
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
          <small>R², adjusted {pct(r.adjRSquared, 1)}</small>
        </div>
        <div className="stability-tile">
          <span>Idiosyncratic</span>
          <strong className="num">{pct(r.idiosyncraticShare, 1)}</strong>
          <small>variance the factors do not explain</small>
        </div>
      </div>

      {!alphaSignificant && (
        <div className="banner warn" role="status" style={{ marginTop: "var(--space-3)" }}>
          <span aria-hidden>!</span>
          <div>
            <strong>Alpha is not statistically distinguishable from zero</strong> (|t| ={" "}
            {fmt(Math.abs(r.alphaTStat), 2)}, below {T_SIGNIFICANT}). What market, trend and
            volatility exposure do not explain is within this sample&apos;s noise.
          </div>
        </div>
      )}

      <div className="table-wrap" tabIndex={0} style={{ marginTop: "var(--space-3)" }}>
        <table className="factor-table">
          <caption className="sr-only">
            Factor loadings with t-statistics, p-values and a relative-magnitude bar.
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
        <div className="banner warn" role="status" style={{ marginTop: "var(--space-3)" }}>
          <span aria-hidden>!</span>
          <div>
            <strong>Factors are highly correlated.</strong> {worstCollinearity.a} and{" "}
            {worstCollinearity.b} correlate at {fmt(worstCollinearity.corr, 2)} on this series, so
            the split between them is unstable even though their combined explanatory power is not.
          </div>
        </div>
      )}

      <details className="disclosure">
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
                    {c.a} against {c.b}
                  </td>
                  <td className="num">{fmt(c.corr, 3)}</td>
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
