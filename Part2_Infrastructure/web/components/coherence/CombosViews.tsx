"use client";

/**
 * The shared range overview and caveats for one combos payload.
 *
 * Split out of `CombosPane` on 2026-08-24 when the density pass put that file
 * over the 400-line ceiling, and split again on 2026-08-26 when the Parlays
 * redo would have put THIS file over it: `ParlaysView.tsx` holds that view,
 * the card behind each of its folds and the leg table inside the card. The seam is the one the `.seg` already draws: the
 * pane owns the read, the head, the chip row and which view is showing, and
 * everything below the switcher is here. The Bands view holds only the ticker
 * being inspected so its overview and exact range stay on one parlay;
 * nothing here fetches or derives a second payload.
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

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import type { CoherenceCombo } from "@/lib/coherence/types-lab";
import ComboBandStrips from "./ComboBandStrips";
import { basisCaveat } from "./FrechetBand";
import FrechetInstrument from "./FrechetInstrument";
/** Said on the card whose Πpᵢ is missing, and once under Notes. Never both. */
const NO_INDEPENDENCE =
  "a leg is unquoted on the side the parlay needs, so Πpᵢ has no value and neither do the bounds — a missing quote, not a probability of zero.";

/* The overview carries all loaded ranges; the exact marker instrument stays
   available for the selected row without repeating a six-row table. */

export function BandsView({ combos, selectedTicker, onSelectTicker }: {
  combos: CoherenceCombo[];
  selectedTicker: string | null;
  onSelectTicker: (ticker: string | null) => void;
}) {
  const [instrumentOpen, setInstrumentOpen] = useState(false);
  const instrumentId = useId();
  const selected = combos.find((combo) => combo.ticker === selectedTicker) ?? combos[0] ?? null;

  return (
    <section className="coh-combos__rows">
      <ComboBandStrips
        combos={combos}
        selectedTicker={selectedTicker}
        onSelectTicker={onSelectTicker}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-expanded={instrumentOpen}
        aria-controls={instrumentId}
        onClick={() => setInstrumentOpen((open) => !open)}
      >
        {instrumentOpen ? "Hide selected range" : "Inspect selected range"}
      </Button>
      {instrumentOpen ? (
        <div id={instrumentId}>
          <FrechetInstrument combo={selected} />
        </div>
      ) : null}
    </section>
  );
}

export function caveatCount(combos: CoherenceCombo[], notes: string[] = []): number {
  const bases = new Set(combos.map((combo) => combo.price_basis)).size;
  return bases + (combos.some((combo) => combo.independence == null) ? 1 : 0) + notes.length;
}

export function NotesView({ combos, notes = [] }: { combos: CoherenceCombo[]; notes?: string[] }) {
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
      {notes.length ? (
        <ul className="coh-notes">
          {notes.map((note, index) => <li key={`${index}-${note}`}>{note}</li>)}
        </ul>
      ) : null}
    </section>
  );
}
