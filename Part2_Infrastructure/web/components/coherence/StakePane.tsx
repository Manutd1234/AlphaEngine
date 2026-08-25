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
 * FOUR VIEWS, and All outcomes is the fourth because it belongs to the BET. It
 * renders the solver's own ranking — every outcome, admitted or passed over —
 * over the `/stake` payload. Left on the distribution section it would have kept
 * a second read there and would have died on every strike ladder with no
 * explanation of its own, because `FamilyView` never reaches the branch that
 * explains a declined solve.
 *
 * THE KPI ROW IS THE PLAN'S OWN SIX NUMBERS, so a reader who lands on Capital
 * is told no less than one who lands on Plan. A reading the solve did not
 * return is left OFF the row and named in one footnote — missing, never zero,
 * and named once rather than six dashes each carrying the same sentence.
 *
 * THAT RULE IS `KpiRow`'S NOW, and this section is where it was written. It was
 * implemented here by hand — split the readings on the dash `decimalLabel`
 * returns, draw the ones that survived, name the rest in one sentence — and
 * seven other sections did not have it. Generalising it changed nothing on
 * this section and gave it to all eight; what this file keeps is the shape of
 * the argument in its header, because the next author to meet a null here will
 * meet it in a component with no reason attached.
 *
 * THE ROW SITS UNDER THE CONTROL ROW rather than above it, which is the one
 * thing the frame moved. It read "above the switcher" here and below it on
 * Lattice and Fees, and a reader moving between three sections that answer the
 * same question about the same family met the numbers in two different places.
 *
 * "Growth-optimal is not riskless" is NOT in the lede. It is where `StakeView`'s
 * warning ends, beside the two numbers that make it true; here it would be the
 * slogan twice and the evidence once.
 */

import { useState } from "react";

import type { CoherenceEventView, CoherenceUniverse } from "@/lib/coherence/types";
import type { CoherenceKelly } from "@/lib/coherence/types-lab";
import { stakeRoute, universeRoute } from "@/lib/coherence/routes";
import FamilyPicker from "./FamilyPicker";
import type { Reading } from "./KpiRow";
import LiveTape from "./LiveTape";
import { toUnit } from "./FrechetBand";
import { useLiveSeries } from "@/lib/coherence/use-live-series";
import PaneHead, { PaneHeadEmpty } from "./PaneHead";
import SectionFrame from "./SectionFrame";
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
  // "All outcomes" and not "Whole family" since 2026-08-25: the family PICKER
  // now sits beside this switcher carrying the word "Family", and two adjacent
  // controls spending one noun on two different things is a collision a reader
  // resolves by clicking. It is also two characters shorter than the segment
  // could hold, so the label stopped wrapping to a second line and the row
  // stopped being taller than the three sections next to it. The id stays
  // `family` — it is the view's name in code, not on screen.
  ["family", "All outcomes"],
];

const HEAD = {
  kicker: "Stake",
  title: "What log-optimal growth would put on this family",
  id: "markets-stake-heading",
  lede: "Given the measure a family's prices imply, this is the share of a bankroll each outcome earns and what is left in cash.",
} as const;

/**
 * The six readings the section answers in, before any drawing.
 *
 * `decimalLabel` returns a dash for a value the solve did not carry, and that
 * dash is mapped to `null` here rather than printed: `KpiRow` leaves a null off
 * the tiles and names it once underneath, which is the rule this section wrote
 * and eight now share. Printing six dashes with six copies of the same reason
 * is the shape it replaced — and `MassSplitBar` uses the same one for an
 * uncomputed tail.
 */
function readings(kelly: CoherenceKelly): Reading[] {
  const admitted = kelly.stakes.filter((stake) => stake.admitted).length;
  const figure = (raw: string | null | undefined) => {
    const cut = decimalLabel(raw, 4);
    return cut === "—" ? null : cut;
  };
  return [
    { label: "Admitted stakes", value: `${admitted} of ${kelly.stakes.length}` },
    { label: "Staked", value: figure(kelly.staked_fraction) },
    { label: "Cash", value: figure(kelly.cash_fraction) },
    { label: "Growth rate", value: figure(kelly.growth_rate) },
    { label: "Worst case, one dollar becomes", value: figure(kelly.worst_case_wealth) },
    { label: "Basket cost", value: figure(kelly.basket_cost) },
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

  const kelly = stake.data;

  /* The growth rate over time, keyed by family. Zero is the reference and it is
     the whole reading: a log-optimal plan whose growth rate is zero is the
     solver saying "stake nothing", which is what it says on the market's own
     mids — so a series that lifts off the line is the moment the quotes stopped
     being a fair game, and that moment is invisible in any one poll.

     ABOVE THE EARLY RETURN, WHICH IS NOT A STYLE CHOICE. It sat below the
     `!target` branch when it was written, so on a COLD load — no family yet,
     then a family — React ran a render with one fewer hook than the next and
     tore the whole dashboard down with error #310. It never showed in the first
     browser check because the universe read was already warm, so `target` was
     truthy on the first render and the branch never fired. A hook after a
     conditional return is a crash waiting for a slow read. */
  const growthTape = useLiveSeries(
    `stake:${target}:growth`,
    stake.updatedAt,
    kelly && kelly.engine !== "unavailable" ? toUnit(kelly.growth_rate) : null,
  );

  if (!target) {
    return (
      <SectionFrame
        className="coh-kelly"
        aria-labelledby="markets-stake-heading"
        head={
          <PaneHeadEmpty head={head} mark={universe.error ? "✕" : "◌"}>
            {universe.error
              ? `No family could be read: ${universe.error}. Universe reads the same list and says what the exchange answered.`
              : "Reading the watched families…"}
          </PaneHeadEmpty>
        }
      />
    );
  }

  // The row is drawn only for a solve that RETURNED one. A declined solve has
  // no plan to answer in, and six withheld labels over `StakeDeclined` would
  // read as a plan the solver nearly made.
  const kpis = kelly && kelly.engine !== "unavailable" ? readings(kelly) : undefined;

  return (
    <SectionFrame
      className="coh-kelly"
      aria-labelledby="markets-stake-heading"
      head={<PaneHead {...head} />}
      views={STAKE_VIEWS}
      view={view}
      onView={setView}
      viewsLabel="Stake view"
      subject={!eventTicker && events.length > 1 ? (
        /* `FamilyPicker`'s listbox and not a row of pills: four tickers as
           pills was a second row at any ordinary width, and a second row is
           the defect this section was split out of the lattice to remove. */
        <FamilyPicker
          options={events.map((event) => ({ ticker: event.event_ticker, shard: event.exchange_index }))}
          selected={target}
          onSelect={setPicked}
          label="Choose a family"
        />
      ) : null}
      kpis={kpis}
      kpiSource="this solve"
    >
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
          {view === "family" ? <FamilyView kelly={kelly} /> : <StakeView kelly={kelly} view={view} />}

          <LiveTape
            points={growthTape}
            caption="What log-optimal growth has been worth, poll by poll"
            ariaLabel="The plan's growth rate over the polls seen since this tab opened"
            reference={{ value: 0, label: "stake nothing" }}
            reading="On the market's own mids the solver returns zero; a reading off that line is the moment these quotes stopped being a fair game."
          />

          <p className="coh-kelly__note">
            A reading of prices and not a forecast: fed the market&rsquo;s own mids, the solver returns
            &ldquo;stake nothing&rdquo;, and nothing on this section places an order.
          </p>
          <TruncationNote />
        </>
      )}
    </SectionFrame>
  );
}
