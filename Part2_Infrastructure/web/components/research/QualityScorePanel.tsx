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
          How the {score.total} was reached
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

      {/* A methodology note sat here — how the weights were derived, and which
          instrument the benchmark category measured against. The desk asked for
          it to go, and neither fact goes with it: the weights are on every row
          above, and the benchmark is named inside that category's own detail
          line, which `qualityInputFromSweep` builds. Do not restore the
          paragraph; extend the detail line instead. */}

      <p className="quality-gate-note">
        <span aria-hidden>{gate.eligible ? "✓" : "✕"}</span>{" "}
        <strong className="num">
          {gate.passed} of {gate.total}
        </strong>{" "}
        promotion criteria met.{" "}
        {gate.eligible
          ? "The gate below lists them."
          : "The score ranks candidates; the gate below vetoes them, and a high score does not override a veto."}
      </p>
    </div>
  );
}

/** Points this category contributed to the total, in the total's own units. */
function contribution(category: QualityCategory): number {
  return (category.score * category.weight) / 100;
}
