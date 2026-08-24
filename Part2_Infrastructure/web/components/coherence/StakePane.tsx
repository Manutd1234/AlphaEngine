"use client";

/**
 * Stake — what log-optimal growth would put on one family, and what it would not.
 *
 * A SECTION AGAIN, ON THE FIFTH RESTRUCTURE OF 2026-08-24, and the history is
 * short enough to state rather than leave to a diff. `stake` was promoted out of
 * the lattice's switcher that morning because the most consequential question on
 * the engine — what should be bet — was reachable only by a control the URL does
 * not carry; it was folded back the same afternoon; and it is a rail entry again
 * now for the reason the reader gave looking at the live desk: as a view it
 * needed a SECOND `.seg` stacked under the lattice's first, so three rows of
 * controls stood over the answer. The id is the one it was published under, and
 * `RELOCATED_SECTIONS` points `#coherence/stake` here.
 *
 * ONE SECTION, ONE READ. This file reads `/stake` and nothing else; Lattice
 * reads `/surface` and nothing else. That is what removed the second control
 * row, and it is also why the declined branch can no longer ask the surface
 * payload what shape the family is — it asks the universe payload the console
 * already holds, which carries the exchange's own `mutually_exclusive` flag.
 * See `StakeDeclined`, which is where that argument lives.
 *
 * FOUR VIEWS, and Whole family is the fourth because it belongs to the BET. It
 * renders the solver's own ranking — every outcome, admitted or passed over —
 * over the `/stake` payload. Left on the distribution section it would have kept
 * a second read there and would have died on every strike ladder with no
 * explanation of its own, because `FamilyView` never reaches the branch that
 * explains a declined solve.
 *
 * THE KPI ROW IS THE PLAN'S OWN SIX NUMBERS, above the switcher, so a reader who
 * lands on Capital is told no less than one who lands on Plan. A reading the
 * solve did not return is left OFF the row and named in one footnote — missing,
 * never zero, and named once rather than six dashes each carrying the same
 * sentence.
 *
 * "Growth-optimal is not riskless" is NOT in the lede. It is where `StakeView`'s
 * warning ends, beside the two numbers that make it true; here it would be the
 * slogan twice and the evidence once.
 */

import { type ReactNode, useState } from "react";

import type { CoherenceEventView, CoherenceUniverse } from "@/lib/coherence/types";
import type { CoherenceKelly } from "@/lib/coherence/types-lab";
import { stakeRoute, universeRoute } from "@/lib/coherence/routes";
import PaneHead, { PaneHeadEmpty } from "./PaneHead";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import { decimalLabel } from "./surface/DistributionView";
import FamilyView from "./surface/FamilyView";
import StakeDeclined from "./surface/StakeDeclined";
import StakeView, { type StakeViewName } from "./surface/StakeView";
import TruncationNote from "./surface/TruncationNote";

type StakeSectionView = StakeViewName | "family";
const STAKE_VIEWS: ReadonlyArray<[StakeSectionView, string]> = [
  ["plan", "Plan"],
  ["capital", "Capital"],
  ["method", "Method"],
  ["family", "Whole family"],
];

const HEAD = {
  kicker: "Stake",
  title: "What log-optimal growth would put on this family",
  id: "markets-stake-heading",
  lede: "Given the measure a family's prices imply, this is the share of a bankroll each outcome earns and what is left in cash.",
} as const;

interface Reading {
  label: string;
  value: string;
}

/**
 * The six readings the section answers in, before any drawing.
 *
 * `decimalLabel` returns a dash for a value the solve did not carry, and the
 * caller splits on that rather than printing six dashes with six copies of the
 * same reason — the shape `MassSplitBar` already uses for an uncomputed tail.
 */
function readings(kelly: CoherenceKelly): Reading[] {
  const admitted = kelly.stakes.filter((stake) => stake.admitted).length;
  return [
    { label: "Admitted stakes", value: `${admitted} of ${kelly.stakes.length}` },
    { label: "Staked", value: decimalLabel(kelly.staked_fraction, 4) },
    { label: "Cash", value: decimalLabel(kelly.cash_fraction, 4) },
    { label: "Growth rate", value: decimalLabel(kelly.growth_rate, 4) },
    { label: "Worst case, one dollar becomes", value: decimalLabel(kelly.worst_case_wealth, 4) },
    { label: "Basket cost", value: decimalLabel(kelly.basket_cost, 4) },
  ];
}

export default function StakePane({
  active,
  eventTicker,
  events: supplied,
}: {
  active: boolean;
  /** Pins one family. Absent, the pane picks the first the universe returns. */
  eventTicker?: string;
  /** The console's own universe read, reused so this is not a second live one. */
  events?: CoherenceEventView[];
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [view, setView] = useState<StakeSectionView>("plan");
  const universe = useCoherenceRead<CoherenceUniverse>(
    universeRoute(),
    active && !eventTicker && !supplied?.length,
  );
  const events = supplied?.length ? supplied : (universe.data?.events ?? []);
  const target = eventTicker ?? picked ?? events[0]?.event_ticker ?? "";
  const stake = useCoherenceRead<CoherenceKelly>(stakeRoute(target), active && Boolean(target));

  const head = {
    ...HEAD,
    note: `${events.length} ${events.length === 1 ? "family" : "families"} to choose from`,
  };

  const framed = (body: ReactNode) => (
    <section className="card console-card coh-kelly" aria-labelledby="markets-stake-heading">
      {body}
    </section>
  );

  if (!target) {
    return framed(
      <PaneHeadEmpty head={head} mark={universe.error ? "✕" : "◌"}>
        {universe.error
          ? `No family could be read: ${universe.error}. Universe reads the same list and says what the exchange answered.`
          : "Reading the watched families…"}
      </PaneHeadEmpty>,
    );
  }

  const kelly = stake.data;
  const known = kelly ? readings(kelly).filter((reading) => reading.value !== "—") : [];
  const withheld = kelly ? readings(kelly).filter((reading) => reading.value === "—") : [];

  return framed(
    <>
      <PaneHead {...head} />

      {/* ONE control row, and the whole point of the split: the view switcher
          and the family picker share it, and nothing stacks under either.
          `.coh-status__chips` is the flex box rather than a class of its own —
          `.coh-kelly` is a grid, so two segs as its children would stack. */}
      <div className="coh-status__chips">
        <div className="seg" role="group" aria-label="Stake view">
          {STAKE_VIEWS.map(([name, label]) => (
            <button key={name} type="button" aria-pressed={view === name} onClick={() => setView(name)}>
              {label}
            </button>
          ))}
        </div>

        {!eventTicker && events.length > 1 ? (
          <div className="seg coh-books__picker" role="group" aria-label="Choose a family">
            {events.map((event) => (
              <button key={event.event_ticker} type="button" aria-pressed={event.event_ticker === target} onClick={() => setPicked(event.event_ticker)}>
                {event.event_ticker}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {stake.error && !kelly ? (
        <p className="console-empty">
          <span aria-hidden="true">✕</span> The stake could not be sized: {stake.error}. That is a gateway failure,
          not an answer about this family.
        </p>
      ) : !kelly ? (
        <p className="console-empty muted">Sizing the log-optimal stake…</p>
      ) : kelly.engine === "unavailable" ? (
        <StakeDeclined kelly={kelly} target={target} events={events} onSelect={setPicked} />
      ) : (
        <>
          <dl className="coh-status__facts">
            {known.map((reading) => (
              <div key={reading.label}>
                <dt>{reading.label}</dt>
                <dd>{reading.value}</dd>
              </div>
            ))}
          </dl>

          {withheld.length ? (
            <p className="coh-kelly__note">
              <span aria-hidden="true">◌</span> {withheld.map((reading) => reading.label.toLowerCase()).join(", ")}{" "}
              {withheld.length === 1 ? "was" : "were"} not returned by this solve, so {withheld.length === 1 ? "it is" : "they are"}{" "}
              left off the row above rather than shown as zero.
            </p>
          ) : null}

          {view === "family" ? <FamilyView kelly={kelly} /> : <StakeView kelly={kelly} view={view} />}

          <p className="coh-kelly__note">
            A reading of prices and not a forecast: fed the market&rsquo;s own mids, the solver returns
            &ldquo;stake nothing&rdquo;, and nothing on this section places an order.
          </p>
          <TruncationNote />
        </>
      )}
    </>,
  );
}
