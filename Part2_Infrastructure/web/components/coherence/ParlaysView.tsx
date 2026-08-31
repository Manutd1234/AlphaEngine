"use client";

/**
 * The Parlays view: one row per parlay, named, with everything a cell cannot
 * hold behind its own fold.
 *
 * Split out of `CombosViews.tsx` on 2026-08-26 with the redo Ian asked for —
 * "redo the Parlays subtab... redo the entire thing" — which would have put
 * that file over the 400-line ceiling. The seam is the view: `BandsView` and
 * `NotesView` are readings of the same payload and stay there; everything
 * under the Parlays, Inputs and Legs switcher destinations, including the card
 * behind each fold and the leg table inside the card, is here.
 *
 * THE NAME LEADS. `combo.label` carries the venue's own words and this view
 * rendered it in exactly one place — a paragraph inside a closed fold — while
 * the table, both strips and every summary printed `KXMVE-26AUG25-LIV-9C1`.
 * `parlayName` is the one spelling of a parlay's name now, and the ticker
 * keeps its place beside it as the identifier it is, set in mono so the two
 * cannot be confused.
 */

import { Button } from "@/components/ui/button";
import type { CoherenceCombo } from "@/lib/coherence/types-lab";
import { priceLabel } from "@/lib/coherence/fixed-point";
import { parlayName } from "@/lib/coherence/parlay-name";
import { StateChip } from "./Figure";
import ParlayLegs, { ParlayLegInputs } from "./ParlayLegs";
import { ParlaySimulator } from "./ParlaySimulator";
import tableStyles from "./CombosTables.module.css";

interface ParlayViewProps {
  combos: CoherenceCombo[];
  selectedTicker: string | null;
  onSelectTicker: (ticker: string | null) => void;
}

function LegTable({ combo }: { combo: CoherenceCombo }) {
  const unpriced = combo.legs.filter((leg) => leg.probability == null).length;
  // NOT A FOLD ANY MORE, and the reason is that it had become the inner half of
  // a nested one: this table lived in a `<details>` inside the view's own
  // `<details>`, and self-opened when a leg was unpriced — a visibly open
  // drawer inside a closed one. The parlay's own fold is now the only fold, so
  // opening a parlay shows its legs, which is what "explain the dataset used
  // for each one" asks for. The count the summary carried moves to the
  // caption, where it sits beside what the columns mean.
  return (
    <section className="coh-combo__legs">
      <div className="table-wrap">
        <div
          className={tableStyles.scrollport}
          role="region"
          aria-label={`Parlay legs for ${parlayName(combo)}`}
          tabIndex={0}
        >
        <table className="coh-table">
          <caption className="coh-table__caption">
            {`${combo.legs.length} required sides. Mids set the bounds; opposite cost prices the cover.`}
          </caption>
          <thead>
            <tr>
              <th scope="col">Leg</th>
              <th scope="col">Must land</th>
              <th scope="col" className="num">Implied p</th>
              <th scope="col" className="num">Buy cost</th>
              <th scope="col" className="num">Opposite cost</th>
            </tr>
          </thead>
          <tbody>
            {combo.legs.map((leg, index) => (
              <tr key={`${leg.ticker}-${leg.side}-${index}`}>
                <th scope="row">{leg.ticker}</th>
                <td>
                  <span className="coh-combo__side">{leg.side}</span>
                </td>
                <td className="num">{priceLabel(leg.probability)}</td>
                <td className="num">{priceLabel(leg.buy_cost)}</td>
                <td className="num">{priceLabel(leg.opposite_cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
      {unpriced ? (
        <p className="coh-combo__note">
          {`${unpriced} legs show a dash for implied p — an unquoted side, not a zero probability.`}
        </p>
      ) : null}
    </section>
  );
}

/**
 * What a row of the table cannot hold: the band drawn, and the legs priced.
 *
 * TRIMMED WHEN THE VIEW BECAME A TABLE (2026-08-25, "reformat parlays as a
 * table with proper headings, rows and columns"). It carried a title, a meta
 * line, the legend, a chip row, the band figure, a position sentence and the
 * leg table — and five of those seven are now COLUMNS, read down rather than
 * hunted for across six cards. What is left is the two things a cell cannot
 * be: a drawing, and a table of its own.
 *
 * What is left is the two things a cell cannot be: a drawing, and a table of
 * its own.
 */
function ComboCard({ combo }: { combo: CoherenceCombo }) {
  return (
    <article className="coh-combo">
      {/* NO LEGEND LINE since 2026-08-26. It existed because the ticker above
          it was an identifier and not a sentence, so the venue's own words had
          to be printed somewhere — and this fold was the only place they were.
          The name leads the row header and this card's own summary now, so the
          line would be the third printing of one string. */}
      {/* WHERE THIS PARLAY COMES FROM, and it went missing when the cards
          became a table. `collection_ticker` is the R-collection the shard
          lists it under — literally the dataset this row is drawn from — and
          `scope` says whether its legs cross shards, which is what decides
          whether the bound below is executable at all. Between the rewrite and
          now, neither field was rendered anywhere on the desk. */}
      <div className="coh-status__chips">
        <StateChip mark="◇" word="Listed in" value={combo.collection_ticker || "no collection"} tone="muted" />
        <StateChip mark="→" word={combo.scope} tone={combo.scope === "cross-shard" ? "warn" : "muted"} />
      </div>
      <ParlaySimulator combo={combo} mode="legs" />
      <LegTable combo={combo} />
      {/* The gateway's own account of how this parlay's band was built. It has
          been on the wire since the route was written and drawn nowhere. */}
      {combo.detail ? (
        <details className="disclosure">
          <summary>Gateway construction note, 1 detail</summary>
          <p className="coh-combo__note">{combo.detail}</p>
        </details>
      ) : null}
    </article>
  );
}

/**
 * Where each parlay's price sits, as a mark. The key is on the table's caption.
 *
 * A MARK AND NOT A "READING" COLUMN, which is the distinction `copy-audit`
 * draws and the one the Scorecard's band table lost a column to: a cell reading
 * "inside the band" beside a cell reading "43%" is the sign of its neighbour
 * written out eleven times. The mark rides on the row's own header instead, so
 * the columns are measurements and nothing else, and the caption says what the
 * three marks mean — once, for all six rows.
 */
function positionMark(combo: CoherenceCombo): string {
  if (combo.inside_band == null) return "◌";
  return combo.inside_band ? "●" : "▲";
}

function pickerDescription(combo: CoherenceCombo): string {
  return `Inspect ${parlayName(combo)}, ${combo.ticker}`;
}

function ParlayPicker({ combos, selected, onSelectTicker }: {
  combos: CoherenceCombo[];
  selected: CoherenceCombo;
  onSelectTicker: (ticker: string | null) => void;
}) {
  return (
    <nav className="coh-parlay-picker" aria-label="Choose a parlay">
      {combos.map((combo) => (
        <Button
          key={combo.ticker}
          type="button"
          variant={selected.ticker === combo.ticker ? "secondary" : "outline"}
          size="sm"
          title={pickerDescription(combo)}
          aria-label={pickerDescription(combo)}
          aria-pressed={selected.ticker === combo.ticker}
          onClick={() => onSelectTicker(combo.ticker)}
        >
          <span className="coh-parlay-picker__mark" aria-hidden="true">{positionMark(combo)}</span>
          <span className="coh-parlay-picker__label">{parlayName(combo)}</span>
        </Button>
      ))}
    </nav>
  );
}

export function ParlaysView({ combos, selectedTicker, onSelectTicker }: ParlayViewProps) {
  const selected = combos.find((combo) => combo.ticker === selectedTicker) ?? combos[0] ?? null;

  if (!selected) return null;

  return (
    <section className="coh-combos__rows">
      <ParlaySimulator combo={selected} mode="quote" />
      <ParlayPicker combos={combos} selected={selected} onSelectTicker={onSelectTicker} />
    </section>
  );
}

/** Required-side inputs get a full-width figure and exact table of their own. */
export function ParlayInputsView({ combos, selectedTicker, onSelectTicker }: ParlayViewProps) {
  const selected = combos.find((combo) => combo.ticker === selectedTicker) ?? combos[0] ?? null;

  return (
    <section className="coh-combos__rows">
      <ParlayLegs
        combos={combos}
        selectedTicker={selected?.ticker ?? null}
      />
      {selected ? <ParlayPicker combos={combos} selected={selected} onSelectTicker={onSelectTicker} /> : null}
      <ParlayLegInputs combos={combos} selectedTicker={selected?.ticker ?? null} />
    </section>
  );
}

/** One selected parlay at a time: the long leg audit now has its own view. */
export function ParlayDetailsView({ combos, selectedTicker, onSelectTicker }: ParlayViewProps) {
  const selected = combos.find((combo) => combo.ticker === selectedTicker) ?? combos[0] ?? null;

  if (!selected) return null;

  return (
    <section className="coh-combos__rows">
      <ParlayPicker combos={combos} selected={selected} onSelectTicker={onSelectTicker} />
      <header className="coh-parlay-detail__head">
        <div>
          <span className="coh-kicker">Selected parlay</span>
          <h3>{parlayName(selected)}</h3>
        </div>
        <code className="coh-combo__ticker">{selected.ticker}</code>
      </header>
      <ComboCard combo={selected} />
    </section>
  );
}
