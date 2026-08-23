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
 *
 * THE FIGURES ARE A TABLE
 *
 * Since 2026-08-23, on a reader's request. The two-by-three `<dl>` it replaces
 * set each label, figure and reading at three sizes in a cell with no edge,
 * and because the readings ran one line here and two there, the six cells
 * bottomed out at four different heights. Now every measure is a row — its
 * name, its figure, what to make of it — in the same frame, header band and
 * column rules the factor table beside it already wears. The empty state
 * keeps the same two rows, dashed, so the shape says which two measurements a
 * benchmark buys.
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
  "No benchmark control on this screen; it lives in the research rail's setup panel.";

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

        <div className="table-wrap" tabIndex={0}>
          <table className="benchmark-table">
            <caption className="sr-only">
              The two measurements a benchmark would add, both withheld.
            </caption>
            <thead>
              <tr>
                <th scope="col">Measure</th>
                <th scope="col">Value</th>
                <th scope="col">Reading</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Alpha (annualised)</th>
                {/* The dash is the measurement's absence, not a value near zero. */}
                <td className="num">{fmt(null)}</td>
                <td className="benchmark-table__reading">What a benchmark would not explain. {cause}</td>
              </tr>
              <tr>
                <th scope="row">Beta</th>
                <td className="num">{fmt(null)}</td>
                <td className="benchmark-table__reading">Exposure to a benchmark&rsquo;s own moves. {cause}</td>
              </tr>
            </tbody>
          </table>
        </div>

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
        {/* `.section-note`, not `num muted`, and thousands-separated. This slot
            is the desk's counter slot — 01-workspace-shell.css names it as
            such ("12/200 entries", "8/20 routable") and gives it the sans face
            at --fs-sm — and every other research card's head uses it, this
            panel's OWN empty state four screens up included. Set in mono at
            the inherited body size it read a size larger and a face apart from
            the head of FactorPanel, the card it shares a row with in the
            Explain pane. The separator matches too: FactorPanel prints
            `{r.n.toLocaleString()} bars` beside this, so an unseparated 9431
            sat next to a separated 9,431 measuring the same kind of thing. */}
        <span className="section-note">{comparison.alignedBars.toLocaleString()} aligned bars</span>
      </div>

      <p className="sub">
        Ordinary least squares on {comparison.symbol}&rsquo;s bar returns. The intercept is what
        {" "}{comparison.symbol} does not explain — not, on its own, evidence of an edge.
      </p>

      <div className="table-wrap" tabIndex={0}>
        <table className="benchmark-table">
          <caption className="sr-only">
            The regression on {comparison.symbol}: alpha, beta, correlation and tracking error,
            then {comparison.symbol}&rsquo;s own return and Sharpe over the aligned window.
          </caption>
          <thead>
            <tr>
              <th scope="col">Measure</th>
              <th scope="col">Value</th>
              <th scope="col">Reading</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Alpha (annualised)</th>
              {/* Only a statistically distinguishable alpha is emphasised. An
                  unconditional highlight on the headline number teaches the eye
                  that every run has one. */}
              <td className={`num${alphaSignificant ? " is-emphasis" : ""}`}>
                {pct(comparison.alphaAnnualised)}
              </td>
              <td className="benchmark-table__reading">
                t = {fmt(comparison.alphaTStat, 2)}, p = {fmt(comparison.alphaPValue, 3)}
                {alphaSignificant ? "" : " — not distinguishable from zero"}
              </td>
            </tr>
            <tr>
              <th scope="row">Beta</th>
              <td className="num">{fmt(comparison.beta, 2)}</td>
              <td className="benchmark-table__reading">
                {/* A beta near zero with a large R² is impossible; a beta near zero
                    with a small one just means the benchmark explains nothing. */}
                {Math.abs(comparison.beta) < 0.2
                  ? "Moves largely independently of the benchmark."
                  : comparison.beta > 1
                    ? "Amplifies the benchmark's moves."
                    : "Damped relative to the benchmark."}
              </td>
            </tr>
            <tr>
              <th scope="row">Correlation</th>
              <td className="num">{fmt(comparison.correlation, 2)}</td>
              <td className="benchmark-table__reading">R² {pct(comparison.rSquared)} of variance explained</td>
            </tr>
            <tr>
              <th scope="row">Tracking error</th>
              <td className="num">{pct(comparison.trackingError)}</td>
              <td className="benchmark-table__reading">
                {comparison.informationRatio === null
                  ? "Information ratio undefined on a flat active return."
                  : `Information ratio ${fmt(comparison.informationRatio, 2)}`}
              </td>
            </tr>
            <tr>
              <th scope="row">{comparison.symbol} return</th>
              <td className="num">{pct(comparison.totalReturn)}</td>
              <td className="benchmark-table__reading">buy-and-hold, over the aligned window</td>
            </tr>
            <tr>
              <th scope="row">{comparison.symbol} Sharpe</th>
              <td className="num">{fmt(comparison.sharpe, 2)}</td>
              <td className="benchmark-table__reading">max drawdown {pct(comparison.maxDrawdown)}</td>
            </tr>
          </tbody>
        </table>
      </div>

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
