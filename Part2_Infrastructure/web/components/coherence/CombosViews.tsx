"use client";

/**
 * The four readings of one combos payload, and the tables under them.
 *
 * Split out of `CombosPane` on 2026-08-24 when the density pass put that file
 * over the 400-line ceiling. The seam is the one the `.seg` already draws: the
 * pane owns the read, the head, the chip row and which view is showing, and
 * everything below the switcher is here. Nothing in this file holds state or
 * fetches anything — every view is a pure function of the payload — which is
 * why moving them cost no plumbing.
 *
 * The four are NOT four views of one table. Bands is where each price sits in
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
import ParlayLegs from "./ParlayLegs";
import FrechetBand, { DEPENDENCE_WORD, basisCaveat, probLabel, toUnit } from "./FrechetBand";
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

function LegTable({ combo }: { combo: CoherenceCombo }) {
  const unpriced = combo.legs.filter((leg) => leg.probability == null).length;
  // OPEN ONLY WHERE IT EXPLAINS AN ABSENCE. It used to open for any parlay of
  // six legs or fewer, which is every parlay the exchange lists — so the
  // Parlays view was six cards each carrying a five-column table nobody had
  // asked for, and the band figure of the parlay below it was two screens down.
  // A leg with no implied p is the one case where the table is the answer to a
  // question the card raises ("why has this parlay no band"), so that case
  // stays open and the rest are one click.
  return (
    <details className="coh-combo__legs" open={unpriced > 0}>
      <summary>{`The ${combo.legs.length} legs, and what each side costs`}</summary>
      <div className="table-wrap">
        <table className="coh-table">
          <caption className="coh-table__caption">
            Implied p is the mid of the side the parlay needs, what both bounds are built from; opposite cost is
            the offer the cover portfolio pays.
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
      {unpriced ? (
        <p className="coh-combo__note">
          {`${unpriced} legs show a dash for implied p — an unquoted side, not a zero probability.`}
        </p>
      ) : null}
    </details>
  );
}


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
 * The legend stays because it is the only place a reader learns what the
 * parlay actually SAYS; the ticker above it is an identifier, not a sentence.
 */
function ComboCard({ combo }: { combo: CoherenceCombo }) {
  return (
    <article className="coh-combo">
      <h5 className="coh-combo__title">{combo.ticker}</h5>
      <p className="coh-combo__legend">{combo.label}</p>
      {/* Neither the ask caveat nor the unquoted-leg caveat repeats here:
          FrechetBand's missing line and the leg table's own note carry them
          on this card, and NO_INDEPENDENCE stays on the Notes view. */}
      <FrechetBand reading={combo} />
      <LegTable combo={combo} />
    </article>
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

export function ParlaysView({ combos }: { combos: CoherenceCombo[] }) {
  const unquoted = combos.filter((combo) => combo.inside_band == null).length;

  return (
    <section className="coh-combos__rows">
      {/* THE VIEW'S OWN DRAWING, and what deleted its exemption in
          `engine-opens-on-a-drawing.test.ts`. That exemption said a figure here
          would be the same six bands the Bands view already draws together, and
          it was right about BANDS — so this is not one. It is the legs, at their
          implied p, which is what both bounds are built from. */}
      <ParlayLegs combos={combos} />

      {/* A TABLE, 2026-08-25: "reformat parlays as a table with proper headings,
          rows and columns". It was six folded cards, each a title, a meta line,
          a legend, a chip row, a band figure, a position sentence and a leg
          table — so comparing two parlays' band widths meant opening two folds
          and holding one number in your head. Six of the seven facts on a card
          are one measurement each, which is what a column is for; they are read
          DOWN now.

          What a cell cannot be — the band drawn, and the legs priced — is the
          one fold below, which is where the cards went rather than away. */}
      <div className="table-wrap">
        <table className="coh-table">
          <caption className="coh-table__caption">
            One row per listed parlay, worst position first. ● inside the band its legs impose, ▲ outside it —
            the only reading on this view that is a mispricing — ◌ unquoted, so there is no position to take.
          </caption>
          <thead>
            <tr>
              <th scope="col">Parlay</th>
              <th scope="col" className="num">Legs</th>
              <th scope="col" className="num">Lower bound</th>
              <th scope="col" className="num">Upper bound</th>
              <th scope="col" className="num">Band width</th>
              <th scope="col" className="num">Price</th>
              <th scope="col" className="num">In band</th>
            </tr>
          </thead>
          <tbody>
            {combos.map((combo) => {
              const position = toUnit(combo.band_position);
              return (
                <tr key={combo.ticker}>
                  {/* The ticker whole, in the row header. `ParlayLegs` above
                      truncates its labels to a measured gutter; a table cell
                      wraps instead, so this is the one place the full ticker
                      is readable without a hover. */}
                  <th scope="row">
                    <span aria-hidden="true">{positionMark(combo)}</span> {combo.ticker}
                  </th>
                  <td className="num">{combo.legs.length}</td>
                  <td className="num">{probLabel(combo.lower_bound)}</td>
                  <td className="num">{probLabel(combo.upper_bound)}</td>
                  <td className="num">{probLabel(combo.band_width)}</td>
                  <td className="num">{probLabel(combo.price)}</td>
                  {/* A LOCATION, NEVER A VERDICT — the failure mode this whole
                      section is built around. A price inside its band is not
                      "fairly priced": every price between the two bounds is
                      consistent with some dependence between the legs, and
                      nothing on this exchange quotes dependence. */}
                  <td className="num">
                    {position == null ? "—" : `${Math.round(position * 100)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {unquoted ? (
        <p className="coh-combo__meta">
          {`${unquoted} of ${combos.length} parlays are unquoted on a side they need, so they have no band and no position.`}
        </p>
      ) : null}

      {/* SIX FULL CARDS WAS 3,567px AT DESK WIDTH — measured, and the longest
          view on the desk by a factor of nearly two. The cards are trimmed to
          the two things the table cannot hold and folded into ONE disclosure
          rather than six: six summaries were six lines of chrome above the
          content, and the table above now carries the verdict they existed to
          preview. Nothing was removed. */}
      <details className="disclosure">
        <summary>
          {`Each parlay's band drawn, and what every leg costs, ${combos.length} ${combos.length === 1 ? "parlay" : "parlays"}`}
        </summary>
        {combos.map((combo) => <ComboCard combo={combo} key={combo.ticker} />)}
      </details>
    </section>
  );
}

export function NotesView({ combos, notes }: { combos: CoherenceCombo[]; notes: string[] }) {
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
        <details className="disclosure">
          <summary>{`What the gateway noted about this read, ${notes.length} ${notes.length === 1 ? "note" : "notes"}`}</summary>
          <ul className="coh-notes">
            {notes.map((note, index) => (
              <li key={`${index}-${note}`}>{note}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

