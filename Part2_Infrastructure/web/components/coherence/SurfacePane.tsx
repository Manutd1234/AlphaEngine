"use client";

/**
 * The distribution a family's prices imply, and what it would be right to bet.
 *
 * Two questions, one screen, deliberately. A ladder or a bucket family is a
 * probability distribution with prices on it: the first half draws it as the
 * exchange quotes it — the survival function it samples, and the mass
 * differencing leaves between strikes. The second half asks what follows:
 * given that measure and those prices, how much of a bankroll does
 * log-optimal growth put on each outcome?
 *
 * The trap this pane exists to avoid is the one `kelly.py` spends a paragraph
 * on. Where a family costs less than the dollar it is certain to pay, a
 * riskless profit exists — and Kelly does NOT take it. Kelly stakes the
 * measure, a different portfolio: it grows faster and it can lose. So both
 * numbers appear together, in words, whenever the arbitrage is there;
 * "growth-optimal" read as "riskless" is the expensive misreading.
 *
 * Nothing here sends an order. It reads two gateway endpoints and draws them.
 */

import { useState } from "react";

import { priceLabel } from "@/lib/coherence/fixed-point";
import type { CoherenceEventView, CoherenceUniverse } from "@/lib/coherence/types";
import type { CoherenceKelly, CoherenceSurface } from "@/lib/coherence/types-lab";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import Figure, { FigureEmpty, Plot, StateChip } from "./Figure";
import PmfChart from "./PmfChart";
import SurvivalChart from "./SurvivalChart";

const BAR_HEIGHT = 76;

/**
 * A wire decimal for display, truncated and never rounded.
 *
 * A standard deviation arrives as `1.599804675577615631316479364` — 27 places
 * that `toCenticents` refuses outright, being finer than a centicent. Cutting
 * the string is exact where rounding a float is not, and the ellipsis says a
 * digit was cut rather than pretending the value ended there.
 */
function decimalLabel(raw: string | null | undefined, places = 4): string {
  if (raw == null) return "—";
  const text = raw.trim();
  if (!/^-?\d*(?:\.\d*)?$/.test(text) || text === "" || text === "-") return "—";
  const [whole, fraction = ""] = text.split(".");
  const head = whole === "" || whole === "-" ? `${whole}0` : whole;
  if (!fraction) return head;
  const kept = fraction.slice(0, places);
  const cut = /[1-9]/.test(fraction.slice(places));
  return `${head}.${kept}${cut ? "…" : ""}`;
}

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

interface Fact {
  label: string;
  value: string;
  says: string;
}

function FactTable({ caption, facts }: { caption: string; facts: Fact[] }) {
  return (
    <div className="table-wrap">
      <table className="coh-table">
        <caption className="coh-table__caption">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Reading</th>
            <th scope="col" className="num">Value</th>
            <th scope="col">What it says</th>
          </tr>
        </thead>
        <tbody>
          {facts.map((fact) => (
            <tr key={fact.label}>
              <th scope="row">{fact.label}</th>
              <td className="num">{fact.value}</td>
              <td>{fact.says}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One row of a fact table: the reading, the figure, what it lets you say. */
function row(label: string, value: string, says: string): Fact {
  return { label, value, says };
}

function moments(surface: CoherenceSurface): Fact[] {
  const absent = "Not computed. The note under this table says which mass the moments are taken over, and so why this one is missing.";
  return [
    row("Mean", decimalLabel(surface.mean, 4),
      surface.mean ? "The centre of the mass sitting between the outermost quoted strikes." : absent),
    row("Standard deviation", decimalLabel(surface.standard_deviation, 4),
      surface.standard_deviation ? "The spread of that same interior mass, in the units the strikes are quoted in." : absent),
    row("Skewness", decimalLabel(surface.skewness, 4),
      surface.skewness ? "Positive means the interior mass leans to the low strikes with a long tail up." : absent),
    row("Excess kurtosis", decimalLabel(surface.excess_kurtosis, 4),
      surface.excess_kurtosis ? "Above zero means more mass in the shoulders than a normal of the same width." : absent),
    row("Total quoted mass", decimalLabel(surface.total_mass, 4),
      "What every bin sums to. On a ladder the differences telescope, so this confirms the arithmetic, never the prices."),
    row("Low tail", decimalLabel(surface.tail_mass_low, 4),
      surface.tail_mass_low
        ? "Mass below the lowest quoted strike. The exchange quotes no width down there, so it is excluded from the moments above."
        : absent),
    row("High tail", decimalLabel(surface.tail_mass_high, 4),
      surface.tail_mass_high ? "Mass above the highest quoted strike, excluded from the moments for the same reason." : absent),
  ];
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

function StakeTable({ stakes, caption }: { stakes: CoherenceKelly["stakes"]; caption: string }) {
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
      ? "The certain alternative, in the same log units. It is NOT what the plan above earns: buying equal numbers of every outcome pays a flat dollar whatever happens, and this plan does not do that."
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

function KellyBlock({ kelly, surface }: { kelly: CoherenceKelly; surface: CoherenceSurface }) {
  if (kelly.engine === "unavailable") {
    return (
      <div className="coh-kelly">
        <p className="console-empty">
          <span aria-hidden="true">◌</span> No stake was sized: {kelly.detail}
        </p>
        {surface.engine === "ladder" ? (
          <p className="coh-kelly__note">
            That refusal is correct here rather than a gap. This family is a strike ladder, and a ladder&rsquo;s markets
            each pay in several of the bins drawn above: a threshold wins in every state the threshold above it wins in,
            and more. The exclusive-family solver states one market per state, so it declines this family by name rather
            than approximating one it cannot express.
          </p>
        ) : null}
      </div>
    );
  }

  const admitted = kelly.stakes.filter((stake) => stake.admitted);
  return (
    <div className="coh-kelly">
      <div className="coh-status__chips">
        <StateChip mark="◇" word="Log-optimal over one family" value={`${admitted.length}/${kelly.stakes.length} admitted`} tone="muted" />
        <StateChip mark="→" word="Shrinkage" value={decimalLabel(kelly.shrinkage, 4)} tone="muted" />
        {kelly.arbitrage_available ? (
          <StateChip mark="▲" word="Riskless profit exists, and this is not it" tone="critical" />
        ) : (
          <StateChip mark="●" word="No riskless profit in these prices" tone="good" />
        )}
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

      <details className="coh-lesson__mechanics">
        <summary>Every outcome considered, admitted or passed over, with its edge and full-Kelly fraction</summary>
        <StakeTable stakes={kelly.stakes} caption="The whole family, in the order the solver ranked it by measure over price" />
        <p className="coh-kelly__note">{kelly.detail}</p>
      </details>
    </div>
  );
}

export default function SurfacePane({
  active,
  eventTicker,
  events: supplied,
}: {
  active: boolean;
  /** Pins one family. Absent, the pane picks the first the universe returns. */
  eventTicker?: string;
  /** The console's own universe read, reused so this is not a third live one. */
  events?: CoherenceEventView[];
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const universe = useCoherenceRead<CoherenceUniverse>(
    "/api/gateway/coherence/universe?max_events=2",
    active && !eventTicker && !supplied?.length,
  );
  const events = supplied?.length ? supplied : (universe.data?.events ?? []);
  const target = eventTicker ?? picked ?? events[0]?.event_ticker ?? "";
  const surface = useCoherenceRead<CoherenceSurface>(
    `/api/gateway/coherence/surface?event_ticker=${encodeURIComponent(target)}`,
    active && Boolean(target),
  );
  const stake = useCoherenceRead<CoherenceKelly>(
    `/api/gateway/coherence/stake?event_ticker=${encodeURIComponent(target)}`,
    active && Boolean(target),
  );

  if (!target) {
    return (
      <p className="console-empty">
        <span aria-hidden="true">◌</span>{" "}
        {universe.error
          ? `No family could be read, so there is no distribution to draw: ${universe.error}`
          : "Reading the families this engine prices…"}
      </p>
    );
  }

  return (
    <div className="coh-surface">
      {!eventTicker && events.length > 1 ? (
        <div className="seg coh-books__picker" role="group" aria-label="Choose a family to draw">
          {events.map((event) => (
            <button key={event.event_ticker} type="button" aria-pressed={event.event_ticker === target} onClick={() => setPicked(event.event_ticker)}>
              {event.event_ticker}
            </button>
          ))}
        </div>
      ) : null}

      {surface.error && !surface.data ? (
        <p className="console-empty">
          <span aria-hidden="true">✕</span> The distribution could not be read: {surface.error}
        </p>
      ) : !surface.data ? (
        <p className="console-empty muted">Reading the distribution these prices imply…</p>
      ) : (
        <>
          <div className="coh-status__chips">
            <StateChip mark="◇" word={surface.data.engine === "ladder" ? "Strike ladder" : `${surface.data.engine} family`} value={surface.data.event_ticker} tone="muted" />
            <StateChip mark="●" word="Intervals" value={String(surface.data.bins.length)} tone="muted" />
            <StateChip mark="→" word="Strikes probed" value={String(surface.data.probes.length)} tone="muted" />
            <StateChip mark="◌" word="Priced from" value={surface.data.basis ?? "no side"} tone={surface.data.basis ? "muted" : "warn"} />
            {surface.data.negative_bins.length ? (
              <StateChip mark="▽" word="Negative mass" value={`${surface.data.negative_bins.length} interval(s)`} tone="critical" />
            ) : (
              <StateChip mark="✓" word="No negative mass" tone="good" />
            )}
          </div>

          <SurvivalChart surface={surface.data} />
          <PmfChart surface={surface.data} />

          <FactTable caption="The moments of the implied distribution, and the mass they are taken over" facts={moments(surface.data)} />
          <p className="coh-surface__moments-note">
            <span aria-hidden="true">◌</span> Every moment above is {surface.data.moments_note}. Values are shown
            truncated, never rounded: a trailing ellipsis means digits were cut, not that the number ended there.
          </p>

          {stake.error && !stake.data ? (
            <p className="console-empty">
              <span aria-hidden="true">✕</span> The stake could not be sized: {stake.error}
            </p>
          ) : !stake.data ? (
            <p className="console-empty muted">Sizing the log-optimal stake…</p>
          ) : (
            <KellyBlock kelly={stake.data} surface={surface.data} />
          )}

          <p className="coh-event__note">
            This is a reading of prices, not a forecast. The mass is what one side of each book implies if the quotes
            are taken at face value, and the plan is sized against that measure — fed the market&rsquo;s own mids it
            correctly returns &ldquo;stake nothing&rdquo;, because there is no edge in quoting a price back at itself.
            Nothing on this pane places an order, and no stake here has been traded.
          </p>
        </>
      )}
    </div>
  );
}
