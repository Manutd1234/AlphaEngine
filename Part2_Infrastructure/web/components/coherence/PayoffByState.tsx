"use client";

/**
 * The tab's headline claim, drawn: what the winning portfolio pays in EVERY
 * state the family can settle into.
 *
 * The page header promises "the portfolio that wins in every state", and the
 * one verdict that actually makes that claim — `incoherent` — drew nothing:
 * the basket was a table and its worst state a cell in a footer. A table
 * cannot show "every". A column per state and one line at zero can, and the
 * argument becomes a question answered by looking: does every bar clear it?
 *
 * Four decisions, each a way this chart could lie:
 *
 * **The states are the exchange's, not this file's.** For a family the venue
 * marks mutually exclusive the engine's state space is one state per market
 * (`kernel/states.py::_named_states`) and the payoff matrix is the identity;
 * that is the only shape rebuilt here. A strike family's interval states would
 * need the strikes re-derived on this side, and a state space guessed wrong
 * draws a different world confidently — so the caller passes the states in and
 * this figure refuses when they do not cover every leg.
 *
 * **Fees come off the top of the bar, not out of the number.** Net alone hides
 * how much of the edge the three fee components eat; gross alone is the naive
 * reading the fee model exists to reject. The dashed block is the slice
 * `total_fees` takes, so gross and net arrive as one mark.
 *
 * **The zero line is the assertion, so it is drawn over the data** — the same
 * rule the dollar line follows on `DollarBar`. Nothing may occlude it.
 *
 * **A state that could not be measured is a gap.** If a leg's price or size
 * does not parse, every column that leg touches is a dash, never a zero: zero
 * is a payoff this portfolio might genuinely have, and "unreadable" is not it.
 *
 * THE FOOTNOTES WERE CUT BY ABOUT A THIRD ON 2026-08-24 and no claim went with
 * them. Four of them re-explained a fact the same paragraph had just stated in
 * other words: that a dash is not a zero, said twice; that these columns are
 * the state space the engine could reach, said in both branches of the
 * untestable note; that fees would have come off had a bar been drawn, on a
 * figure with no bars. What is left is one clause per fact.
 *
 * REJECTED: dropping the "no constraint went untested" branch entirely, on the
 * grounds that a reader does not need to be told nothing is missing. It is the
 * difference between a figure that checked and a figure that did not, and this
 * whole component exists to keep those apart — so it stays, at four words.
 */

import { toCenticents } from "@/lib/coherence/fixed-point";
import { legPayoffsInState, MICRO_PER_CC, money, payoffsByState, toMicros, type PayoffState } from "@/lib/coherence/payoff-by-state";
import type { CoherenceCertificate } from "@/lib/coherence/types";
import Figure, { FigureEmpty, Plot } from "./Figure";

export type { PayoffState } from "@/lib/coherence/payoff-by-state";

const HEIGHT = 190;
/** The gutter for the two reference lines' figures, where no bar reaches.
 *  Sized for "$0 break even": 13 chars x 13px note rung x 0.56 = 95px + 6. */
const MARGIN = { top: 36, right: 104, bottom: 36, left: 8 };
const MAX_BAR = 54;
const CAPTION = "What the portfolio pays in each state this family can settle into, gross and after fees";

/** The rows the crosshair reads at one state: each leg, the total, the fees, the net, the word. */
function readState(
  certificate: CoherenceCertificate,
  states: PayoffState[],
  column: { label: string; gross: number | null },
  index: number,
  fees: number | null,
) {
  const legs = legPayoffsInState(certificate, states[index]);
  const perLeg = legs.length <= 6
    ? legs.map((leg) => ({ label: leg.label, value: money(leg.micros), raw: leg.micros }))
    : [{ label: "Legs", value: `${legs.length}, ${legs.filter((leg) => leg.micros == null).length} unreadable` }];
  const net = column.gross == null || fees == null ? null : column.gross - fees;
  return {
    title: `State ${index + 1} of ${states.length}: ${column.label}`,
    rows: [
      ...perLeg,
      { label: "Gross", value: column.gross == null ? "— not measurable: a leg could not be read" : money(column.gross), raw: column.gross },
      { label: "Fees", value: certificate.total_fees ?? "not readable" },
      { label: "Net", value: money(net), raw: net },
      { label: "Basket", value: column.gross == null ? "—" : column.gross > 0 ? "pays" : column.gross < 0 ? "loses" : "breaks even" },
    ],
  };
}

export default function PayoffByState({
  certificate,
  states,
}: {
  certificate: CoherenceCertificate;
  states: PayoffState[];
}) {
  const tickers = new Set(states.map((state) => state.ticker));
  const outside = certificate.legs.filter((leg) => !tickers.has(leg.ticker));

  if (!certificate.legs.length || !states.length) {
    return (
      <Figure
        caption={CAPTION}
        ariaLabel="No portfolio and no state space to draw"
        missing={`${certificate.rows_untestable} constraint(s) went untested, and nothing here says what the remaining states are.`}
      >
        <FigureEmpty reason="Nothing to draw — this test returned no portfolio, or no state space for it." />
      </Figure>
    );
  }

  if (outside.length) {
    return (
      <Figure
        caption={CAPTION}
        ariaLabel="The portfolio reaches outside this family, so its states cannot be drawn from it alone"
        missing={`${outside.length} of ${certificate.legs.length} legs sit outside this event — scope "${certificate.scope}" — so drawing this family's states would show a smaller world than the engine priced. ${certificate.rows_untestable} constraint(s) went untested. ${certificate.tier_note}`}
      >
        <FigureEmpty reason="No state space — this portfolio spans more than this family's outcomes." />
      </Figure>
    );
  }

  const { columns, unreadable } = payoffsByState(certificate, states);
  const drawn = columns.map((column) => column.gross).filter((value): value is number => value != null);

  if (!drawn.length) {
    return (
      <Figure
        caption={CAPTION}
        ariaLabel="No state could be measured"
        missing={`No column is drawn: ${unreadable.join(", ") || "a leg"} could not be read, and an unknown payoff is not a payoff of zero. ${certificate.rows_untestable} constraint(s) went untested.`}
      >
        <FigureEmpty reason="No payoff could be measured — a leg's price or size did not parse." />
      </Figure>
    );
  }

  const fees = toMicros(certificate.total_fees);
  const worstCc = toCenticents(certificate.worst_case_payoff);
  const worst = worstCc == null ? null : worstCc * MICRO_PER_CC;
  const lowest = Math.min(...drawn);
  const agrees = worst != null && Math.abs(lowest - worst) <= MICRO_PER_CC;
  const clears = lowest > 0;

  const nets = fees == null ? [] : drawn.map((value) => value - fees);
  const marks = [0, ...drawn, ...nets, ...(worst == null ? [] : [worst])];
  const hi = Math.max(...marks);
  const lo = Math.min(...marks);
  const pad = Math.max(1_000, (hi - lo) * 0.18);
  const domainHi = hi + pad;
  const domainLo = lo - pad;
  const plotTop = MARGIN.top;
  const plotBottom = HEIGHT - MARGIN.bottom;
  const y = (value: number) =>
    plotBottom - ((value - domainLo) / (domainHi - domainLo)) * (plotBottom - plotTop);

  // Gross clearing the line is not the trade being worth putting on, and this
  // figure draws the gross: "pays in every state" without the net beside it is
  // the naive reading the fee model exists to reject. The sign comes off
  // `net_edge` rather than `worth_doing`, so the sentence cannot contradict the
  // figure printed beside it if those two ever disagree on the wire.
  const netEdge = toMicros(certificate.net_edge);
  const afterFees =
    netEdge == null
      ? ""
      : ` Fees take it to ${certificate.net_edge}, ${netEdge > 0 ? "still above the line" : "below the line — the violation is real and the fees price it out"}.`;
  // The JUDGEMENT, not the geometry. This opened by reciting the drawing —
  // "every column clears zero; the lowest is X" — to a reader looking straight
  // at it. What survives is what bars against a rule cannot say. The third
  // branch stays whole: it exists because two marks that LOOK like one claim
  // are two different numbers, which no arrangement of marks can convey.
  const reading = agrees
    ? clears
      ? `This portfolio pays in every state the engine could test.${afterFees}${certificate.because ? ` ${certificate.because}.` : ""}`
      : "There is a state this portfolio loses in."
    : `The lowest column drawn is ${money(lowest)} against a reported worst case of ${certificate.worst_case_payoff ?? "—"} — different numbers, so the dashed rule and the shortest bar are not one claim.`;

  // One clause per fact, none repeating another.
  const missing = [
    certificate.rows_untestable
      ? `${certificate.rows_untestable} constraint(s) went untested — a leg was unquoted — so these columns are the reachable state space, not the whole one.`
      : "No constraint went untested.",
    fees == null
      ? `Fees are NOT drawn — total_fees (${certificate.total_fees ?? "—"}) did not parse at the exchange's precision — so every bar is gross.`
      // Drawn on every column and named in the key as "fees, subtracted".
      : "",
    unreadable.length
      ? `${unreadable.length} leg(s) could not be read — ${unreadable.join(", ")} — so every state they touch is a dash, never a zero.`
      : "",
    // Dropped: the reading's third branch says this, with both numbers in it.

  ]
    .filter(Boolean)
    .join(" ");

  const measured = `${drawn.length} of ${columns.length} states measured`;

  // The key names only marks this figure actually draws. A legend entry for a
  // line that is not on the plot sends a reader looking for something absent,
  // which is the same failure as omitting one that is.
  const legend: Array<{ mark: "bar" | "fee" | "rule" | null; text: string }> = [
    { mark: "bar", text: "gross payoff" },
  ];
  if (fees != null) legend.push({ mark: "fee", text: "fees, subtracted" });
  if (worst != null) legend.push({ mark: "rule", text: "worst case" });
  if (unreadable.length) legend.push({ mark: null, text: "— not measurable" });

  // ONE GEOMETRY for the columns and the crosshair: states in the exchange's
  // order, one slot each, so the rule sits on the column it names.
  const layout = (width: number) => {
    const inner = Math.max(1, width - MARGIN.left - MARGIN.right);
    const slot = inner / columns.length;
    return { inner, slot, cx: (index: number) => MARGIN.left + slot * (index + 0.5) };
  };

  return (
    <Figure
      caption={CAPTION}
      ariaLabel={`One column per outcome, ${measured}, fees off the top, a dashed rule at the worst case`}
      reading={reading}
      missing={missing}
    >
      <Plot
        height={HEIGHT}
        sharedX={(width) => {
          const { cx } = layout(width);
          return {
            count: columns.length,
            x0: cx(0),
            x1: cx(columns.length - 1),
            read: (index) => readState(certificate, states, columns[index], index, fees),
            width: 300,
            arriveAt: "first",
            link: "basket-states",
          };
        }}
      >
        {(width) => {
          const { slot, cx } = layout(width);
          const bar = Math.min(MAX_BAR, slot * 0.62);
          const zeroY = y(0);
          const labelY = HEIGHT - 12;
          // 7.28px/char: the 13px label rung (14r) x ~0.56 (was 6.7 at 12px).
          const budget = Math.max(3, Math.floor(slot / 7.28));
          const gutter = width - MARGIN.right + 6;
          // Below this a seven-character figure prints through its neighbour.
          // Re-derived at 13px: 7 x 7.28 = 50.96, and 54 stood at 1.149 x the
          // 46.9 it was sized for, so 50.96 x 1.149 = 58.6 -> 59.
          const roomForFigures = slot >= 59;
          const short = (text: string) =>
            text.length > budget ? `${text.slice(0, budget - 1)}…` : text;
          // When the worst state sits close to zero the two gutter figures land
          // on the same line, and one printing through the other is how a
          // reader ends up reading a third number that is in neither.
          const worstY = worst == null ? null : y(worst);
          const worstTextY =
            worstY == null ? 0 : Math.abs(worstY - zeroY) < 11 ? worstY - 7 : worstY + 3.5;
          return (
            <>
              {/* The key. Every mark here also carries a word, because a fill
                  and a dashed outline are not something a reader can be asked
                  to tell apart by colour. Packed left to right from the text
                  itself so a dropped entry closes its own gap. */}
              {legend.map((item, index) => {
                const x =
                  MARGIN.left +
                  legend
                    .slice(0, index)
                    .reduce((sum, prior) => sum + 14 + (prior.mark ? 16 : 0) + prior.text.length * 6.7, 0);
                return (
                  <g key={item.text}>
                    {item.mark === "rule" ? (
                      <line x1={x} x2={x + 12} y1="12" y2="12" className="coh-parabola__peak" />
                    ) : item.mark ? (
                      <rect
                        x={x}
                        y="7"
                        width="12"
                        height="9"
                        className={`coh-ablation__bar${item.mark === "fee" ? " is-naive" : ""}`}
                      />
                    ) : null}
                    <text x={x + (item.mark ? 16 : 0)} y="15" className="coh-ablation__label">
                      {item.text}
                    </text>
                  </g>
                );
              })}

              {columns.map((column, index) => {
                const centre = cx(index);
                // A leg sits in the cost of EVERY state, so one unreadable leg
                // normally takes the whole figure to the empty state above.
                // This branch is what draws the difference the moment a state
                // exists whose payoff alone could not be read. Its facts are
                // in the crosshair's rows, not a title.
                if (column.gross == null) {
                  return (
                    <g key={`${index}-${column.label}`}>
                      <text
                        x={centre}
                        y={(plotTop + plotBottom) / 2}
                        textAnchor="middle"
                        className="coh-ablation__value"
                      >
                        —
                      </text>
                      <text x={centre} y={labelY} textAnchor="middle" className="coh-ablation__label">
                        {short(column.label)}
                      </text>
                    </g>
                  );
                }
                const grossY = y(column.gross);
                const net = fees == null ? column.gross : column.gross - fees;
                const netY = y(net);
                const topY = Math.min(grossY, netY, zeroY);
                return (
                  <g key={`${index}-${column.label}`}>
                    <rect
                      x={centre - bar / 2}
                      y={Math.min(grossY, zeroY)}
                      width={bar}
                      height={Math.max(0.6, Math.abs(zeroY - grossY))}
                      className="coh-ablation__bar"
                    />
                    {fees == null ? null : (
                      <rect
                        x={centre - bar / 2}
                        y={Math.min(grossY, netY)}
                        width={bar}
                        height={Math.max(0.6, Math.abs(netY - grossY))}
                        className="coh-ablation__bar is-naive"
                      />
                    )}
                    {roomForFigures ? (
                      <text
                        x={centre}
                        y={Math.max(MARGIN.top - 8, topY - 5)}
                        textAnchor="middle"
                        className="coh-ablation__value"
                      >
                        {money(fees == null ? column.gross : net)}
                      </text>
                    ) : null}
                    <text x={centre} y={labelY} textAnchor="middle" className="coh-ablation__label">
                      {short(column.label)}
                    </text>
                  </g>
                );
              })}

              {/* Both references are drawn last so no bar can cover them: they
                  are the only two lines the reader is asked to judge against. */}
              {worstY == null ? null : (
                <>
                  <line x1="0" x2={width - MARGIN.right} y1={worstY} y2={worstY} className="coh-parabola__peak" />
                  <text x={gutter} y={worstTextY} className="coh-ablation__value">
                    {certificate.worst_case_payoff}
                  </text>
                </>
              )}
              <line x1="0" x2={width - MARGIN.right} y1={zeroY} y2={zeroY} className="coh-dollarbar__dollar" />
              <text x={gutter} y={zeroY + 3.5} className="coh-dollarbar__dollar-label">
                $0 break even
              </text>
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}
