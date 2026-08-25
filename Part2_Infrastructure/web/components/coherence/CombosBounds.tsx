"use client";

/**
 * The Bounds view: every tested portfolio against the bound it is judged on.
 *
 * Split out of `CombosViews.tsx` on 2026-08-25, when that file crossed the
 * four-hundred-line ceiling. The seam is the one the file already had a banner
 * for: Bands and Parlays draw a PARLAY against the band its legs leave it, and
 * Bounds draws the PORTFOLIO those bounds are tested with. Different subject,
 * different table, different figure.
 *
 * WHAT THE FIGURE BECAME, AND WHY. It was a signed bar per row against a zero
 * fixed at 55% of the plot width, drawn for the violated rows or — when there
 * were none, which is the common answer — for the single tightest row. So on an
 * ordinary read the whole figure was one grey rectangle beside an axis labelled
 * `0`, which is what a chart looks like when it has failed rather than when the
 * book it describes is sound. The reader said it read as broken, and it did.
 *
 * It is a dumbbell now, over EVERY tested row: a tick at the bound, a dot at
 * what the portfolio costs, and the span between them IS the slack. That makes
 * the quantity a LENGTH — comparable across rows at a glance, without reading
 * six signed numbers — and it makes the common answer informative, because "how
 * much room is there" is a real question with six real answers where "is it
 * violated" had one and it was no.
 */

import type { CoherenceComboLeg, CoherenceComboRow } from "@/lib/coherence/types-lab";
import { priceLabel } from "@/lib/coherence/fixed-point";
import { DIAGRAM_LABEL_PX, gutterFor, truncateMiddle } from "@/lib/coherence/label-metrics";
import { toUnit } from "./FrechetBand";
import Figure, { Plot } from "./Figure";

/** One dumbbell row. 30 was the bespoke strip's; 26 fits more rows on screen
 *  now that every tested row is drawn rather than only the violated ones. */
const ROW_H = 26;

function RowLegs({ legs }: { legs: CoherenceComboLeg[] }) {
  return (
    <div className="table-wrap">
      <table className="coh-table">
        <caption className="coh-table__caption">
          A sold leg shows a dash: its price is absent from the payload, never zero.
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
          Slack is cost minus bound; negative is the violation, before fees.
          {untested ? " A dash is a claim not tested, never a cost of nothing." : ""}
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
  const cells = rows.map((row) => ({
    bound: toUnit(row.bound),
    cost: toUnit(row.cost),
    slack: toUnit(row.slack),
    violated: row.violated,
    label: `${row.violated ? "▲" : "●"} ${priceLabel(row.bound)} bound, ${row.scope}`,
    row,
  }));
  const priced = cells.flatMap((cell) => [cell.bound, cell.cost].filter((v): v is number => v != null));
  const lo = priced.length ? Math.min(...priced) : 0;
  const hi = priced.length ? Math.max(...priced) : 1;
  // A hair of padding either side, and never a zero-width span: every row here
  // is satisfied on the common answer, so bound and cost sit close together and
  // an axis fitted exactly to them would draw both ticks on the same pixel.
  const pad = Math.max((hi - lo) * 0.25, 0.02);
  const height = 8 + rows.length * ROW_H + 22;

  return (
    <Figure
      caption="Each tested portfolio against the bound it is judged on"
      ariaLabel={cells
        .map((cell) => `${priceLabel(cell.row.bound)} bound: the portfolio costs ${priceLabel(cell.row.cost)}, `
          + `${cell.slack == null ? "not tested" : `${priceLabel(cell.row.slack)} of slack`}`)
        .join(". ")}
      reading={
        cells.some((cell) => cell.violated)
          ? "A cost mark left of its bound is the violation: the portfolio pays at least the bound in every future and costs less than it."
          : "Every cost mark sits right of its bound, so nothing here can be bought for less than it is certain to pay."
      }
      notes={[
        "A reading about the BOUNDS only. Nothing here says whether a parlay is worth its price — every price "
        + "between its two bounds is consistent with some dependence between the legs, and nothing on this "
        + "exchange quotes dependence.",
      ]}
    >
      <Plot height={height}>
        {(width) => {
          const gutter = gutterFor(cells.map((cell) => cell.label), width, DIAGRAM_LABEL_PX, {
            min: 96, maxFraction: 0.34, max: 260,
          });
          const track = Math.max(60, width - gutter - 56);
          const x = (v: number) => gutter + ((v - (lo - pad)) / ((hi + pad) - (lo - pad))) * track;

          return (
            <>
              {cells.map((cell, index) => {
                const y = 8 + index * ROW_H;
                const mid = y + 9;
                if (cell.bound == null || cell.cost == null) {
                  return (
                    <g key={`slack-${index}`}>
                      <text x={gutter + 4} y={mid + 4} className="coh-combo__label">— not tested</text>
                    </g>
                  );
                }
                const from = Math.min(x(cell.bound), x(cell.cost));
                const to = Math.max(x(cell.bound), x(cell.cost));
                return (
                  <g key={`slack-${index}`}>
                    {/* The SPAN between the two is the slack: a length, which is
                        what a reader can compare across rows without arithmetic.
                        The bespoke strip this replaces drew one signed bar from
                        a zero fixed at 55% of the plot, so on the common answer
                        — one satisfied row — the whole figure was a single grey
                        rectangle beside an axis labelled 0. */}
                    <line x1={from} x2={to} y1={mid} y2={mid}
                          className={`coh-slack__span${cell.violated ? " is-violated" : ""}`}>
                      <title>{`slack ${priceLabel(cell.row.slack)}${cell.violated ? " — violated, a Dutch book before fees" : ""}`}</title>
                    </line>
                    <line x1={x(cell.bound)} x2={x(cell.bound)} y1={mid - 8} y2={mid + 8} className="coh-slack__bound">
                      <title>{`the bound is ${priceLabel(cell.row.bound)} — what this portfolio is certain to pay`}</title>
                    </line>
                    <circle cx={x(cell.cost)} cy={mid} r={5}
                            className={`coh-slack__cost${cell.violated ? " is-violated" : ""}`}>
                      <title>{`the portfolio costs ${priceLabel(cell.row.cost)}`}</title>
                    </circle>
                  </g>
                );
              })}
              {cells.map((cell, index) => (
                <text key={`slack-label-${index}`} x={0} y={8 + index * ROW_H + 13} className="coh-combo__label">
                  {truncateMiddle(cell.label, gutter - 10, DIAGRAM_LABEL_PX)}
                </text>
              ))}
              {/* `toFixed`, not `priceLabel`. These two are the axis's own
                  ENDS — derived from the data plus padding, not values the
                  exchange sent — and `priceLabel` parses a wire string, so it
                  answered "—" for both and the axis lost its scale entirely. */}
              <text x={gutter} y={height - 4} className="coh-combo__axis">{(lo - pad).toFixed(4)}</text>
              <text x={gutter + track} y={height - 4} textAnchor="end" className="coh-combo__axis">
                {(hi + pad).toFixed(4)}
              </text>
              <text x={gutter + track + 8} y={8 + 13} className="coh-slack__key">| bound ● cost</text>
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


export function BoundsView(
  { rows, violated, tightest }: { rows: CoherenceComboRow[]; violated: CoherenceComboRow[]; tightest: CoherenceComboRow | null },
) {
  // EVERY tested row is drawn, not just the violated ones or the closest.
  // Showing one row made the figure a single mark on an axis, which reads as a
  // chart that failed rather than as a book with nothing wrong in it — and it
  // hid the thing the figure is for: how much room the rest have. The cards
  // below still open on the violations, or on the tightest when there are none.
  const shown = rows.length ? rows : [];
  const cards = violated.length ? violated : tightest ? [tightest] : [];
  return (
    <section className="coh-combos__rows">
      {shown.length ? <SlackStrip rows={shown} /> : null}
      {/* A COUNT, not a paragraph. All three branches used to restate what the
          strip above draws — whether each cost mark clears its bound — and the
          strip's own `reading` already makes that judgement in the words the
          figure earns. What is left is the arithmetic a length cannot carry:
          how many of how many, and the one case where the answer is neither. */}
      <p className="coh-combo__meta">
        {rows.length
          ? `${violated.length} of ${rows.length} testable rows violated.`
          : "No row could be tested: every one needed a leg unquoted on the side the bound uses."}
      </p>
      {cards.length ? <RowFacts rows={cards} /> : null}
      {cards.map((row, index) => <RowBlock key={`row-${index}`} row={row} tightest={!violated.length} />)}
    </section>
  );
}
