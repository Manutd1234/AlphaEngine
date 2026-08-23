"use client";

/**
 * What log-optimal growth would put on this family, and the trap beside it.
 *
 * The trap is the one `kelly.py` spends a paragraph on. Where a family costs
 * less than the dollar it is certain to pay, a riskless profit exists — and
 * Kelly does NOT take it. Kelly stakes the measure, a different portfolio: it
 * grows faster and it can lose. So both numbers appear together, in words,
 * whenever the arbitrage is there; "growth-optimal" read as "riskless" is the
 * expensive misreading, and it is why the warning sits in this view rather
 * than beside the whole-family ranking.
 */

import { priceLabel } from "@/lib/coherence/fixed-point";
import type { CoherenceKelly, CoherenceSurface } from "@/lib/coherence/types-lab";
import Figure, { FigureEmpty, Plot, StateChip } from "../Figure";
import { decimalLabel, FactTable, row, type Fact } from "./DistributionView";

const BAR_HEIGHT = 76;

/**
 * A wire decimal as a plain number, for BAR GEOMETRY only. A Kelly fraction can
 * carry eighteen places, finer than a centicent, so `toCenticents` refuses it
 * and is right to. Pixels are not a quantity a reader checks: six places place
 * a rectangle, and every number a reader READS comes from `decimalLabel`.
 */
function toRatio(raw: string | null | undefined): number | null {
  if (raw == null || !/^-?\d*(?:\.\d*)?$/.test(raw.trim()) || !raw.trim()) return null;
  const [whole, fraction = ""] = raw.trim().split(".");
  const value = Number(whole || "0") + Number(`0.${fraction.slice(0, 6) || "0"}`);
  return Number.isFinite(value) ? value : null;
}

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
        missing="The solver returned no split, so nothing is drawn here — an empty bar would read as all cash."
      >
        <FigureEmpty reason="No staked or cash fraction was returned." />
      </Figure>
    );
  }
  const total = Math.max(stakedWeight + cashWeight, 1e-9);
  return (
    <Figure
      caption={caption}
      ariaLabel={`Capital split: ${decimalLabel(staked, 4)} staked, ${decimalLabel(cash, 4)} held in cash`}
      reading={`${decimalLabel(staked, 4)} of the bankroll goes on contracts and ${decimalLabel(cash, 4)} stays in cash. Cash is a position here: it is what the plan holds when no outcome is priced below what the measure says it is worth.`}
    >
      <Plot height={BAR_HEIGHT}>
        {(width) => {
          const stakedWidth = (stakedWeight / total) * width;
          return (
            <>
              <rect x={0} y={18} width={width} height={26} className="coh-kelly__bar-cash" />
              <rect x={0} y={18} width={Math.max(0, stakedWidth)} height={26} className="coh-kelly__bar-staked" />
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
    ? "No riskless profit is available in these prices, so there is nothing to compare the growth rate against."
    : kelly.riskless_growth
      ? "The certain alternative, in the same log units — NOT what the plan above earns: buying equal numbers of every outcome pays a flat dollar whatever happens, and this plan does not do that."
      : "A riskless profit exists in these prices, but no growth was priced for it here because the plan admits no stake at all.";
  return [
    row("Staked", decimalLabel(kelly.staked_fraction, 4),
      kelly.staked_fraction ? "Fraction of the bankroll on contracts, after shrinkage." : "The solver returned no staked fraction."),
    row("Cash", decimalLabel(kelly.cash_fraction, 4),
      kelly.cash_fraction ? "Fraction left unstaked. Holding it is a decision here, not a leftover." : "The solver returned no cash fraction."),
    row("Shrinkage", decimalLabel(kelly.shrinkage, 4),
      "The fraction of full Kelly actually taken. Growth is flat near the optimum and steep past it, so over-betting costs more than under-betting."),
    row("Growth rate (at risk)", decimalLabel(kelly.growth_rate, 4),
      kelly.growth_rate
        ? "Expected log growth per resolution IF the measure is right. An average over states, promising nothing about any single one."
        : "No growth was computed, because no stake was admitted."),
    row("Riskless growth (not this plan)", decimalLabel(kelly.riskless_growth, 4), riskless),
    row("Worst-case wealth", decimalLabel(kelly.worst_case_wealth, 4),
      "What a dollar becomes in the worst outcome of this family. Below one means this plan loses money in that state — which is the whole difference from an arbitrage."),
    row("Basket cost", decimalLabel(kelly.basket_cost, 4),
      "One contract of every outcome. Under 1.0000 is the arbitrage condition; the plan above still does not take it."),
  ];
}

const HEADING = "What a log-optimal plan would stake";

export default function StakeView({ kelly, surface }: { kelly: CoherenceKelly; surface: CoherenceSurface }) {
  if (kelly.engine === "unavailable") {
    return (
      <div className="coh-kelly">
        <h4>{HEADING}</h4>
        <p className="console-empty">
          <span aria-hidden="true">◌</span> No stake was sized: {kelly.detail}
        </p>
        {surface.engine === "ladder" ? (
          <p className="coh-kelly__note">
            That refusal is correct rather than a gap. On a strike ladder each market pays in several of the bins the
            Distribution view draws: a threshold wins in every state the threshold above it wins in, and more. The
            exclusive-family solver states one market per state, so it declines this family by name rather than
            approximating one it cannot express.
          </p>
        ) : null}
      </div>
    );
  }

  const admitted = kelly.stakes.filter((stake) => stake.admitted);
  return (
    <div className="coh-kelly">
      <h4>{HEADING}</h4>

      {/* One chip, not three. Shrinkage is row 3 of the plan table below, and
          the arbitrage chip said in four words what the warning paragraph and
          the Basket-cost row each already say in full. */}
      <div className="coh-status__chips">
        <StateChip mark="◇" word="Log-optimal over one family" value={`${admitted.length}/${kelly.stakes.length} admitted`} tone="muted" />
      </div>

      {kelly.arbitrage_available ? (
        <p className="coh-kelly__warning">
          <span aria-hidden="true">▲</span> One contract of every outcome costs {decimalLabel(kelly.basket_cost, 4)} and
          pays a dollar whatever happens, so a riskless profit is on the screen — worth{" "}
          {decimalLabel(kelly.riskless_growth, 4)} of log growth. <strong>The plan below is not that trade.</strong> The
          arbitrage buys equal numbers of every outcome, which is what makes its payoff flat and its profit certain.
          Kelly buys in proportion to the measure instead: a different portfolio, growing faster at{" "}
          {decimalLabel(kelly.growth_rate, 4)} and able to lose — a dollar becomes{" "}
          {decimalLabel(kelly.worst_case_wealth, 4)} in the worst outcome. Growth-optimal is not riskless.
        </p>
      ) : null}

      {admitted.length ? (
        <StakeTable stakes={admitted} caption="Every outcome the plan actually stakes, and what it stakes on it" />
      ) : (
        <p className="coh-kelly__note">
          <span aria-hidden="true">○</span> No outcome is admitted: {kelly.detail}. That is a result, not a failure —
          fed prices that already agree with the measure, a log-optimal plan holds cash.
        </p>
      )}

      <CapitalBar kelly={kelly} />
      <FactTable caption="The plan, and the riskless alternative beside it" facts={planFacts(kelly)} />
    </div>
  );
}
