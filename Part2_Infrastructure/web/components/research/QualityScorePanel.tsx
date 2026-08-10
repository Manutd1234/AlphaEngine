"use client";

/**
 * The composite score, and the reasons it is what it is.
 *
 * The whole hazard of a single number is that it travels further than its
 * caveats. Someone screenshots "82" and the DSR, the fold count and the
 * benchmark it was measured against stay behind. So this panel never renders
 * the total alone: the breakdown, the weights and the walk-forward caveat are
 * in the same box, not behind a disclosure.
 *
 * It sits ABOVE the promotion gate on the Decision tab on purpose. Two numbers
 * describing the same run — "82/100" and "4/6 cleared" — read as a contradiction
 * when they sit side by side, because a reader has no way to know they are
 * measuring different things. They are: the score ranks, the gate vetoes. A run
 * can score 82 and still be unpromotable because one veto is a veto. Stacking
 * them puts the ranking first and the vetoes immediately under it, which is the
 * order the decision is actually made in, and the footnote here names the gate
 * rather than restating its count as a rival headline.
 */

import { atLeast } from "@/lib/complexity";
import { qualityInputFromSweep, qualityScore, type QualityCategory } from "@/lib/quality-score";
import type { SweepResponse } from "@/lib/types";
import { useComplexity } from "@/lib/use-complexity";

interface QualityScorePanelProps {
  data: SweepResponse;
}

/**
 * Bar tone. Thresholds match `verdictFor`'s bands so a category the eye reads as
 * red can never sit inside a total the sentence calls strong.
 */
function toneFor(score: number): "good" | "warning" | "critical" {
  if (score >= 75) return "good";
  if (score >= 40) return "warning";
  return "critical";
}

export default function QualityScorePanel({ data }: QualityScorePanelProps) {
  const score = qualityScore(qualityInputFromSweep(data));
  const gate = data.promotion;
  const tier = useComplexity();
  // Guided collapses the six-category breakdown behind a summary that names it.
  // The total and the verdict never collapse: a score with no reasoning beside
  // it is the failure this panel was built to prevent, so the reasoning is one
  // labelled click away and never absent.
  const breakdownOpen = atLeast(tier, "standard");

  return (
    <div className="card quality-card">
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">Decision</span>
          <h2>Quality score</h2>
        </div>
        <span className={`quality-total is-${toneFor(score.total)}`}>
          <strong className="num">{score.total}</strong>
          <small>/ 100</small>
        </span>
      </div>

      <p className="sub">{score.verdict}</p>

      <details className="quality-disclosure" open={breakdownOpen}>
        <summary>
          How the {score.total} was reached — six weighted categories
        </summary>
      <ul className="quality-breakdown">
        {score.categories.map((category) => (
          <li key={category.id}>
            <div className="quality-row__head">
              <strong>{category.label}</strong>
              {/* The weighted contribution, not the raw category score. A row
                  reading "92" next to a total of 61 is the sort of thing that
                  makes a reader distrust the arithmetic rather than the run. */}
              <span className="num quality-row__points">
                {contribution(category).toFixed(1)}
                <span className="muted"> / {category.weight}</span>
              </span>
            </div>
            <span
              className={`console-meter console-meter--wide is-${toneFor(category.score)}`}
              role="img"
              aria-label={`${category.label}: ${Math.round(category.score)} out of 100`}
            >
              <i style={{ width: `${Math.max(0, Math.min(100, category.score))}%` }} />
            </span>
            <small className="muted">{category.detail}</small>
          </li>
        ))}
      </ul>
      </details>

      {atLeast(tier, "full") ? (
        <p className="research-note">
        Weighted from statistics this run already produced — nothing here is a forecast. The
        risk-adjusted category leads on the <strong>Deflated</strong> Sharpe rather than the raw
        one, and robustness carries 20 points of its own, because a grid search over{" "}
        <span className="num">{data.combosTested}</span> combinations makes the best raw Sharpe a
        biased estimate of the next one.{" "}
        {/* Named, not implied. "Versus benchmark" reads as "versus the market"
            to anyone who has used the phrase elsewhere, and for a run with no
            benchmark selected it is the same symbol held. */}
        {data.benchmarkComparison
          ? <>&ldquo;Versus benchmark&rdquo; compares against{" "}
              <span className="num">{data.benchmarkComparison.symbol}</span>, over the{" "}
              <span className="num">{data.benchmarkComparison.alignedBars}</span> bars the two
              series share.</>
          : <>&ldquo;Versus benchmark&rdquo; compares against buy-and-hold on{" "}
              <span className="num">{data.request.symbol}</span> itself — the alternative that
              costs one trade and no research. Select a benchmark in the controls to compare
              against another instrument instead.</>}
        </p>
      ) : null}

      <p className="quality-gate-note">
        <span aria-hidden>{gate.eligible ? "✓" : "✕"}</span>{" "}
        <strong className="num">
          {gate.passed} of {gate.total}
        </strong>{" "}
        promotion criteria met.{" "}
        {gate.eligible
          ? "The gate below lists them; every one cleared."
          : "The score ranks candidates, the gate vetoes them — a high score does not override a failed veto. The gate below names which."}
      </p>
    </div>
  );
}

/** Points this category contributed to the total, in the total's own units. */
function contribution(category: QualityCategory): number {
  return (category.score * category.weight) / 100;
}
