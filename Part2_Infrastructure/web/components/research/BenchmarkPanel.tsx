"use client";

/**
 * Alpha and beta against an external instrument.
 *
 * Separate from `FactorPanel`, which regresses the strategy on factors built
 * from its OWN price series — momentum, volatility, trend — and therefore
 * answers "what kind of exposure is this". This answers a different question:
 * whether any of it survived comparison with simply owning something else.
 *
 * The absent case is four different states and they are never collapsed. "No
 * benchmark chosen" is a setting; "the benchmark's bars could not be loaded" is
 * a provider problem; "too few bars survived the join" is a data-alignment
 * problem that looks identical to a missing feature and is the reason
 * `alignedBars` is reported at all.
 */

import { atLeast } from "@/lib/complexity";
import { fmt, pct } from "@/lib/format";
import { useComplexity } from "@/lib/use-complexity";
import type { BenchmarkComparison } from "@/lib/types";

interface BenchmarkPanelProps {
  comparison: BenchmarkComparison | null | undefined;
  /** What was asked for, so the empty state can say which one failed. */
  requested: string | undefined;
}

/** Conventional threshold, stated rather than implied by a colour. */
const SIGNIFICANT_P = 0.05;

export default function BenchmarkPanel({ comparison, requested }: BenchmarkPanelProps) {
  const tier = useComplexity();
  if (!comparison) {
    return (
      <div className="card">
        <div className="section-heading compact">
          <div>
            <h2>Versus benchmark</h2>
          </div>
        </div>
        <p className="sub">
          {!requested
            ? "No benchmark selected. Choose one in the controls to measure alpha and beta against "
              + "an instrument other than this one — the buy-and-hold comparison below is against "
              + "the same symbol, which answers whether the timing helped, not whether the position did."
            : `${requested} was requested but no comparison could be computed. Either its bars did not `
              + "load, or too few timestamps lined up with this run's — two vendors on different bar "
              + "conventions produce an empty intersection, which is a data problem rather than a "
              + "missing result."}
        </p>
      </div>
    );
  }

  const alphaSignificant = comparison.alphaPValue < SIGNIFICANT_P;

  return (
    <div className="card">
      <div className="section-heading compact">
        <div>
          <h2>Versus {comparison.symbol}</h2>
        </div>
        <span className="num muted">{comparison.alignedBars} aligned bars</span>
      </div>

      <p className="sub">
        Ordinary least squares of this strategy&rsquo;s bar returns on {comparison.symbol}&rsquo;s.
        The intercept is what {comparison.symbol} does not explain — not, on its own, evidence of
        an edge.
      </p>

      <dl className="benchmark-grid">
        <div>
          <dt>Alpha (annualised)</dt>
          <dd className={`num ${alphaSignificant ? "is-emphasis" : ""}`}>
            {pct(comparison.alphaAnnualised)}
          </dd>
          <small className="muted">
            t = {fmt(comparison.alphaTStat, 2)}, p = {fmt(comparison.alphaPValue, 3)}
            {alphaSignificant ? "" : " — not distinguishable from zero"}
          </small>
        </div>
        <div>
          <dt>Beta</dt>
          <dd className="num">{fmt(comparison.beta, 2)}</dd>
          <small className="muted">
            {/* A beta near zero with a large R² is impossible; a beta near zero
                with a small one just means the benchmark explains nothing. */}
            {Math.abs(comparison.beta) < 0.2
              ? "Moves largely independently of the benchmark."
              : comparison.beta > 1
                ? "Amplifies the benchmark's moves."
                : "Damped relative to the benchmark."}
          </small>
        </div>
        <div>
          <dt>Correlation</dt>
          <dd className="num">{fmt(comparison.correlation, 2)}</dd>
          <small className="muted">R² {pct(comparison.rSquared)} of variance explained</small>
        </div>
        <div>
          <dt>Tracking error</dt>
          <dd className="num">{pct(comparison.trackingError)}</dd>
          <small className="muted">
            {comparison.informationRatio === null
              ? "Information ratio undefined on a flat active return."
              : `Information ratio ${fmt(comparison.informationRatio, 2)}`}
          </small>
        </div>
        <div>
          <dt>{comparison.symbol} return</dt>
          <dd className="num">{pct(comparison.totalReturn)}</dd>
          <small className="muted">buy-and-hold, over the aligned window</small>
        </div>
        <div>
          <dt>{comparison.symbol} Sharpe</dt>
          <dd className="num">{fmt(comparison.sharpe, 2)}</dd>
          <small className="muted">max drawdown {pct(comparison.maxDrawdown)}</small>
        </div>
      </dl>

      {atLeast(tier, "full") ? (
        <p className="research-note">
        The t-statistics are plain OLS. Strategy returns are heteroskedastic and mildly
        autocorrelated, so a Newey&ndash;West correction would widen these standard errors — the
        significance shown here is, if anything, generous. Stated rather than assumed away, and the
        reason a significant alpha is described as &ldquo;not explained by {comparison.symbol}&rdquo;
        rather than as real.
        </p>
      ) : null}
    </div>
  );
}
