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
 */

import { DOLLAR_CC, fromCenticents, toCenticents } from "@/lib/coherence/fixed-point";
import type { CoherenceCertificate } from "@/lib/coherence/types";
import Figure, { FigureEmpty, Plot } from "./Figure";

const HEIGHT = 190;
/** The right margin is a gutter: the two reference lines put their figures
 *  there, where no bar can ever reach them. */
const MARGIN = { top: 36, right: 86, bottom: 36, left: 8 };
const MAX_BAR = 54;
/** Micro-dollars per centicent. Every amount below is integer micro-dollars. */
const MICRO_PER_CC = 100;
const CAPTION = "What the winning portfolio pays in each state this family can settle into, gross and after fees";

/** One settlement state: the market that resolves YES in it. */
export interface PayoffState {
  ticker: string;
  label: string;
}

interface Column {
  label: string;
  /** Gross payoff in micro-dollars, before fees. Null when a leg is unreadable. */
  gross: number | null;
}

/**
 * A dollar string to integer micro-dollars ($0.000001).
 *
 * `toCenticents` is the right parser for a price and the wrong one for a fee.
 * The rounding component floors a notional to the account's balance precision,
 * so `total_fees` arrives at SIX decimals, and a centicent parser rejects that
 * as "not a price from a book". Rejecting the fee would leave the gross bar
 * with nothing taken off it — the one direction that invents an edge.
 */
function toMicros(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const match = /^(-?)(\d*)(?:\.(\d{0,6}))?$/.exec(raw.trim());
  if (!match) return null;
  const [, sign, whole, fraction = ""] = match;
  if (!whole && !fraction) return null;
  const micros = Number(whole || "0") * 1_000_000 + Number(`${fraction}000000`.slice(0, 6));
  return sign === "-" ? -micros : micros;
}

/** A computed amount at the exchange's canonical four decimals. */
function money(micros: number | null): string {
  if (micros == null) return "—";
  return fromCenticents(Math.round(micros / MICRO_PER_CC)) ?? "—";
}

/**
 * The portfolio's gross payoff in each state, rebuilt the way the kernel does.
 *
 * ``kernel/dutchbook.py::_worst_case_gross``, in the browser: a bought leg
 * contributes ``(payoff - price) * size`` and a sold leg the mirror of it, at
 * RAW prices, before any fee. Held in micro-dollars because a price is exact to
 * a centicent and a size to a hundredth of a contract, and their product is
 * exact to neither on its own.
 */
function payoffsByState(certificate: CoherenceCertificate, states: PayoffState[]) {
  const unreadable: string[] = [];
  const priced = certificate.legs.map((leg) => {
    const price = toCenticents(leg.price);
    const size = toCenticents(leg.size);
    if (price == null || size == null) {
      unreadable.push(leg.label || leg.ticker);
      return null;
    }
    return { ticker: leg.ticker, price, size, selling: leg.direction === "sell" };
  });

  const columns: Column[] = states.map((state) => {
    let total = 0;
    for (const leg of priced) {
      if (leg == null) return { label: state.label, gross: null };
      const payoff = leg.ticker === state.ticker ? DOLLAR_CC : 0;
      const per = leg.selling ? leg.price - payoff : payoff - leg.price;
      total += (per * leg.size) / MICRO_PER_CC;
    }
    return { label: state.label, gross: total };
  });

  return { columns, unreadable };
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
        ariaLabel="Payoff by settlement state: there is no portfolio and no state space to draw"
        missing={`${certificate.rows_untestable} constraint(s) could not be tested, and nothing here says what the remaining states are.`}
      >
        <FigureEmpty reason="Nothing to draw — this test returned no portfolio, or no state space for it." />
      </Figure>
    );
  }

  if (outside.length) {
    return (
      <Figure
        caption={CAPTION}
        ariaLabel="Payoff by settlement state: the portfolio reaches outside this family, so its states cannot be drawn from this family alone"
        missing={`${outside.length} of ${certificate.legs.length} legs sit outside this event — the scope is "${certificate.scope}" — so the states this family settles into are not the states the portfolio pays in, and drawing them would show a smaller world than the one the engine priced. ${certificate.rows_untestable} constraint(s) could not be tested either. ${certificate.tier_note}`}
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
        ariaLabel="Payoff by settlement state: no state could be measured"
        missing={`No column is drawn: ${unreadable.join(", ") || "a leg"} could not be read, and a state whose payoff is unknown is not a state whose payoff is zero. ${certificate.rows_untestable} constraint(s) could not be tested. Fees would have been subtracted from every column had one been drawn.`}
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

  // Gross clearing the line is not the same claim as the trade being worth
  // putting on, and this figure draws the gross. Saying "pays in every state"
  // without the net beside it is how a reader walks away with the naive
  // reading the whole fee model exists to reject.
  // The sign is read off net_edge itself rather than off `worth_doing`, so the
  // sentence cannot end up claiming the opposite of the figure printed beside
  // it if those two ever disagree on the wire.
  const netEdge = toMicros(certificate.net_edge);
  const afterFees =
    netEdge == null
      ? ""
      : ` Fees take that to ${certificate.net_edge}, ${netEdge > 0 ? "still above the line" : "below the line: the violation is real and the fees price it out"}.`;
  const reading = agrees
    ? clears
      ? `Every column clears the zero line. The lowest is ${certificate.worst_case_payoff} — the worst-case payoff — so this portfolio pays in every state the engine could test.${afterFees}${certificate.because ? ` The engine's own reason: ${certificate.because}.` : ""}`
      : `The lowest column is ${certificate.worst_case_payoff} — the worst-case payoff — and it does not clear the zero line, so there is a state this portfolio does not win in.`
    : `The lowest column drawn is ${money(lowest)}, and the engine reports a worst-case payoff of ${certificate.worst_case_payoff ?? "—"}. Those are different numbers, so the dashed rule and the shortest bar are not the same claim here.`;

  const missing = [
    certificate.rows_untestable
      ? `${certificate.rows_untestable} constraint(s) could not be tested — a leg was unquoted — so the states behind them are not columns here: read this as the state space the engine could reach, never as the whole one.`
      : "No constraint went untested (rows_untestable is 0), so no state is absent for that reason — but these columns are still only the outcomes this family settles into.",
    fees == null
      ? `Fees are NOT drawn: total_fees came back as ${certificate.total_fees ?? "—"}, which this figure could not read at the exchange's precision, so every bar here is gross and nothing has been taken off it.`
      : `Fees are already subtracted: the dashed block at the top of each column is the ${certificate.total_fees} of total_fees, and the figure above each column is what is left once it comes off.`,
    unreadable.length
      ? `${unreadable.length} leg(s) could not be read — ${unreadable.join(", ")} — so every state they touch is drawn as a gap with a dash, never as zero.`
      : "",
    agrees
      ? ""
      : "The dashed rule sits at the engine's worst_case_payoff, not at the shortest bar drawn here.",
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

  return (
    <Figure
      caption={CAPTION}
      ariaLabel={`Payoff by settlement state: one column per outcome, ${measured}, each drawn against a zero line with total fees taken off the top and a dashed rule at the worst-case payoff`}
      reading={reading}
      missing={missing}
    >
      <Plot height={HEIGHT}>
        {(width) => {
          const inner = Math.max(1, width - MARGIN.left - MARGIN.right);
          const slot = inner / columns.length;
          const bar = Math.min(MAX_BAR, slot * 0.62);
          const zeroY = y(0);
          const labelY = HEIGHT - 12;
          const budget = Math.max(3, Math.floor(slot / 5.4));
          const gutter = width - MARGIN.right + 6;
          // Below this a seven-character figure over one column prints through
          // its neighbour. The numbers stay reachable in each column's title,
          // and the reading names the one that decides the verdict.
          const roomForFigures = slot >= 44;
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
                    .reduce((sum, prior) => sum + 14 + (prior.mark ? 16 : 0) + prior.text.length * 5.4, 0);
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
                const cx = MARGIN.left + slot * (index + 0.5);
                // A leg sits in the cost of EVERY state, so one unreadable leg
                // normally takes the whole figure to the empty state above.
                // This branch is what draws the difference the moment a state
                // exists whose payoff alone could not be read.
                if (column.gross == null) {
                  return (
                    <g key={`${index}-${column.label}`}>
                      <title>{`${column.label}: not measurable — a leg in this portfolio could not be read`}</title>
                      <text
                        x={cx}
                        y={(plotTop + plotBottom) / 2}
                        textAnchor="middle"
                        className="coh-ablation__value"
                      >
                        —
                      </text>
                      <text x={cx} y={labelY} textAnchor="middle" className="coh-ablation__label">
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
                    <title>
                      {`${column.label}: gross ${money(column.gross)}, fees ${certificate.total_fees ?? "not readable"}, net ${money(fees == null ? null : net)}`}
                    </title>
                    <rect
                      x={cx - bar / 2}
                      y={Math.min(grossY, zeroY)}
                      width={bar}
                      height={Math.max(0.6, Math.abs(zeroY - grossY))}
                      className="coh-ablation__bar"
                    />
                    {fees == null ? null : (
                      <rect
                        x={cx - bar / 2}
                        y={Math.min(grossY, netY)}
                        width={bar}
                        height={Math.max(0.6, Math.abs(netY - grossY))}
                        className="coh-ablation__bar is-naive"
                      />
                    )}
                    {roomForFigures ? (
                      <text
                        x={cx}
                        y={Math.max(MARGIN.top - 8, topY - 5)}
                        textAnchor="middle"
                        className="coh-ablation__value"
                      >
                        {money(fees == null ? column.gross : net)}
                      </text>
                    ) : null}
                    <text x={cx} y={labelY} textAnchor="middle" className="coh-ablation__label">
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
