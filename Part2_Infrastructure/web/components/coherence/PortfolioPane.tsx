"use client";

/**
 * The basket the failure hands back, and what it pays in every state.
 *
 * This is the tab's headline claim. It was the middle view of a three-way `.seg`
 * inside the Dutch-book section until the promotion pass of 2026-08-24 made it a
 * rail of its own — not in the URL, not on the rail and never walked by
 * `desk-sweep.mjs` before that — and the merge later the same day made it two
 * views of that section again. What is different this time is the WIRING: it
 * draws no head, owns no read and owns no family picker. `CertificatePane` owns
 * all three and passes the answer down.
 *
 * That is not tidiness. Both halves solve the SAME family from the SAME
 * `certify` call, and while each owned its own `selected` state a reader who
 * chose a family on the verdict and pressed Payoff was silently handed the
 * first family in the list again. One picker, one target.
 *
 * THE TWO VIEWS BECAME ONE, AND THE LEG TABLE BECAME A DISCLOSURE — the
 * consolidation of 2026-08-24, reversing a split made that same morning. The
 * split was right about the two objects: `PayoffByState` shows the payoff in
 * EVERY state the family can settle into, because "wins in every state" is a
 * claim about a set and a table cannot show "every", while the leg table shows
 * what each leg costs after all three fee components and what the whole basket
 * comes to, because the figure cannot show eight columns of money per leg. One
 * answers "is it true", the other "check it by hand".
 *
 * What changed is the price of a segment. Dutch book carries six views now that
 * the parlays folded in, and a seventh would have made the switcher the loudest
 * object in the card — so the two share one view and the leg table sits behind
 * a `<details>` whose summary names what is inside it. The reader who came for
 * the claim meets the claim without scrolling past the fee columns, which is
 * what the morning's split was for ("every single one of these tabs are so
 * cluttered … i dont want to keep scrolling"); the reader checking it by hand
 * opens one disclosure. Nothing was removed.
 *
 * REJECTED: taking the verdict chips with it. They are the section's finding and
 * they are drawn above the switcher, where every view meets them exactly once.
 */

import type { CoherenceCertificate, CoherenceEventView } from "@/lib/coherence/types";
import BasketFootprint from "./BasketFootprint";
import Figure, { FigureEmpty } from "./Figure";
import ShortfallScale from "./ShortfallScale";
import { LinkedX } from "@/lib/coherence/linked-x";
import PayoffByState from "./PayoffByState";
import { statValue } from "@/lib/coherence/decimals";
import StateCoverage, { type CoverageState } from "./StateCoverage";
import ValueStrip from "./ValueStrip";

/**
 * The legs, and the three numbers the verdict is actually read off.
 *
 * `total_fees`, `worst_case_payoff` and `net_edge` were on the payload and on
 * screen nowhere: the table costed every leg and then stopped one row short of
 * the arithmetic that decides whether the basket is worth putting on. The
 * total row is that row. `.coh-table__total` was already in the stylesheet
 * waiting for it.
 *
 * The strip above the table draws its decisive column — the net fee each leg
 * pays — added 2026-08-24 on the reader's ask for a drawing of the numbers in
 * every view. Net fee and not price, because price x size is what the reader
 * CHOSE and the fee is what the venue did to it.
 */
function LegTable({ certificate }: { certificate: CoherenceCertificate }) {
  return (
    <>
    <ValueStrip
      caption="The net fee each leg pays, after rounding and rebate"
      ariaLabel={`Net fee per leg for ${certificate.legs.length} legs, against a zero rule`}
      rows={certificate.legs.map((leg) => ({
        label: leg.label || leg.ticker,
        value: statValue(leg.net_fee),
        text: leg.net_fee,
        // Direction, size, price and net fee are four VISIBLE columns of the
        // leg table below. The hover carries the one thing the bar cannot: why
        // this leg is in the basket at all.
        title: `${leg.direction === "buy" ? "bought" : "sold"} so the basket pays in every state`,
        noBar: statValue(leg.net_fee) == null ? "not readable" : undefined,
      }))}
    />
    <div className="table-wrap" tabIndex={0}>
      <table className="coh-table">
        <caption className="coh-table__caption">
          At the exchange&rsquo;s own precision.
        </caption>
        <thead>
          <tr>
            <th scope="col">Leg</th>
            <th scope="col">Side</th>
            <th scope="col" className="num">Size</th>
            <th scope="col" className="num">Price</th>
            <th scope="col" className="num">Trade fee</th>
            <th scope="col" className="num">Rounding</th>
            <th scope="col" className="num">Rebate</th>
            <th scope="col" className="num">Net fee</th>
          </tr>
        </thead>
        <tbody>
          {certificate.legs.map((leg) => (
            <tr key={`${leg.ticker}-${leg.direction}`}>
              <th scope="row">{leg.label}</th>
              <td>{leg.direction}</td>
              <td className="num">{leg.size}</td>
              <td className="num">{leg.price}</td>
              <td className="num">{leg.trade_fee}</td>
              <td className="num">{leg.rounding_fee}</td>
              <td className="num">{leg.rebate}</td>
              <td className="num">{leg.net_fee}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="coh-table__total">
            <th scope="row">All legs</th>
            <td colSpan={6}>
              Worst-case payoff {certificate.worst_case_payoff ?? "—"}, net edge after fees{" "}
              {certificate.net_edge ?? "—"}
            </td>
            <td className="num">{certificate.total_fees ?? "—"}</td>
          </tr>
        </tfoot>
      </table>
    </div>
    </>
  );
}

/**
 * Which of the section's three questions is showing.
 *
 * Declared here rather than in `BasketSection` because the section imports the
 * pane: the same direction `CombosPane` and `CombosSection` already run in.
 */
export type BasketViewId = "cover" | "basket" | "size";

/**
 * What buying the cover COSTS — the question that is drawable on every read.
 *
 * It needs the quotes and not the certificate, which is why this is the view
 * the section opens on: a 188-strike family takes seconds to certify, and this
 * has something to say the whole time. `BasketWhatIf` sits above it, mounted
 * by the section so it is not gated on an answer this pane cannot draw
 * without.
 */
export function CoverView({ certificate, states, exact }: {
  certificate: CoherenceCertificate;
  states: CoverageState[];
  exact: boolean;
}) {
  return (
    <div className="coh-grid coh-grid--2">
      {/* NOT `MarginAxis`, which stays on the Coherence test's verdict view
          where it answers a yes/no beside the check ladder. Here the question
          is HOW FAR, and on the ordinary answer — no basket, because the
          family is coherent — a linear axis puts the optimum, the threshold
          and zero on one pixel. */}
      <ShortfallScale
        margin={certificate.margin}
        verdict={certificate.verdict}
        engine={certificate.engine}
      />
      {/* What a cover would have to COVER, which is a property of the family
          and therefore exists whether or not a portfolio does. */}
      <StateCoverage certificate={certificate} states={states} exact={exact} />
    </div>
  );
}

/**
 * The portfolio the test handed back, state by state.
 *
 * HONESTLY EMPTY ON THE ORDINARY ANSWER, and it names which answer that is.
 * The exchange is almost always coherent, so the solver almost always hands
 * back nothing — and an empty frame that does not say "coherent" is
 * indistinguishable from a feed that failed. That distinction is the whole
 * argument this tab makes.
 */
export function BasketView({ certificate, states, exact }: {
  certificate: CoherenceCertificate;
  states: CoverageState[];
  exact: boolean;
}) {
  if (!certificate.legs.length) {
    return (
      <Figure
        caption="What the portfolio pays in each state this family can settle into"
        ariaLabel="No portfolio was returned for this family"
        missing={
          `Coherent — the programme's optimum is ${certificate.margin ?? "not reported"}, so no portfolio of these`
          + " quotes pays more than it costs in every state. Cover shows how far the best available one fell short."
        }
      >
        <FigureEmpty reason="Coherent — no portfolio to hold." />
      </Figure>
    );
  }

  return (
    <>
      {/* ONE CROSSHAIR OVER BOTH: the payoff columns and the coverage blocks
          are the same states in the same order, so a pointer on either draws
          the state on both. */}
      <LinkedX>
      {/* Gated on a mutually exclusive family because one state per market is
          the only state space this side can rebuild without re-deriving the
          strikes, and a state space guessed wrong draws a different world
          confidently. */}
      {exact ? (
        <PayoffByState certificate={certificate} states={states} />
      ) : (
        <p className="coh-figure__missing">
          <span aria-hidden="true">◌</span> No payoff figure: the family is not marked mutually exclusive, so there
          is no state space to price against.
        </p>
      )}

      {/* WHICH states the basket touches, under what it PAYS in them. The
          payoff figure needs legs, prices and sizes and is absent whenever any
          of the three cannot be read; this one needs only the tickers, so it
          still draws on exactly the reads where the figure above cannot. */}
      <StateCoverage certificate={certificate} states={states} exact={exact} link="basket-states" />
      </LinkedX>

      <details className="disclosure">
        <summary>Every leg through all three fee components, and what the basket comes to</summary>
        <LegTable certificate={certificate} />
      </details>
    </>
  );
}

/**
 * Whether the basket can be put on — the question the section never asked.
 *
 * Three views drew what the portfolio PAYS and none asked whether it could be
 * bought. A basket needing four times the open interest of one leg is a
 * certificate and not a trade, and the figures that said so were on the wire
 * the whole time.
 */
export function SizeView({ certificate, chosen }: {
  certificate: CoherenceCertificate;
  chosen: CoherenceEventView | null;
}) {
  if (!certificate.legs.length) {
    return (
      <Figure
        caption="What the basket needs, against what is outstanding at each leg"
        ariaLabel="No portfolio was returned, so there is nothing to size"
        missing={
          "Coherent — no portfolio was returned, so there is no size to check. Cover shows how far the best"
          + " available basket fell short."
        }
      >
        <FigureEmpty reason="Coherent — no basket to size." />
      </Figure>
    );
  }
  return <BasketFootprint certificate={certificate} event={chosen} />;
}

export default function PortfolioPane({ certificate, chosen, view }: {
  /** The section's own `certify` answer, already read and already cached. */
  certificate: CoherenceCertificate;
  /** The family being solved, for the state space the payoff figure prices. */
  chosen: CoherenceEventView | null;
  /** Which of the section's three questions is showing. */
  view: BasketViewId;
}) {
  // The state space, read once for both branches. It comes off the universe
  // read the console already holds, so neither branch fetches anything, and it
  // is EXACT only where the venue marks the family mutually exclusive — one
  // market, one state, the payoff matrix the identity.
  const states: CoverageState[] = (chosen?.markets ?? []).map((market) => ({
    ticker: market.ticker,
    label: market.yes_sub_title || market.ticker,
  }));
  const exact = Boolean(chosen?.mutually_exclusive);

  // ONE DISPATCH, and the state space above is computed once for all three:
  // rebuilding it per view is how two views come to disagree about whether a
  // covering is exact.
  if (view === "basket") return <BasketView certificate={certificate} states={states} exact={exact} />;
  if (view === "size") return <SizeView certificate={certificate} chosen={chosen} />;
  return <CoverView certificate={certificate} states={states} exact={exact} />;
}
