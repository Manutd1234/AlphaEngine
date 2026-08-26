"use client";

/**
 * Parlays — the venue's own conjunctions, against the bounds their legs impose.
 *
 * A SECTION AGAIN, UNDER ITS PUBLISHED ID. `combos` was published on
 * `origin/main`, folded into Dutch book on 2026-08-24 on the argument that the
 * Fréchet bounds test IS a coherence test, and returns on 2026-08-25 because
 * that argument was about the SUBJECT and the cost was paid by the CONTROL: a
 * reader met three group buttons, then three view buttons, then a family picker
 * that the parlays do not even use. The subject argument still holds — same
 * failure, same verdict vocabulary — and it is what the lede says instead of
 * what the switcher used to.
 *
 * NO FAMILY PICKER HERE, and that is the structural reason this belongs beside
 * the test rather than inside it: a parlay is a listing the exchange publishes,
 * not a family this engine chooses. A picker above these rows would claim a
 * relationship that is not there — which is exactly what it did while the three
 * views sat behind a control the other two groups needed.
 *
 * The three views are one `combos` read, so pressing between them re-arms
 * nothing. `CombosPane` draws them and owns no switcher of its own; the section
 * owns the one control row, which is the rule every section on this rail keeps.
 */


import CombosPane, { type ComboView } from "./CombosPane";
import PaneHead from "./PaneHead";

const VIEWS: ReadonlyArray<[ComboView, string]> = [
  ["bands", "Bands"],
  ["parlays", "Parlays"],
  ["bounds", "Bounds"],
];

export default function CombosSection({ active, view, onView }: { active: boolean; view: ComboView; onView: (next: ComboView) => void }) {

  return (
    <section className="card console-card coh-certificate" aria-labelledby="coherence-combos-heading">
      <PaneHead
        kicker="Parlays"
        title="The bounds a parlay's own legs impose on it"
        id="coherence-combos-heading"
        note="one band per parlay, from the legs the venue lists"
        lede="Two marginals do not determine a joint — the Fréchet–Hoeffding inequalities say they bound it."
      />

      {/* The control row is pinned (`14u`), so a reader deep in the body can
          switch view without scrolling back to the head. One row per section is
          the rule this rail already kept; wrapping it is what made it pinnable. */}
      <div className="coh-bar">
        <div className="seg" role="group" aria-label="Parlay view">
          {VIEWS.map(([name, label]) => (
            <button key={name} type="button" aria-pressed={view === name} onClick={() => onView(name)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="coh-combos">
        <CombosPane active={active} view={view} />
      </div>
    </section>
  );
}
