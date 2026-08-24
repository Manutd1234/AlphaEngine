"use client";

/**
 * What the estimator actually computes, one card per expression.
 *
 * The tab drew every OUTPUT of this model and none of the model. A reader could
 * see that the statement is half absorbed in some number of seconds and had no
 * way to find out what "absorbed" is, what divides it, or what the engine does
 * when it cannot tell.
 *
 * THE CARDS ARE THE CURRICULUM'S GRAMMAR, deliberately and at no cost. `Lessons`
 * already renders a claim as a title, a summary, a plain Unicode formula, and a
 * `<dl>` of when-it-holds against what-breaks-it; those classes are declared in
 * `10a` and this file adds none. A reader who has met a lesson card knows how to
 * read one of these, which is the whole argument for one component library
 * across both tabs.
 *
 * PLAIN UNICODE, NEVER KaTeX. `lib/coherence/lessons.ts` states the rule for the
 * curriculum — "There is no KaTeX here and none may be added" — and it holds
 * here for the same reason: a maths renderer is a dependency, and the desk ships
 * on Next, React, lucide, supabase-js and oracledb.
 *
 * EVERY CARD NAMES WHAT BREAKS IT, and that is not decoration either. The
 * catalogue's rule is that a lesson which says only what is true teaches a
 * reader to trust it everywhere, and every expression below has a boundary that
 * matters more than the statement — a terminal that makes one stage's half-life
 * true by construction, an asymptote search that walks upward if it is scored in
 * the wrong space, a whitening step that deletes the measurement.
 *
 * EVERY CARD NAMES ITS REFERENCE MODULE, because Python is the reference and a
 * formula a reader cannot check against source is a formula they have to take on
 * trust. `diffusion-model-views.test.ts` asserts each path is a real module.
 */

/** Which half of the model a formula belongs to. */
export type FormulaPart = "measurement" | "instrument";

interface ModelFormula {
  id: string;
  part: FormulaPart;
  title: string;
  summary: string;
  formula: string;
  holds: string;
  breaks: string;
  reference: string;
}

/**
 * The model, in reading order: the measurement, its gate, its clock, the two
 * fits that are never the verdict, and the instrument built on top.
 */
const FORMULAS: readonly ModelFormula[] = [
  {
    id: "absorbed",
    part: "measurement",
    title: "The absorbed fraction",
    summary:
      "How much of the move this stage eventually produced had already happened by each horizon. The denominator is the move at one terminal, the same number of minutes from each stage's own t₀.",
    formula: "absorbed(h) = ar(h) / ar(T*)",
    holds: "Both stages are measured over windows of equal length, each from its own start, so a difference between them is a difference in absorption rather than in the grid.",
    breaks:
      "Ending the release window where the press conference starts makes absorbed(release, T) identically one and bounds its half-life below thirty minutes BY CONSTRUCTION — the two stages then differ because of the grid, and a bootstrap confirms it with any data at all.",
    reference: "modules/coherence/diffusion/absorption.py",
  },
  {
    id: "overshoot",
    part: "measurement",
    title: "The denominator is never clipped",
    summary:
      "A path that overshoots and comes back has an absorbed fraction above one somewhere, and it is recorded that way.",
    formula: "absorbed(h) ∈ ℝ,  not [0, 1]",
    holds: "Overshoot is a real thing markets do, and counting it keeps the half-life the length it was.",
    breaks:
      "Clipping to [0, 1] turns every overshoot into “fully absorbed early” and makes the half-life shorter than it was measured to be.",
    reference: "modules/coherence/diffusion/absorption.py",
  },
  {
    id: "floor",
    part: "measurement",
    title: "The noise floor",
    summary:
      "A stage is only measured if its terminal move clears the pre-event volatility by a stated multiple. σ is the standard deviation of pre-event bar returns, scaled to the terminal horizon.",
    formula: "|ar(T*)| ≥ k × σ_pre × √bars,   k = 2",
    holds: "There are at least DIFFUSION_PRE_MIN_BARS pre-event returns to estimate σ from.",
    breaks:
      "numpy.std of one observation is 0.0, so a floor of 2σ with no pre-window admits EVERY event. Below the bar minimum the scale is undefined and the report says insufficient_pre_window rather than passing.",
    reference: "modules/coherence/diffusion/absorption.py",
  },
  {
    id: "halflife",
    part: "measurement",
    title: "The half-life crossing",
    summary:
      "The first horizon at which the absorbed fraction reaches a half, interpolated between the two grid points that bracket it.",
    formula: "t½ = exp( log x₀ + w × (log x₁ − log x₀) ),   w = (½ − a₀)/(a₁ − a₀)",
    holds: "The curve is monotone between the two horizons it crosses a half between — one assumption, and the only one this statistic makes.",
    breaks:
      "Interpolating LINEARLY places the crossing at the arithmetic midpoint of a cell that spans a doubling, because the grid is geometric. Snapping to the later horizon instead quantises every half-life onto the grid and makes the distribution a picture of the sampler rather than of the market.",
    reference: "modules/coherence/diffusion/decay.py",
  },
  {
    id: "states",
    part: "measurement",
    title: "When there is no crossing",
    summary:
      "Three of the four outcomes are refusals, and each names itself rather than returning a number.",
    formula: "ok | at_or_before_first | never_reached | too_few_points",
    holds: "Every refusal carries the reason, so a missing half-life is distinguishable from a fast one.",
    breaks:
      "Returning the first horizon when the path was already past a half reports the GRID's resolution as a measurement; returning the window length when it never halved reports a bound as a value.",
    reference: "modules/coherence/diffusion/decay.py",
  },
  {
    id: "exponential",
    part: "measurement",
    title: "The exponential fit",
    summary:
      "A decay in the unpriced fraction u = 1 − absorbed, with an asymptote chosen from a grid. Reported because the shape is interesting; never the number a verdict turns on.",
    formula: "u(h) = u∞ + A·e^(−h/τ),   t½ = τ × ln 2",
    holds: "Selection is on the sum of squares in u-space, so the two fits are scored on what was actually asked.",
    breaks:
      "Choosing u∞ by the residual of the LINEARISED regression instead: the log compresses the residual range as u∞ rises, so the search walks the asymptote upward until the fit looks good.",
    reference: "modules/coherence/diffusion/decay.py",
  },
  {
    id: "power",
    part: "measurement",
    title: "The power-law alternative",
    summary:
      "The same curve read as a power law, scored in the same space so the two are comparable.",
    formula: "u(h) = c·h^(−b),   t½ = (½ / c)^(1/b)",
    holds: "The fitted exponent decays and the coefficient is positive; otherwise there is no half-life to report and the fit says so.",
    breaks:
      "Either parametric fit can manufacture a difference between two stages that the data does not contain. Phase 0's statistic is non-parametric ON PURPOSE, and these are reported beside it rather than instead of it.",
    reference: "modules/coherence/diffusion/decay.py",
  },
  {
    id: "clock",
    part: "instrument",
    title: "The volatility clock",
    summary:
      "A horizon's position measured in the variance that matched no-news windows had accumulated by then, rather than in wall-clock seconds.",
    formula: "x(h) = Σ_controls RV accumulated by h",
    holds: "The clock is built from OTHER windows — the same clock time on the nearest prior days, where the intraday volatility seasonal lives.",
    breaks:
      "Measuring time in the EVENT's own realised variance is circular: the jump is most of that variance, so the clock becomes a monotone transform of the thing it was meant to normalise.",
    reference: "modules/coherence/diffusion/clock.py",
  },
  {
    id: "percentile",
    part: "instrument",
    title: "The control percentile",
    summary:
      "Where a stage sat against matched windows on prior days at the same clock time. 0.0 is faster than every one of them; 0.5 is indistinguishable from an ordinary half hour.",
    formula: "p = rank(stage) / n_controls",
    holds: "Enough matched windows cleared the floor to rank against; otherwise no percentile is reported.",
    breaks:
      "A half-life alone cannot tell a complicated announcement from a quiet hour. Without the percentile, “slow” and “nothing was happening” read identically.",
    reference: "modules/coherence/diffusion/clock.py",
  },
  {
    id: "mmse",
    part: "instrument",
    title: "The Gaussian null",
    summary:
      "The denoising error of a Gaussian fitted to the same covariance, in closed form. A model that cannot beat this curve has learned nothing.",
    formula: "mmse(α) = Σᵢ σ(α + log λᵢ)",
    holds: "It is computed rather than eyeballed, which is what makes it an automated gate.",
    breaks:
      "Integrating the RAW error over log-SNR diverges at both ends; only the DIFFERENCE against a matched Gaussian converges, which is the whole trick of the information-theoretic formulation.",
    reference: "modules/coherence/diffusion/gaussian.py",
  },
  {
    id: "spectrum",
    part: "instrument",
    title: "The information spectrum",
    summary:
      "A density over resolution rather than a total. Mass at low α means the conditioning explains structure that survives heavy noise — the coarse, headline-shaped part; mass at high α means detail that appears only once the noise is nearly gone.",
    formula: "g(α) = ½ Σᵢ [ σ(α + log λᵢ) − σ(α + log μᵢ) ]",
    holds: "It needs no cut point between coarse and fine, because it is a distribution rather than a split.",
    breaks:
      "THE LATENT MUST NOT BE WHITENED. Whitening sends every log λᵢ to zero, collapses the spectrum to a single bump at α = 0, and destroys the resolution axis the whole instrument reads. It is the natural thing to reach for and it deletes the measurement.",
    reference: "modules/coherence/diffusion/gaussian.py",
  },
  {
    id: "identity",
    part: "instrument",
    title: "The identity the spectrum satisfies",
    summary:
      "The spectrum's integral over the whole log-SNR axis is exactly the mutual information — which is why this can be drawn with no network, no training and no torch.",
    formula: "∫ g(α) dα = ½ Σᵢ (log λᵢ − log μᵢ) = I(x;c)",
    holds: "For jointly Gaussian (x, c) it is exact, and it is the known answer the learned estimator is tested against.",
    breaks:
      "The learned estimator is non-negative and biased UPWARD — two imperfect denoisers differ even when the conditioning carries nothing — so a small positive number is not evidence of information, and a centroid needs a floor from a shuffled null rather than from the standard error.",
    reference: "modules/coherence/diffusion/estimator.py",
  },
  {
    id: "skill",
    part: "instrument",
    title: "Out-of-sample skill",
    summary:
      "How much of the absorption clock is predictable, split into what the stage and the rate move alone give, and what reading the text adds to that.",
    formula: "R² = 1 − SS_res / SS_tot,   gain = R²(text) − R²(baseline)",
    holds: "Both are measured out of sample; the baseline is read FIRST, because a text null measured against an unpredictable target is not a finding about the text.",
    breaks:
      "A negative gain means reading the statement made the estimate worse, which is a real outcome and is reported rather than floored at zero.",
    reference: "modules/coherence/diffusion/skill.py",
  },
];

/**
 * Two views rather than one, and the measurement is why.
 *
 * All thirteen on one view came to 2,724px at desk width and 3,142px at 1100 —
 * four times the next largest view on the tab and the longest thing on the desk,
 * measured by `scripts/section-density-measure.mjs` on its first run. Folding the
 * confident half of each card into a disclosure took it to 2,065px, which is
 * better and still the longest.
 *
 * So it splits where the model splits: what the estimator MEASURES on a price
 * path, and the INSTRUMENT built on top of it. Seven cards and six, each landing
 * in the range every other view on this tab occupies. The same move as the
 * grouping slices — a control is cheaper than a scroll.
 */
export default function ModelFormulas({ part }: { part: FormulaPart }) {
  const shown = FORMULAS.filter((entry) => entry.part === part);
  return (
    <>
      <p className="coh-event__note">
        {part === "measurement"
          ? "What the estimator computes on a price path: the absorbed fraction, the gate that decides whether there was a move at all, the crossing, and the two fits that are reported but never the verdict."
          : "The instrument built on top of it: a clock that is not made of the event, and the closed-form information spectrum the diffusion study reads."}{" "}
        Each names the module that is its reference implementation — Python is the reference, and the browser
        twin is held to it by a fixture that module writes.
      </p>

      <div className="coh-lessons__grid">
        {shown.map((entry) => (
          <article className="coh-lesson" key={entry.id}>
            <header className="coh-lesson__head">
              <h4 className="console-subhead">{entry.title}</h4>
              <span className="coh-lesson__state">
                <code>{entry.reference.split("/").pop()}</code>
              </span>
            </header>

            <code className="coh-lesson__formula">{entry.formula}</code>

            {/* THE BOUNDARY STAYS OPEN AND THE CONFIDENT HALF FOLDS, which is
                the exact inverse of the usual disclosure and is what
                `LessonsPane`'s rule actually asks for. That header refuses to
                hide "what breaks it", because folding the failure mode leaves
                the confident half on screen and hides the half that stops a
                reader over-applying the claim. Hiding the confident half is
                therefore the move that argument PERMITS — and it is the one
                this view needed: measured at 2,724px with everything open, it
                was the longest thing on the desk by a factor of four. */}
            <dl className="coh-lesson__bounds">
              <div className="is-fails">
                <dt>What breaks it</dt>
                <dd>{entry.breaks}</dd>
              </div>
            </dl>

            <details className="disclosure">
              <summary>What it measures, and when it holds</summary>
              <p className="coh-lesson__summary">{entry.summary}</p>
              <dl className="coh-lesson__bounds">
                <div className="is-holds">
                  <dt>When it holds</dt>
                  <dd>{entry.holds}</dd>
                </div>
              </dl>
            </details>
          </article>
        ))}
      </div>
    </>
  );
}
