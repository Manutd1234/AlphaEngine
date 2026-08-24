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
import PayoffByState from "./PayoffByState";
import { statValue } from "./ReliabilityDiagram";
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
        title: `${leg.label || leg.ticker}: ${leg.direction} ${leg.size} at ${leg.price}, net fee ${leg.net_fee}`,
        noBar: statValue(leg.net_fee) == null ? "not readable" : undefined,
      }))}
    />
    <div className="table-wrap">
      <table className="coh-table">
        <caption className="coh-table__caption">
          At the exchange&rsquo;s own precision; the total row is the arithmetic the verdict is read off.
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

export default function PortfolioPane({ certificate, chosen }: {
  /** The section's own `certify` answer, already read and already cached. */
  certificate: CoherenceCertificate;
  /** The family being solved, for the state space the payoff figure prices. */
  chosen: CoherenceEventView | null;
}) {
  if (!certificate.legs.length) {
    return (
      <p className="console-empty">
        <span aria-hidden="true">◌</span> No portfolio — these quotes admit a probability, so the solver had nothing
        to hand back; Verdict carries the finding.
      </p>
    );
  }

  return (
    <>
      <p className="sub">
        Where no probability measure fits a family&rsquo;s prices, duality hands back the basket that wins in every
        state — so the certificate of infeasibility IS the trade.
      </p>

      {/* Gated on a mutually exclusive family because one state per market is
          the only state space this side can rebuild without re-deriving the
          strikes, and a state space guessed wrong draws a different world
          confidently. Without one the figure says which claim is therefore not
          drawn, and the leg table below still carries the portfolio. */}
      {chosen?.mutually_exclusive ? (
        <PayoffByState
          certificate={certificate}
          states={chosen.markets.map((market) => ({
            ticker: market.ticker,
            label: market.yes_sub_title || market.ticker,
          }))}
        />
      ) : (
        <p className="coh-figure__missing">
          <span aria-hidden="true">◌</span> No payoff figure: the family is not marked mutually exclusive, so there
          is no state space to price against. The legs below are the portfolio.
        </p>
      )}

      <details className="disclosure">
        <summary>Every leg through all three fee components, and what the basket comes to</summary>
        <LegTable certificate={certificate} />
      </details>
    </>
  );
}
