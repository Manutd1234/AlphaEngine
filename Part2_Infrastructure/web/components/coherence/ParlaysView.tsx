"use client";

/**
 * The Parlays view: one row per parlay, named, with everything a cell cannot
 * hold behind its own fold.
 *
 * Split out of `CombosViews.tsx` on 2026-08-26 with the redo Ian asked for —
 * "redo the Parlays subtab... redo the entire thing" — which would have put
 * that file over the 400-line ceiling. The seam is the view: `BandsView` and
 * `NotesView` are readings of the same payload and stay there; everything
 * under the Parlays switcher, including the card behind each fold and the leg
 * table inside the card, is here.
 *
 * THE NAME LEADS. `combo.label` carries the venue's own words and this view
 * rendered it in exactly one place — a paragraph inside a closed fold — while
 * the table, both strips and every summary printed `KXMVE-26AUG25-LIV-9C1`.
 * `parlayName` is the one spelling of a parlay's name now, and the ticker
 * keeps its place beside it as the identifier it is, set in mono so the two
 * cannot be confused.
 */

import type { CoherenceCombo } from "@/lib/coherence/types-lab";
import { priceLabel } from "@/lib/coherence/fixed-point";
import { parlayName } from "@/lib/coherence/parlay-name";
import { probLabel, toUnit } from "@/lib/coherence/decimals";
import FrechetBand from "./FrechetBand";
import { StateChip } from "./Figure";
import ParlayLegs from "./ParlayLegs";
import { pct } from "@/lib/format";

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
        <table className="coh-table">
          <caption className="coh-table__caption">
            {`The ${combo.legs.length} legs this band is built from. `}
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
      {/* Neither the ask caveat nor the unquoted-leg caveat repeats here:
          FrechetBand's missing line and the leg table's own note carry them
          on this card, and NO_INDEPENDENCE stays on the Notes view. */}
      <FrechetBand reading={combo} />
      <LegTable combo={combo} />
      {/* The gateway's own account of how this parlay's band was built. It has
          been on the wire since the route was written and drawn nowhere. */}
      {combo.detail ? <p className="coh-combo__note">The gateway says: {combo.detail}</p> : null}
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
      {/* tabIndex on the wrap: seven columns scroll inside it at narrow widths, and a
          scroll region nobody can focus is unreachable by keyboard. */}
      <div className="table-wrap" tabIndex={0}>
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
                  {/* The NAME, then the ticker whole. `ParlayLegs` above
                      truncates its labels to a measured gutter; a table cell
                      wraps instead, so this is the one place both the name and
                      the full ticker are readable without a hover. */}
                  <th scope="row">
                    <span aria-hidden="true">{positionMark(combo)}</span> {parlayName(combo)}{" "}
                    <code className="coh-combo__ticker">{combo.ticker}</code>
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
                    {position == null ? "—" : pct(position, 0)}
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
      {/* ONE FOLD PER PARLAY, NAMED — and it is a restoration rather than a new
          idea. Collapsing six named folds into one lost the only way to reach a
          NAMED parlay: a reader after a particular ticker had to open a fold
          reading "…6 parlays" and scroll six cards to find it. The summary
          carries the ticker and its verdict again, so the closed state is six
          readings rather than one drawer.

          It also un-nests the leg table. That table lived inside a `<details>`
          inside this one, and self-opened when a leg was unpriced — a visibly
          open drawer inside a closed one. Now the parlay's fold is the only
          fold, and everything about that parlay is behind exactly one click. */}
      {combos.map((combo) => (
        <details className="disclosure" key={combo.ticker}>
          <summary>
            <span aria-hidden="true">{positionMark(combo)}</span> {parlayName(combo)}{" "}
            <code className="coh-combo__ticker">{combo.ticker}</code>
            {" — "}
            {combo.legs.length} legs, {combo.scope}
          </summary>
          <ComboCard combo={combo} />
        </details>
      ))}
    </section>
  );
}

/** How many caveats `NotesView` prints: one per price basis present, plus one when any parlay is unquoted. */
