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
 *
 * WHAT THE EMPTY STATE OWES THE READER
 *
 * Three things, and not one of them is a figure this card was not given. It
 * keeps the card's own shape — alpha and beta dashed, each saying what it would
 * have measured and why it is absent — so the reader can see which two
 * measurements a benchmark buys and that neither has been filled in. It
 * separates the two questions by name: the same-symbol buy-and-hold figures
 * already sit in this run's stat row under Summary, beside the strategy's own
 * return and Sharpe, and they answer whether the TIMING helped; this card
 * answers whether the POSITION did, and only a second instrument can. And it
 * moves the reader to the control rather than describing where the control is.
 *
 * What it deliberately does NOT do is restate those buy-and-hold figures here.
 * They are paired with the strategy's own numbers where a reader actually
 * compares them — `interaction.test.ts` pins that pairing and keeps the verdict
 * card from quoting them either — and a second copy of them inside a card
 * headed "versus benchmark" is the precise substitution `lib/types.ts` refuses:
 * the same symbol wearing the word benchmark.
 */

import { useState } from "react";

import { fmt, pct } from "@/lib/format";
import type { BenchmarkComparison } from "@/lib/types";

interface BenchmarkPanelProps {
  comparison: BenchmarkComparison | null | undefined;
  /** What was asked for, so the empty state can say which one failed. */
  requested: string | undefined;
}

/** Conventional threshold, stated rather than implied by a colour. */
const SIGNIFICANT_P = 0.05;

/**
 * The id of the benchmark `<select>` in the research rail's setup panel.
 *
 * A jump to the one real control, never a second select rendered here: a copy
 * would own no part of the request and would drift from the one that does.
 * `benchmark.test.ts` pins this id against `Controls.tsx` in both directions, so
 * the affordance cannot rot into a jump at an element that is no longer there.
 * The sentence this replaced could not fail that way, which sounds like a virtue
 * and is not: prose cannot miss, so nothing checked that it still resolved.
 */
const BENCHMARK_CONTROL_ID = "benchmark";

/** Said when the control is in the DOM but the collapsed rail keeps it unfocusable. */
const COLLAPSED_HINT =
  "Collapsed at this width. Open Edit setup in the research rail, then choose Benchmark.";

/** Said when there is no control on the screen at all, which is not this card's to fix. */
const ABSENT_HINT =
  "The benchmark control is not on this screen; it lives in the research rail's setup panel.";

export default function BenchmarkPanel({ comparison, requested }: BenchmarkPanelProps) {
  /**
   * Whether the jump landed, reported rather than assumed.
   *
   * On a narrow viewport the setup panel collapses and the select is
   * `display: none` — present in the DOM, unfocusable, and `focus()` there is a
   * silent no-op. A button that appears to do nothing is worse than the
   * sentence it replaced, so the result is checked and said out loud.
   */
  const [reachNote, setReachNote] = useState<string | null>(null);

  const focusBenchmarkControl = () => {
    const control = document.getElementById(BENCHMARK_CONTROL_ID);
    if (!control) {
      setReachNote(ABSENT_HINT);
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    control.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
    control.focus({ preventScroll: true });
    setReachNote(document.activeElement === control ? null : COLLAPSED_HINT);
  };

  if (!comparison) {
    // Two absent cases, two different actions: pick one, or pick a different
    // one. They are never collapsed into "no comparison available".
    const failed = Boolean(requested);
    // Which of the two failures it was is the paragraph's job; the dash says
    // only what it is entitled to — that no comparable series reached the fit.
    const cause = failed
      ? `No comparable series for ${requested}.`
      : "No benchmark is selected.";

    return (
      <div className="card">
        <div className="section-heading compact">
          <div>
            <h2>Versus benchmark</h2>
          </div>
          <span className="section-note">
            {failed ? `${requested} did not compare` : "none selected"}
          </span>
        </div>

        <p className="sub">
          {failed
            ? `${requested} was requested but did not compare: either its bars did not load, or `
              + "too few timestamps lined up with this run's."
            : "No benchmark selected. Alpha and beta need an instrument other than the one this "
              + "strategy trades, so both are withheld."}
        </p>

        <dl className="benchmark-grid">
          <div>
            <dt>Alpha (annualised)</dt>
            {/* The dash is the measurement's absence, not a value near zero. */}
            <dd className="num">{fmt(null)}</dd>
            <small className="muted">What a benchmark would not explain. {cause}</small>
          </div>
          <div>
            <dt>Beta</dt>
            <dd className="num">{fmt(null)}</dd>
            <small className="muted">Exposure to a benchmark&rsquo;s own moves. {cause}</small>
          </div>
        </dl>

        <p className="sub">
          The Summary stat row already answers whether the <em>timing</em> helped. Only a second
          instrument answers whether the <em>position</em> was worth holding.
        </p>

        <button type="button" className="text-action" onClick={focusBenchmarkControl}>
          {failed ? "Choose a different benchmark →" : "Choose a benchmark →"}
        </button>
        {reachNote ? (
          <p className="sub" role="status">
            {reachNote}
          </p>
        ) : null}
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
        Ordinary least squares on {comparison.symbol}&rsquo;s bar returns. The intercept is what
        {" "}{comparison.symbol} does not explain — not, on its own, evidence of an edge.
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

      {/* The same jump as the empty state's, kept here because a loaded
          comparison is the most common moment for wanting a different one. */}
      <button type="button" className="text-action" onClick={focusBenchmarkControl}>
        Compare against another instrument →
      </button>
      {reachNote ? (
        <p className="sub" role="status">
          {reachNote}
        </p>
      ) : null}

      {/* The caveat stays with the number it qualifies; the closing clause that
          repeated the paragraph above the dl is gone.

          The tier gate that used to wrap this is gone too, and its removal is
          the point rather than a side effect. `atLeast(tier, "full")` meant a
          Guided or Standard reader was shown a p-value beside Alpha and never
          told the standard error behind it is optimistic — the sentence was
          not in their DOM at all. A fold is strictly more honest than that:
          the words now exist for every reader at every tier, and what changes
          between tiers is nothing. `complexity.test.ts` states the same rule
          for the two panels that do tier — they open a disclosure rather than
          drop content — and this panel now has no reason to tier at all. */}
      <details className="disclosure">
        <summary>How much should these t-statistics be trusted?</summary>
        <p className="research-note">
        Plain OLS t-statistics. A Newey&ndash;West correction for heteroskedastic, autocorrelated
        returns would widen these standard errors, so the significance shown is generous.
        </p>
      </details>
    </div>
  );
}
