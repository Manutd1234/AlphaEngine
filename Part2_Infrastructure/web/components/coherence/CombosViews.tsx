"use client";

/**
 * Three readings of one combos payload, and the tables under them.
 *
 * Split out of `CombosPane` on 2026-08-24 when the density pass put that file
 * over the 400-line ceiling, and split again on 2026-08-26 when the Parlays
 * redo would have put THIS file over it: `ParlaysView.tsx` holds that view,
 * the card behind each of its folds and the leg table inside the card. The seam is the one the `.seg` already draws: the
 * pane owns the read, the head, the chip row and which view is showing, and
 * everything below the switcher is here. Nothing in this file holds state or
 * fetches anything — every view is a pure function of the payload — which is
 * why moving them cost no plumbing.
 *
 * The views are NOT views of one table. Bands is where each price sits in
 * the band its legs impose; Parlays is each parlay whole, with its band figure
 * and its legs; Bounds test is what a portfolio actually proves; Notes is what
 * the read cannot say. A reader on Bands is asking "is anything odd", a reader
 * on Bounds test is asking "is anything tradable", and those are different
 * questions with different answers.
 *
 * The failure mode every view here avoids is a reader taking "inside the band"
 * for "fairly priced". They are not the same claim and the second is not
 * available: every price between the two bounds is consistent with some
 * dependence between the legs, and nothing on this exchange quotes dependence.
 * So the band width leads, the position inside the band is called a position,
 * and "mispriced" appears only where a price is outside its band and a
 * portfolio proves it.
 */

import type { CoherenceCombo } from "@/lib/coherence/types-lab";
import { priceLabel } from "@/lib/coherence/fixed-point";
import ComboBandStrips from "./ComboBandStrips";
import { DEPENDENCE_WORD, basisCaveat } from "./FrechetBand";
import { StateChip } from "./Figure";


/** Said on the card whose Πpᵢ is missing, and once under Notes. Never both. */
const NO_INDEPENDENCE =
  "a leg is unquoted on the side the parlay needs, so Πpᵢ has no value and neither do the bounds — a missing quote, not a probability of zero.";

/* `positionSentence` went with the six fold summaries it was written for
   (2026-08-25). It phrased the band position as prose — "43% of the way from
   lower bound to upper: a location, not a verdict" — six times, once per
   summary. The position is a COLUMN now, and the location-not-a-verdict
   judgement it carried is on the table's caption, said once for all six rows.
   The "outside the band is the only mispricing here" claim went with it, to
   the same caption. */

function ComboChips({ combo }: { combo: CoherenceCombo }) {
  const inside = combo.inside_band;
  return (
    <div className="coh-combo__chips">
      <StateChip mark={inside == null ? "◌" : inside ? "●" : "▲"}
                 word={inside == null ? "Unquoted, nothing to place" : inside ? "Inside the band" : "Outside the band"}
                 value={combo.price == null ? null : priceLabel(combo.price)}
                 tone={inside == null ? "muted" : inside ? "good" : "critical"} />
      <StateChip mark="◇" word="Band width" value={priceLabel(combo.band_width)} tone="muted" />
      {/* The Πpᵢ FIGURE is not a chip any more. `FrechetBand` draws it on the
          card's own axis as a hollow ring and labels it there, and the Bands
          view now draws it per row too — so the chip was a number sitting
          beside a picture of itself. What stays is the DEPENDENCE word, which
          is a judgement about the legs that no position on an axis can carry,
          and the absence case, which is a fact about the quotes. */}
      {combo.independence == null ? (
        <StateChip mark="◌" word="No independence figure" tone="muted" />
      ) : (
        <StateChip mark="◇" word={DEPENDENCE_WORD[combo.dependence] ?? combo.dependence} tone="muted" />
      )}
    </div>
  );
}

export function BandsView({ combos }: { combos: CoherenceCombo[] }) {
  return (
    <section className="coh-combos__rows">
      <ComboBandStrips combos={combos} />
      {combos.map((combo) => (
        <div className="coh-combo__row" key={combo.ticker}>
          <h5 className="coh-combo__title">{combo.ticker}</h5>
          <ComboChips combo={combo} />
        </div>
      ))}
    </section>
  );
}

export function caveatCount(combos: CoherenceCombo[]): number {
  const bases = new Set(combos.map((combo) => combo.price_basis)).size;
  return bases + (combos.some((combo) => combo.independence == null) ? 1 : 0);
}

export function NotesView({ combos }: { combos: CoherenceCombo[] }) {
  // One caveat per basis actually present in the read, not one per card: on a
  // normal read every parlay is quoted on the ask and this is a single line.
  const bases = [...new Set(combos.map((combo) => combo.price_basis))];
  const unquoted = combos.filter((combo) => combo.independence == null).length;
  return (
    <section className="coh-combos__rows">
      {bases.map((basis) => <p className="coh-combo__caveat" key={basis}>{basisCaveat(basis)}</p>)}
      {unquoted ? (
        <p className="coh-combo__caveat">{`${unquoted} parlays: ${NO_INDEPENDENCE}`}</p>
      ) : null}
    </section>
  );
}


/**
 * What the gateway said while reading, folded — and NOT inside another fold.
 *
 * This used to render inside `NotesView`, which the pane wraps in a
 * `<details>` of its own, so a reader had to open two things to reach one list.
 * Nothing in the coherence suite forbade it: the nesting crossed a component
 * boundary, so no single file contained a `<details>` inside a `<details>` and
 * no source read could see it.
 */
export function GatewayNotes({ notes }: { notes: string[] }) {
  if (!notes.length) return null;
  return (
    <details className="disclosure">
      <summary>{`What the gateway noted about this read, ${notes.length} ${notes.length === 1 ? "note" : "notes"}`}</summary>
      <ul className="coh-notes">
        {notes.map((note, index) => (
          <li key={`${index}-${note}`}>{note}</li>
        ))}
      </ul>
    </details>
  );
}
