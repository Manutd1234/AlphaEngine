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

import type { CoherenceCombo, CoherenceComboLeg, CoherenceComboRow } from "@/lib/coherence/types-lab";
import { priceLabel } from "@/lib/coherence/fixed-point";
import ComboBandStrips from "./ComboBandStrips";
import FrechetBand, { DEPENDENCE_WORD, basisCaveat, probLabel, toUnit } from "./FrechetBand";
import Figure, { Plot, StateChip } from "./Figure";

/** Said on the card whose Πpᵢ is missing, and once under Notes. Never both. */
const NO_INDEPENDENCE =
  "A leg is unquoted on the side the parlay needs, so Πpᵢ has no value and neither do the bounds — a missing quote, not a probability of zero.";

/** Where in the band a price sits, as prose. A location, never a verdict. */
function positionSentence(combo: CoherenceCombo): string {
  const position = toUnit(combo.band_position);
  if (position == null) {
    return combo.price == null
      ? "Unquoted on both sides."
      : "The band has no width, so there is no fraction to take.";
  }
  if (position < 0 || position > 1) {
    return "Outside the band — the only reading on this pane that is a mispricing.";
  }
  return `${Math.round(position * 100)}% of the way from lower bound to upper: a location, not a verdict.`;
}

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

function RowLegs({ legs }: { legs: CoherenceComboLeg[] }) {
  return (
    <div className="table-wrap">
      <table className="coh-table">
        <caption className="coh-table__caption">
          The portfolio this bound is tested with. A sold leg shows a dash — its price is absent from the payload, not
          zero.
        </caption>
        <thead>
          <tr>
            <th scope="col">Leg</th>
            <th scope="col">Direction</th>
            <th scope="col">Side</th>
            <th scope="col" className="num">Cost</th>
          </tr>
        </thead>
        <tbody>
          {legs.map((leg, index) => (
            <tr key={`${leg.ticker}-${index}`}>
              <th scope="row">{leg.label || leg.ticker}</th>
              <td>{leg.buy_cost == null ? "Sell" : "Buy"}</td>
              <td>
                <span className="coh-combo__side">{leg.side}</span>
              </td>
              <td className="num">{priceLabel(leg.buy_cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Every shown bound in one table, a row each.
 *
 * These four numbers used to be a `<dl>` inside each row block, so two violated
 * rows arrived as two free-standing lists and no column could be read down.
 */
function RowFacts({ rows }: { rows: CoherenceComboRow[] }) {
  const untested = rows.some((row) => row.cost == null || row.slack == null);
  return (
    <div className="table-wrap">
      <table className="coh-table">
        <caption className="coh-table__caption">
          Slack is the portfolio&rsquo;s cost minus its bound: negative is the violation, before fees.
          {untested ? " A dash is a claim not tested — a leg lost its quote between the read and this row — never a cost of nothing." : ""}
        </caption>
        <thead>
          <tr>
            <th scope="col" className="num">Bound</th>
            <th scope="col" className="num">Portfolio cost</th>
            <th scope="col" className="num">Slack</th>
            <th scope="col">Scope</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`facts-${index}`}>
              <th scope="row" className="num">{priceLabel(row.bound)}</th>
              <td className="num">{priceLabel(row.cost)}</td>
              <td className="num">{priceLabel(row.slack)}</td>
              <td>{row.scope}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The Bounds view's own drawing (third 2026-08-24 review): each shown row's
 * slack as a bar from a shared zero line. Negative runs left and is the
 * violation; the mark and word beside each bar carry that without colour. A
 * row whose slack was not measured gets words, never a zero-length bar.
 */
function SlackStrip({ rows }: { rows: CoherenceComboRow[] }) {
  const values = rows.map((row) => {
    const slack = toUnit(row.slack);
    return slack == null ? null : slack;
  });
  const widest = Math.max(...values.map((value) => (value == null ? 0 : Math.abs(value))), 1e-9);
  const height = 8 + rows.length * 30 + 20;
  return (
    <Figure
      caption="Each tested portfolio's slack against its bound"
      ariaLabel={rows
        .map((row, index) => `bound ${priceLabel(row.bound)}: slack ${values[index] == null ? "not tested" : priceLabel(row.slack)}`)
        .join(". ")}
    >
      <Plot height={height}>
        {(width) => {
          const zero = width * 0.55;
          const scale = (width * 0.4) / widest;
          return (
            <>
              {rows.map((row, index) => {
                const y = 8 + index * 30;
                const value = values[index];
                return (
                  <g key={`slack-${index}`}>
                    <text x={0} y={y + 14} className="coh-combo__label">
                      {`${row.violated ? "▲" : "●"} bound ${priceLabel(row.bound)}, ${row.scope}`}
                    </text>
                    {value == null ? (
                      <text x={zero + 4} y={y + 14} className="coh-combo__label">— not tested</text>
                    ) : (
                      <rect
                        x={value < 0 ? zero - Math.abs(value) * scale : zero}
                        y={y + 4}
                        width={Math.max(1, Math.abs(value) * scale)}
                        height={14}
                        className={value < 0 ? "coh-dollarbar__leg is-leg-2" : "coh-kelly__bar-cash"}
                      >
                        <title>{`slack ${priceLabel(row.slack)}${value < 0 ? " — violated, a Dutch book before fees" : ""}`}</title>
                      </rect>
                    )}
                  </g>
                );
              })}
              <line x1={zero} x2={zero} y1={4} y2={height - 16} className="coh-ladder__axis" />
              <text x={zero} y={height - 4} textAnchor="middle" className="coh-combo__axis">0</text>
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}

function RowBlock({ row, tightest }: { row: CoherenceComboRow; tightest: boolean }) {
  const mark = row.violated ? "▲" : "●";
  const word = row.violated ? "Violated, a Dutch book before fees" : tightest ? "Satisfied, the closest of them" : "Satisfied";
  return (
    <div className="coh-combo__row">
      <p className="coh-combo__because">
        <span aria-hidden="true">{mark}</span> {word}: {row.because}
      </p>
      {/* The verdict and its reason stay open; the portfolio proving it is
          per-leg detail and takes a summary that counts the legs (fourth
          review of 2026-08-24). SlackStrip above already draws whether this
          row clears its bound, which is what a reader on Bounds came for. */}
      <details className="disclosure">
        <summary>{`The ${row.legs.length} legs this bound is tested with`}</summary>
        <RowLegs legs={row.legs} />
      </details>
    </div>
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
      {combo.independence == null ? (
        <StateChip mark="◌" word="No independence figure" tone="muted" />
      ) : (
        <>
          <StateChip mark="○" word="Independence Πpᵢ" value={probLabel(combo.independence)} tone="muted" />
          <StateChip mark="◇" word={DEPENDENCE_WORD[combo.dependence] ?? combo.dependence} tone="muted" />
        </>
      )}
    </div>
  );
}

function ComboCard({ combo }: { combo: CoherenceCombo }) {
  return (
    <article className="coh-combo">
      <h5 className="coh-combo__title">{combo.ticker}</h5>
      <p className="coh-combo__meta">
        {`${combo.legs.length} legs, ${combo.scope}, listed in ${combo.collection_ticker || "no collection"}`}
      </p>
      <p className="coh-combo__legend">{combo.label}</p>

      <ComboChips combo={combo} />
      {/* Neither the ask caveat nor the unquoted-leg caveat repeats here:
          FrechetBand's missing line and the leg table's own note carry them
          on this card, and NO_INDEPENDENCE stays on the Notes view. */}
      <FrechetBand reading={combo} />
      <p className="coh-combo__where">{positionSentence(combo)}</p>
      <LegTable combo={combo} />
    </article>
  );
}

export function BandsView({ combos }: { combos: CoherenceCombo[] }) {
  return (
    <section className="coh-combos__rows">
      <h4 className="console-subhead">The bands, and where each price sits</h4>
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

export function ParlaysView({ combos }: { combos: CoherenceCombo[] }) {
  return (
    <section className="coh-combos__rows">
      <h4 className="console-subhead">{`Each of the ${combos.length} parlays, its band and its legs`}</h4>
      <p className="coh-combo__meta">
        One line per parlay, carrying where its price sits in the band its own legs leave. Open one for the
        band drawn and the leg-by-leg cost; the Bands view draws all {combos.length} against each other.
      </p>
      {/* SIX FULL CARDS WAS 3,567px AT DESK WIDTH — measured, and the longest
          view on the desk by a factor of nearly two. Each card is a title, a
          chip row, a band figure, a position sentence and a leg table, and six
          of them stacked is the scrolling this reader has objected to three
          times.

          The summary carries the VERDICT — where the price sits in the band —
          so the folded state is not a list of tickers a reader has to open one
          by one to search: it is six readings, and the drawing behind each is
          one press. That is the same trade the fourth review made across this
          tab, and it is available here because the Bands view already draws all
          six bands against each other, so the cross-parlay comparison is not
          what this view is for. */}
      {combos.map((combo) => (
        <details className="disclosure" key={combo.ticker}>
          <summary>{`${combo.ticker} — ${positionSentence(combo)}`}</summary>
          <ComboCard combo={combo} />
        </details>
      ))}
    </section>
  );
}

export function BoundsView(
  { rows, violated, tightest }: { rows: CoherenceComboRow[]; violated: CoherenceComboRow[]; tightest: CoherenceComboRow | null },
) {
  const shown = violated.length ? violated : tightest ? [tightest] : [];
  return (
    <section className="coh-combos__rows">
      <h4 className="console-subhead">What the bounds test found</h4>
      <p className="coh-combo__meta">
        {violated.length
          ? `${violated.length} of ${rows.length} testable rows are violated. Each portfolio below pays at least its bound in every future and costs less than that, before fees.`
          : rows.length
            ? `None of the ${rows.length} testable rows is violated: no parlay is priced outside the band its legs impose — a reading about the bounds only, never about whether a parlay is worth its price.`
            : "No row could be tested: every one needed a leg unquoted on the side the bound uses."}
      </p>
      {!violated.length && tightest ? (
        <p className="coh-combo__meta">
          {`The closest still leaves ${priceLabel(tightest.slack)} between the portfolio and its bound.`}
        </p>
      ) : null}
      {shown.length ? <SlackStrip rows={shown} /> : null}
      {shown.length ? <RowFacts rows={shown} /> : null}
      {shown.map((row, index) => <RowBlock key={`row-${index}`} row={row} tightest={!violated.length} />)}
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
        <p className="coh-combo__caveat">
          {`${unquoted} parlays show no independence figure. ${NO_INDEPENDENCE}`}
        </p>
      ) : null}
      {notes.length ? (
        <ul className="coh-notes">
          {notes.map((note, index) => (
            <li key={`${index}-${note}`}>{note}</li>
          ))}
        </ul>
      ) : (
        <p className="coh-combo__note">The gateway returned no notes; the caveats above hold on every read.</p>
      )}
    </section>
  );
}

