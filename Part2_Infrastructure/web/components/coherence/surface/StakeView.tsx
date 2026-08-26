"use client";

/**
 * What log-optimal growth would put on this family, and the trap beside it.
 *
 * The trap is the one `kelly.py` spends a paragraph on. Where a family costs
 * less than the dollar it is certain to pay, a riskless profit exists — and
 * Kelly does NOT take it. Kelly stakes the measure, a different portfolio: it
 * grows faster and it can lose. So both numbers appear together, in words,
 * whenever the arbitrage is there; "growth-optimal" read as "riskless" is the
 * expensive misreading, and it is why the warning sits in this view.
 *
 * The truncation convention is NOT restated here. `SurfacePane` prints it
 * once for both of its sections.
 *
 * THREE VIEWS — Plan, Capital, Method — since the second 2026-08-24 pass. The
 * third pass gave Plan and Method their drawings (`StakeBars`, `GrowthBars`):
 * both opened on a bare table, and the ranked fractions and the growth
 * comparison are the two most drawable facts on the section. `toRatio` moved
 * to `StakeBars` with the bars; the warning stays on Plan because it is a
 * warning about the table under it, and its worst-case figure reappears as
 * the Method view's own row — the pair the claims test pins at two sites.
 *
 * THE FOURTH PASS FOLDED BOTH TABLES. Each view now opens on its drawing and
 * the table under it is a disclosure that counts its own rows: the bars answer
 * the view's question and the table is how the answer was reached, which is
 * the seam this whole pass cut on. Neither table lost a row or a column — the
 * warning above the Plan fold still names the worst case, so a reader who never
 * opens anything still meets the number that makes "growth-optimal is not
 * riskless" true.
 *
 * THE DECLINED BRANCH LEFT ON THE FIFTH PASS, to `StakeDeclined`. It printed
 * one grey line — "No stake was sized: {detail}" — over all three views, which
 * is what a reader saw first on this desk, because the family the watchlist
 * opens on is the one the solver refuses by name. An empty state that names the
 * next action is a section's own answer and not a footnote to this component's
 * three views, so `StakePane` draws it INSTEAD of these views rather than
 * inside them, and this file no longer needs the `/surface` payload at all.
 */

import { priceLabel } from "@/lib/coherence/fixed-point";
import type { CoherenceKelly } from "@/lib/coherence/types-lab";
import Figure, { FigureEmpty, Plot, StateChip } from "../Figure";
import { FactTable, row, type Fact } from "./DistributionView";
import { decimalLabel } from "@/lib/coherence/decimals";
import EdgeScatter from "./EdgeScatter";
import StakeBars, { GrowthBars, toRatio } from "./StakeBars";

const BAR_HEIGHT = 76;

function CapitalBar({ kelly }: { kelly: CoherenceKelly }) {
  const staked = kelly.staked_fraction;
  const cash = kelly.cash_fraction;
  const stakedWeight = toRatio(staked);
  const cashWeight = toRatio(cash);
  const caption = "Where a dollar of bankroll sits under this plan";
  if (stakedWeight == null || cashWeight == null) {
    return (
      <Figure
        caption={caption}
        ariaLabel="The capital split could not be drawn"
        missing="The solver returned no split, so nothing is drawn — an empty bar would read as all cash."
      >
        {/* The footnote above says why in full; the frame names the absence. */}
        <FigureEmpty reason="No split came back." />
      </Figure>
    );
  }
  const total = Math.max(stakedWeight + cashWeight, 1e-9);
  return (
    <Figure
      caption={caption}
      ariaLabel={`Capital split: ${decimalLabel(staked, 4)} staked, ${decimalLabel(cash, 4)} in cash`}
      // The two fractions are the bar's own labels, so the reading keeps only
      // the sentence the numbers do not say.
      reading="Cash is itself a position, held when no outcome is priced below what the measure says it is worth."
    >
      <Plot height={BAR_HEIGHT}>
        {(width) => {
          const stakedWidth = (stakedWeight / total) * width;
          return (
            <>
              <rect x={0} y={18} width={width} height={26} className="coh-kelly__bar-cash">
                <title>{`cash ${decimalLabel(cash, 6)}`}</title>
              </rect>
              <rect x={0} y={18} width={Math.max(0, stakedWidth)} height={26} className="coh-kelly__bar-staked">
                <title>{`staked ${decimalLabel(staked, 6)}`}</title>
              </rect>
              <text x={2} y={12} className="coh-kelly__bar-label">
                {`■ staked ${decimalLabel(staked, 4)}`}
              </text>
              <text x={width - 2} y={12} textAnchor="end" className="coh-kelly__bar-label">
                {`□ cash ${decimalLabel(cash, 4)}`}
              </text>
              <text x={2} y={60} className="coh-kelly__bar-label">
                {`worst case, one dollar becomes ${decimalLabel(kelly.worst_case_wealth, 4)}`}
              </text>
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}

/** The stake ledger, over whichever slice of the family it is handed. */
export function StakeTable({ stakes, caption }: { stakes: CoherenceKelly["stakes"]; caption: string }) {
  return (
    <div className="table-wrap">
      <table className="coh-table">
        <caption className="coh-table__caption">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Outcome</th>
            <th scope="col">Admitted</th>
            <th scope="col" className="num">Measure</th>
            <th scope="col" className="num">Price</th>
            <th scope="col" className="num">Edge</th>
            <th scope="col" className="num">Full Kelly</th>
            <th scope="col" className="num">Stake</th>
          </tr>
        </thead>
        <tbody>
          {stakes.map((stake) => (
            <tr key={stake.ticker}>
              <th scope="row">{stake.label}</th>
              <td>{stake.admitted ? "✓ admitted" : "○ passed over"}</td>
              <td className="num">{priceLabel(stake.probability)}</td>
              <td className="num">{priceLabel(stake.price)}</td>
              <td className="num">{decimalLabel(stake.edge, 4)}</td>
              <td className="num">{decimalLabel(stake.full_fraction, 4)}</td>
              <td className="num">{decimalLabel(stake.fraction, 4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function planFacts(kelly: CoherenceKelly): Fact[] {
  const riskless = !kelly.arbitrage_available
    ? "No riskless profit is available in these prices."
    : kelly.riskless_growth
      ? "The certain alternative in the same log units, NOT what the plan above earns."
      : "A riskless profit exists, but no growth was priced: the plan admits no stake.";
  return [
    row("Staked", decimalLabel(kelly.staked_fraction, 4),
      kelly.staked_fraction ? "Fraction of the bankroll on contracts, after shrinkage." : "The solver returned no staked fraction."),
    row("Cash", decimalLabel(kelly.cash_fraction, 4),
      kelly.cash_fraction ? "Fraction left unstaked." : "The solver returned no cash fraction."),
    row("Shrinkage", decimalLabel(kelly.shrinkage, 4),
      "The fraction of full Kelly taken. Growth is flat near the optimum and steep past it, so over-betting costs more than under-betting."),
    row("Growth rate (at risk)", decimalLabel(kelly.growth_rate, 4),
      kelly.growth_rate
        ? "Expected log growth per resolution IF the measure is right — an average over states, promising nothing about any one."
        : "Not computed: no stake was admitted."),
    row("Riskless growth (not this plan)", decimalLabel(kelly.riskless_growth, 4), riskless),
    row("Worst-case wealth", decimalLabel(kelly.worst_case_wealth, 4),
      "What a dollar becomes in the worst outcome. Below one, this plan loses money in that state — the whole difference from an arbitrage."),
    row("Basket cost", decimalLabel(kelly.basket_cost, 4),
      "One contract of every outcome pays a flat dollar; under 1.0000 is the arbitrage condition."),
  ];
}

/** The stake section's three views, driven by `SurfacePane`'s switcher. */
export type StakeViewName = "plan" | "capital" | "method";

export default function StakeView({
  kelly,
  view = "plan",
}: {
  kelly: CoherenceKelly;
  /** Which of the three views to draw. Defaults so a direct render still works. */
  view?: StakeViewName;
}) {
  if (view === "capital") {
    return (
      <div className="coh-kelly">
        <CapitalBar kelly={kelly} />
      </div>
    );
  }

  if (view === "method") {
    const facts = planFacts(kelly);
    return (
      <div className="coh-kelly">
        <GrowthBars kelly={kelly} />
        {/* The bars ARE the method's headline — the plan's growth against the
            certain alternative — and the table is the seven readings that
            comparison is made of. Folded on the fourth pass of 2026-08-24, with
            the count in the summary; the third column is what only the table
            carries, so it is what the summary promises. */}
        <details className="disclosure">
          <summary>
            The {facts.length} readings behind the two bars, and what each lets you say
          </summary>
          <FactTable caption="The plan, and the riskless alternative" facts={facts} />
        </details>
      </div>
    );
  }

  const admitted = kelly.stakes.filter((stake) => stake.admitted);
  return (
    <div className="coh-kelly">
      {/* One chip, not three: shrinkage is a Method row, and an arbitrage chip
          restated the warning and the Basket-cost row. */}
      <div className="coh-status__chips">
        <StateChip mark="◇" word="Log-optimal over one family" value={`${admitted.length}/${kelly.stakes.length} admitted`} tone="muted" />
      </div>

      {kelly.arbitrage_available ? (
        <p className="coh-kelly__warning">
          <span aria-hidden="true">▲</span> Riskless profit on screen: every outcome bought together costs{" "}
          {decimalLabel(kelly.basket_cost, 4)} for a certain dollar, worth {decimalLabel(kelly.riskless_growth, 4)} of
          log growth. <strong>The plan below is not that trade.</strong> It stakes the measure, not equal numbers of
          every outcome, so it grows faster at {decimalLabel(kelly.growth_rate, 4)} and can lose — a dollar becomes{" "}
          {decimalLabel(kelly.worst_case_wealth, 4)} in the worst outcome. Growth-optimal is not riskless.
        </p>
      ) : null}

      {admitted.length ? (
        <>
          <StakeBars stakes={admitted} caption="The admitted stakes, as shares of the bankroll" />
          {/* The bars draw the Stake column and nothing else, which is the
              ranking a reader came for. Measure, price, edge and full Kelly are
              how the ranking was arrived at — per-row detail, folded since the
              fourth pass of 2026-08-24 and counted in its own summary. */}
          <details className="disclosure">
            <summary>
              Every admitted stake with its measure, price, edge and full-Kelly fraction, {admitted.length}{" "}
              {admitted.length === 1 ? "row" : "rows"}
            </summary>
            <StakeTable
              stakes={admitted}
              caption="Only the outcomes the plan stakes; the ones it passed over are the All outcomes view."
            />
          </details>
        </>
      ) : (
        <p className="coh-kelly__note">
          <span aria-hidden="true">○</span> No outcome is admitted: {kelly.detail}. That is a result, not a failure.
        </p>
      )}

      {/* WHY, drawn, and on BOTH branches. Fed the market's own mids the solver
          returns "stake nothing" — this section's own lede says so — which makes
          the empty branch the one a reader normally lands on, and until
          2026-08-25 it was a single grey sentence. The scatter answers the
          question that sentence raises: every outcome against what the measure
          says it is worth, with the line where those agree.

          Not only on the empty branch, because a plan that staked three of
          sixty raises the same question about the other fifty-seven, and a
          figure that appeared only when the answer was "none" would teach a
          reader that no news is no picture. */}
      <EdgeScatter kelly={kelly} />
    </div>
  );
}
