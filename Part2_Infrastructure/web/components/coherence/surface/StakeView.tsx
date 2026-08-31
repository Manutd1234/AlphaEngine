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

import { useState, type CSSProperties, type KeyboardEvent } from "react";

import { fmt } from "@/lib/format";
import { priceLabel } from "@/lib/coherence/fixed-point";
import type { CoherenceKelly } from "@/lib/coherence/types-lab";
import { StateChip } from "../Figure";
import { FactTable, row, type Fact } from "./DistributionView";
import { decimalLabel } from "@/lib/coherence/decimals";
import { HotSource, useHot } from "@/lib/coherence/use-hot";
import EdgeScatter from "./EdgeScatter";
import StakeBars, { GrowthBars, toRatio } from "./StakeBars";
import { useRovingListbox } from "../use-stable-selection-key";
import baseStyles from "../MarketStructures.module.css";
import stakeStyles from "../StakeInstrument.module.css";

const styles = { ...baseStyles, ...stakeStyles };

const BANKROLL_TOKEN_KEYS = Array.from({ length: 20 }, (_, index) => `token-${index + 1}`);
type StressStyle = CSSProperties & { "--stake-width": string };

function CapitalBar({ kelly }: { kelly: CoherenceKelly }) {
  const staked = kelly.staked_fraction;
  const cash = kelly.cash_fraction;
  const stakedWeight = toRatio(staked);
  const cashWeight = toRatio(cash);
  const worstWeight = toRatio(kelly.worst_case_wealth);
  const caption = "Capital allocation and terminal floor";
  const [selectedToken, setSelectedToken, tokenProps] = useRovingListbox(BANKROLL_TOKEN_KEYS);
  const [deployment, setDeployment] = useState(100);
  if (stakedWeight == null || cashWeight == null) {
    return (
      <figure className={styles.instrument} aria-label="Capital split unavailable">
        <figcaption className={styles.head}><span>{caption}</span><strong>withheld</strong></figcaption>
        <p className="coh-figure__missing">
          <span aria-hidden="true">◌</span>
          <span>No solver split; an empty vault would imply all cash.</span>
        </p>
      </figure>
    );
  }
  const total = Math.max(stakedWeight + cashWeight, 1e-9);
  const stakedCoins = Math.round((stakedWeight / total) * 20);
  const selectedIndex = Math.max(0, BANKROLL_TOKEN_KEYS.indexOf(selectedToken ?? ""));
  const focus = selectedIndex < stakedCoins ? "staked" : "cash";
  const amount = focus === "staked" ? staked : cash;
  const scale = deployment / 100;
  const simulatedStake = stakedWeight * scale;
  const simulatedCash = 1 - simulatedStake;
  const simulatedFloor = worstWeight == null ? null : 1 - (1 - worstWeight) * scale;
  return (
    <figure className={styles.instrument} aria-label={`Capital split: ${decimalLabel(staked, 4)} staked, ${decimalLabel(cash, 4)} cash`}>
      <figcaption className={styles.head}>
        <span><small>Bankroll vault</small>{caption}</span><strong>20 tokens at 5% each</strong>
      </figcaption>
      <div className={styles.vault}>
        <div className={styles.coinField} role="listbox" aria-label="Inspect bankroll allocation tokens">
          {Array.from({ length: 20 }, (_, index) => {
            const isStaked = index < stakedCoins;
            const key = BANKROLL_TOKEN_KEYS[index]!;
            return <button type="button" key={index} className={styles.coin} data-staked={isStaked}
                           role="option" aria-selected={selectedToken === key}
                           aria-label={`Token ${index + 1}: ${isStaked ? "staked" : "cash"}`}
                           {...tokenProps(key, index)}
                           onClick={() => setSelectedToken(key)}>{index + 1}</button>;
          })}
        </div>
        <output className={styles.vaultReadout} aria-live="polite" aria-atomic="true">
          <small>{focus === "staked" ? "Capital at risk" : "Residual cash"}</small>
          <strong className="num">{decimalLabel(amount, 4)}</strong>
          <span className={styles.vaultDetail}>{focus === "staked" ? `About ${stakedCoins} of 20 tokens represent the allocation placed on contracts.` : `About ${20 - stakedCoins} of 20 remain outside the position.`}</span>
        </output>
        <div className={styles.wealthSeal}>
          <i aria-hidden="true">⌾</i><span><small>Terminal wealth floor</small><br />Worst outcome for one starting dollar</span>
          <strong className="num">{worstWeight == null ? "—" : decimalLabel(kelly.worst_case_wealth, 4)}</strong>
        </div>
      </div>
      <section className={styles.capitalStress} aria-label="Kelly deployment stress simulator">
        <div className={styles.stressControl}>
          <span><small>Deployment stress</small><strong>Scale the returned plan</strong></span>
          <label><span>Fraction of solver allocation</span><input type="range" min={0} max={150} step={5} value={deployment}
            onChange={(event) => setDeployment(Number(event.target.value))} /></label>
          <output className="num">{deployment}%</output>
        </div>
        <div className={styles.stressBars}>
          {[
            { label: "Capital at risk", value: simulatedStake, note: fmt(simulatedStake, 4) },
            { label: "Residual cash", value: simulatedCash, note: fmt(simulatedCash, 4) },
            { label: "Projected wealth floor", value: simulatedFloor, note: fmt(simulatedFloor, 4) },
          ].map((item) => (
            <div key={item.label} style={{ "--stake-width": `${Math.max(0, Math.min(1, item.value === null ? 0 : item.value)) * 100}%` } as StressStyle}>
              <span><strong>{item.label}</strong><b className="num">{item.note}</b></span><i><b /></i>
            </div>
          ))}
        </div>
        <p><strong>Sensitivity replay, not a solver rerun.</strong> Above 100% exposes leverage; the returned solver allocation remains the 100% point.</p>
      </section>
      <p className="coh-figure__reading">Cash is the unstaked allocation; the seal is the state the growth-optimal plan cannot fall through.</p>
    </figure>
  );
}

/** The stake ledger, over whichever slice of the family it is handed. */
export function StakeTable({ stakes, caption, hot = null, onHot }: {
  stakes: CoherenceKelly["stakes"];
  caption: string;
  /** The row the reader's hand is on, when a caller shares one. */
  hot?: number | null;
  /** Publish the row the hand moved to, or null on leaving. */
  onHot?: (index: number | null) => void;
}) {
  const [requestedRow, setRequestedRow] = useState(stakes[0]?.ticker ?? null);
  const focusKey = requestedRow != null && stakes.some((stake) => stake.ticker === requestedRow)
    ? requestedRow
    : stakes[0]?.ticker ?? null;
  const moveRowFocus = (event: KeyboardEvent<HTMLTableRowElement>, index: number) => {
    let next: number | null = null;
    if (event.key === "ArrowUp") next = Math.max(0, index - 1);
    if (event.key === "ArrowDown") next = Math.min(stakes.length - 1, index + 1);
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = stakes.length - 1;
    if (next == null) return;
    event.preventDefault();
    if (next === index) return;
    const nextStake = stakes[next];
    if (!nextStake) return;
    setRequestedRow(nextStake.ticker);
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLTableRowElement>("tr[data-stake-row]")[next]
      ?.focus();
  };

  return (
    <div className="table-wrap" role="region" aria-label={caption} tabIndex={0}>
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
          {stakes.map((stake, index) => (
            <tr
              key={stake.ticker}
              className={`${styles.stakeTableRow}${index === hot ? " is-hot" : ""}`}
              data-stake-row
              tabIndex={stake.ticker === focusKey ? 0 : -1}
              onPointerEnter={() => onHot?.(index)}
              onPointerLeave={() => onHot?.(null)}
              onFocus={() => { setRequestedRow(stake.ticker); onHot?.(index); }}
              onBlur={() => onHot?.(null)}
              onKeyDown={(event) => moveRowFocus(event, index)}
            >
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

/**
 * The bars, the folded table, and the one index they share.
 *
 * These are the same admitted stakes in the same order, drawn once as lengths
 * and once as figures. The link runs both ways: `StakeBars` draws through
 * `Plot`, so the mark it is showing reaches the context, and the rows publish
 * theirs on hover and on focus.
 *
 * THE TABLE IS FOLDED, and that is why this pair was left until last. A lit
 * row inside a closed `<details>` is lit behind a closed door — worth nothing
 * to the reader who never opens it, and worth having for the reader who does,
 * which is the one comparing a bar against the numbers behind it. The fold
 * stays: it is the fourth 2026-08-24 pass's decision and the summary counts
 * what is inside. What changes is that opening it now costs no bookkeeping.
 */
function AdmittedPlan({ admitted, reserveRate }: { admitted: CoherenceKelly["stakes"]; reserveRate: string | null }) {
  const { hot, setHot } = useHot();
  return (
    <>
      <StakeBars hot={hot} onHot={setHot} reserveRate={reserveRate} stakes={admitted} caption="Why each outcome cleared the cash rate" />
      {/* The bars draw the Stake column and nothing else, which is the ranking
          a reader came for. Measure, price, edge and full Kelly are how the
          ranking was arrived at — per-row detail, folded since the fourth pass
          of 2026-08-24 and counted in its own summary. */}
      <details className="disclosure">
        <summary>
          Every admitted stake with its measure, price, edge and full-Kelly fraction, {admitted.length}{" "}
          {admitted.length === 1 ? "row" : "rows"}
        </summary>
        <StakeTable
          hot={hot}
          onHot={setHot}
          stakes={admitted}
          caption="Only the outcomes the plan stakes; the ones it passed over are the All outcomes view."
        />
      </details>
    </>
  );
}

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
            The {facts.length} readings behind the two paths, and what each lets you say
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
          {decimalLabel(kelly.basket_cost, 4)} for a certain dollar, worth {decimalLabel(kelly.riskless_growth, 4)} log growth.{" "}
          <strong>The plan below is different.</strong> It weights outcomes by the measure, returns {decimalLabel(kelly.growth_rate, 4)}
          expected log growth, and can lose: one dollar falls to {decimalLabel(kelly.worst_case_wealth, 4)} in the worst outcome.
          Growth-optimal is not riskless.
        </p>
      ) : null}

      {admitted.length ? (
        /* The provider wraps a CHILD: a component cannot consume the context it
           renders, so the pair that shares the index lives one level down. */
        <HotSource>
          <AdmittedPlan admitted={admitted} reserveRate={kelly.reserve_rate} />
        </HotSource>
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
