"use client";

/**
 * The distribution a family's prices imply, as the exchange quotes it.
 *
 * The survival function the strikes sample, the mass differencing leaves
 * between two strikes, and the moments of that mass. This reads and decides
 * nothing: what follows from the measure is the stake view's question.
 *
 * FOUR VIEWS of one payload, chosen by the
 * `view` prop `SurfacePane`'s switcher drives. They rendered as one stack —
 * two figures and a seven-row table — which is a column a reader scrolls, not
 * a view that fits a screen.
 *
 * THE PROVENANCE CHIPS LEFT ON THE FIFTH PASS and are not deleted: engine,
 * strikes probed, priced-from basis and the negative-bin count are the section
 * head's KPI row now, drawn by `SurfacePane` above the switcher. They rode the
 * Survival view alone to save height, which meant a reader who pressed Mass or
 * Moments lost the four numbers that say what they are looking at — the exact
 * thing the reader complained about when he called the section broken. A
 * 140px auto-fit `<dl>` costs less height than four chips and answers on all
 * four views. The mass chart still marks its own negative bins.
 *
 * The decimal helper and the fact table are exported from here because this is
 * the first of the views to need them and the others read them from here —
 * one spelling of "truncate, never round" for the whole section.
 *
 * THE MOMENTS TABLE IS FOUR ROWS SINCE THE FOURTH PASS of 2026-08-24, not
 * seven. Rows five to seven — the total and the two tails — are exactly what
 * the mass reservoir prints along its own foot, so on one screen they were the same
 * three numbers twice. They are folded rather than deleted: each carries a
 * sentence the drawing has no room for.
 */

import type { CoherenceSurface } from "@/lib/coherence/types-lab";
import MomentsShape from "./MomentsShape";
import PmfChart from "../PmfChart";
import SurvivalChart from "../SurvivalChart";
import { decimalLabel } from "@/lib/coherence/decimals";
import { MassReservoir } from "./LatticeInstruments";

export interface Fact {
  label: string;
  value: string;
  says: string;
}

export function FactTable({ caption, facts }: { caption: string; facts: Fact[] }) {
  return (
    <div className="table-wrap" role="region" aria-label={caption} tabIndex={0}>
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
export function row(label: string, value: string, says: string): Fact {
  return { label, value, says };
}

/**
 * `absent` is two words on purpose. It used to carry the sentence that now sits
 * under the table, which rendered it in up to six of these seven cells AND
 * again in the note — the same explanation seven times on one screen.
 */
const ABSENT = "Not computed.";

function moments(surface: CoherenceSurface): Fact[] {
  return [
    row("Mean", decimalLabel(surface.mean, 4),
      surface.mean ? "The centre of the mass between the outermost quoted strikes." : ABSENT),
    row("Standard deviation", decimalLabel(surface.standard_deviation, 4),
      surface.standard_deviation ? "The spread of that interior mass, in the strikes' own units." : ABSENT),
    row("Skewness", decimalLabel(surface.skewness, 4),
      surface.skewness ? "Positive means the interior mass leans to the low strikes with a long tail up." : ABSENT),
    row("Excess kurtosis", decimalLabel(surface.excess_kurtosis, 4),
      surface.excess_kurtosis ? "Above zero means more mass in the shoulders than a normal of the same width." : ABSENT),
  ];
}

/**
 * The three readings the mass reservoir draws, split off the moments table on the
 * fourth pass of 2026-08-24.
 *
 * They were rows five to seven of one seven-row table, and the figure directly
 * above prints all three with the same labels along its own foot — the same
 * numbers twice on one screen, which is the duplication this pass was asked to
 * remove. Deleting them was the wrong half of the fix: each carries a sentence
 * the drawing has no room for (what a total over telescoping differences does
 * and does not confirm, and why a tail is outside every moment above). So they
 * are folded, not dropped.
 */
function massReadings(surface: CoherenceSurface): Fact[] {
  return [
    row("Total quoted mass", decimalLabel(surface.total_mass, 4),
      "What every bin sums to. On a ladder the differences telescope, so this confirms the arithmetic, never the prices."),
    row("Low tail", decimalLabel(surface.tail_mass_low, 4),
      surface.tail_mass_low
        ? "Mass below the lowest quoted strike, where the exchange quotes no width; excluded from the moments above."
        : ABSENT),
    row("High tail", decimalLabel(surface.tail_mass_high, 4),
      surface.tail_mass_high ? "Mass above the highest quoted strike, excluded from the moments for the same reason." : ABSENT),
  ];
}

/** The four views this component draws; "family" is `FamilyView`'s. */
export type DistributionViewName = "survival" | "mass" | "moments" | "support";

export default function DistributionView({ surface, view }: { surface: CoherenceSurface; view: DistributionViewName }) {
  if (view === "mass") {
    return <PmfChart key={surface.event_ticker} surface={surface} />;
  }
  if (view === "moments") {
    return (
      <>
        {/* THE SHAPE FIRST, since 2026-08-25 and "add more diagrams and
            summarise the words". Every one of the four moments is a statement
            about a shape, and the shape is in the payload — so it is drawn, with
            each moment marked on it as the thing it says. The table that used to
            open this view spent its third column telling a reader what its
            second column meant, which is a glossary rather than a reading. */}
        <MomentsShape
          key={`shape:${surface.event_ticker}`}
          surface={surface}
          meanLabel={decimalLabel(surface.mean, 4)}
          sdLabel={decimalLabel(surface.standard_deviation, 4)}
        />
        {/* The numbers and their definitions both fold. The figure above states
            all four in words a reader does not have to be taught; what the table
            alone carries is the exact value and the term it belongs to, which is
            what a reader opens a fold for. */}
        <details className="disclosure">
          <summary>The four moments as figures, and what each term means</summary>
          <FactTable caption="The moments of the implied distribution" facts={moments(surface)} />
          <p className="coh-surface__moments-note">
            <span aria-hidden="true">◌</span> Every moment above is {surface.moments_note}. &ldquo;Not
            computed.&rdquo; means the mass leaves it undefined — missing, never zero.
          </p>
        </details>
      </>
    );
  }
  if (view === "support") {
    return (
      <>
        <MassReservoir key={`support:${surface.event_ticker}`} surface={surface} />
        <details className="disclosure">
          <summary>The three support readings, and what each excludes</summary>
          <FactTable
            caption="The tails sit outside the bounded moments; the total is what every bin sums to."
            facts={massReadings(surface)}
          />
        </details>
      </>
    );
  }
  // No heading and no chip row: this is one view of the `lattice` section, its
  // own `<h4>` restated both the section head and the switcher button that
  // selected it, and the four provenance chips are the section's KPI row now —
  // where all four views can see them.
  return <SurvivalChart key={surface.event_ticker} surface={surface} />;
}
