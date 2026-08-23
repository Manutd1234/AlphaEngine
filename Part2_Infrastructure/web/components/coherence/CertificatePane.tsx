"use client";

/**
 * The coherence test, and the proof it produces either way.
 *
 * The verdict a reader will see almost every time is "coherent", and that is
 * the point rather than a disappointment: the engine is making a claim about
 * the market, and the claim is usually that its prices admit a probability. A
 * detector that only spoke when it found something would leave "no opportunity"
 * and "the feed is down" looking identical.
 *
 * When it does find one, the whole argument is on screen — the portfolio, the
 * payoff in the worst state, every fee component, and the legging tier — in a
 * fixed-width block a reader can check by hand or paste somewhere else. A
 * number saying "arbitrage, 3.2 cents" is not evidence.
 *
 * Three views, because that fixed-width block is unbounded: it is as long as
 * the family is wide, it never wraps, and everything under it used to be
 * scrolled past rather than read. Verdict is what the test found, Portfolio is
 * the legs and the totals the verdict is computed from, Proof is the block
 * itself and the notes.
 *
 * The family picker, the chip row and the error states stay OUTSIDE the
 * switcher: every view is read relative to that chip row, and the row also
 * separates the two segmented controls so they do not read as one stacked
 * pair. The single `certify` read feeds all three views — it is a 25s gateway
 * call behind a 28s browser deadline — so it is gated on `active` and a chosen
 * family only, never on which view is showing, and a view switch must not
 * remount it.
 */

import { useState } from "react";

import type { CoherenceCertificate, CoherenceEventView } from "@/lib/coherence/types";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import DollarBar from "./DollarBar";
import Figure, { FigureEmpty, StateChip } from "./Figure";
import PayoffByState from "./PayoffByState";

function verdictChip(certificate: CoherenceCertificate) {
  if (certificate.verdict === "incoherent") {
    return certificate.worth_doing
      ? { mark: "▲", word: "Dutch book, net of fees", tone: "critical" as const }
      : { mark: "▲", word: "Violated, but the fees eat it", tone: "warn" as const };
  }
  if (certificate.verdict === "untestable") {
    return { mark: "◌", word: "Not testable", tone: "muted" as const };
  }
  // The solver found no portfolio worth putting on, but the closed-form
  // checks found prices that admit no probability measure. Both are true and
  // they are different claims, so this does not render as "Coherent".
  if (certificate.priced_out) {
    return { mark: "▲", word: "Incoherent, but priced out by fees", tone: "warn" as const };
  }
  return { mark: "●", word: "Coherent", tone: "good" as const };
}

/**
 * The legs, and the three numbers the verdict is actually read off.
 *
 * `total_fees`, `worst_case_payoff` and `net_edge` were on the payload and on
 * screen nowhere: the table costed every leg and then stopped one row short of
 * the arithmetic that decides whether the basket is worth putting on. The
 * total row is that row. `.coh-table__total` was already in the stylesheet
 * waiting for it.
 */
function LegTable({ certificate }: { certificate: CoherenceCertificate }) {
  return (
    <div className="table-wrap">
      <table className="coh-table">
        <caption className="coh-table__caption">
          The portfolio, what each leg costs after all three fee components, and what the whole
          basket comes to
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
  );
}

export default function CertificatePane({
  events,
  active,
}: {
  events: CoherenceEventView[];
  active: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"verdict" | "portfolio" | "proof">("verdict");
  const target = selected ?? events[0]?.event_ticker ?? "";
  const { data, error } = useCoherenceRead<CoherenceCertificate>(
    `/api/gateway/coherence/certify?event_ticker=${encodeURIComponent(target)}`,
    active && Boolean(target),
  );

  if (!events.length) {
    return (
      <p className="console-empty">
        <span aria-hidden="true">◌</span> Nothing to test yet — the Universe section reads the
        families this engine prices; none has been read.
      </p>
    );
  }

  const chosen = events.find((event) => event.event_ticker === target) ?? events[0];

  return (
    <div className="coh-certificate">
      <div className="coh-certificate__pick">
        <span className="muted">Family</span>
        <div className="seg coh-books__picker" role="group" aria-label="Choose a family to test">
          {events.map((event) => (
            <button
              key={event.event_ticker}
              type="button"
              aria-pressed={event.event_ticker === target}
              onClick={() => setSelected(event.event_ticker)}
            >
              {event.event_ticker}
            </button>
          ))}
        </div>
      </div>

      {error && !data ? (
        <p className="console-empty">
          <span aria-hidden="true">✕</span> The test could not be run: {error}
        </p>
      ) : !data ? (
        <p className="console-empty muted">Testing this family…</p>
      ) : (
        <>
          <div className="coh-status__chips">
            <StateChip {...verdictChip(data)} value={data.net_edge} />
            <StateChip
              mark="◇"
              word={data.engine === "highs" ? "Linear programme" : "Closed-form checks"}
              value={`${data.rows_tested} tested`}
              tone="muted"
            />
            <StateChip mark="→" word={`Legging tier ${data.tier}`} tone={data.tier > 2 ? "warn" : "muted"} />
          </div>

          <div className="seg" role="group" aria-label="Certificate view">
            <button type="button" aria-pressed={view === "verdict"} onClick={() => setView("verdict")}>
              Verdict
            </button>
            <button type="button" aria-pressed={view === "portfolio"} onClick={() => setView("portfolio")}>
              Portfolio
            </button>
            <button type="button" aria-pressed={view === "proof"} onClick={() => setView("proof")}>
              Proof
            </button>
          </div>

          {view === "portfolio" ? (
            <>
              <h4>Portfolio</h4>
              {data.legs.length ? (
                <LegTable certificate={data} />
              ) : (
                <p className="console-empty">
                  <span aria-hidden="true">◌</span> No legs to cost: this test returned no portfolio.
                </p>
              )}
            </>
          ) : view === "proof" ? (
            <>
              <h4>The proof, as a reader checks it</h4>
              {data.proof ? (
                <pre className="coh-proof">{data.proof}</pre>
              ) : (
                <p className="console-empty">
                  <span aria-hidden="true">◌</span> No proof was returned for this family.
                </p>
              )}

              {data.notes.length ? (
                <>
                  <h4 id="coh-certificate-notes">What the test noted alongside the proof</h4>
                  <ul className="coh-notes" aria-labelledby="coh-certificate-notes">
                    {data.notes.map((note, index) => (
                      <li key={`${index}-${note}`}>{note}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </>
          ) : (
            <>
              <h4>Verdict</h4>

              {data.verdict === "coherent" && data.priced_out ? (
                <Figure
                  caption="What the test found"
                  ariaLabel="These prices are incoherent, and the fees remove the edge"
                  reading={`These quotes admit no probability measure — the closed-form checks found ${data.gross_edge ?? "—"} gross, the three fee components leave ${data.net_edge ?? "—"} net, and the programme found no portfolio worth putting on. Both readings are correct: the prices are wrong and the trade is not there, and this engine exists to keep those apart.`}
                >
                  <FigureEmpty reason="Nothing to draw — the violating portfolio loses money once fees are charged." />
                </Figure>
              ) : null}

              {data.verdict === "coherent" && !data.priced_out ? (
                <Figure
                  caption="What the test found"
                  ariaLabel="This family's prices are coherent"
                  reading="No portfolio of these quotes pays more than it costs in every state, so a probability measure consistent with all of them exists."
                >
                  <FigureEmpty reason="Nothing to draw — there is no violating portfolio." />
                </Figure>
              ) : null}

              {/* The tab's headline claim, drawn. Both figures above require a
                  COHERENT verdict, so the one verdict that actually asserts
                  "wins in every state" drew nothing at all and left the winning
                  portfolio as a table — and a table cannot show "every". Gated
                  on a mutually exclusive family because one state per market is
                  the only state space this side can rebuild without re-deriving
                  the strikes, and a state space guessed wrong draws a different
                  world confidently. A family without one keeps the note below. */}
              {data.verdict === "incoherent" && data.legs.length > 0 && chosen?.mutually_exclusive ? (
                <PayoffByState
                  certificate={data}
                  states={chosen.markets.map((market) => ({
                    ticker: market.ticker,
                    label: market.yes_sub_title || market.ticker,
                  }))}
                />
              ) : null}

              {chosen?.mutually_exclusive ? (
                <DollarBar
                  legs={chosen.markets.map((market) => ({
                    label: market.yes_sub_title || market.ticker,
                    price: market.yes_ask,
                  }))}
                  direction="buy"
                  caption="What a guaranteed $1 costs in this family right now"
                />
              ) : null}

              {/* Hoisted out of the two coherent-branch figures. It used to be
                  a `missing` line on each of them, so on an incoherent verdict
                  — the one case where an untested constraint most changes what
                  the finding is worth — the count was never shown at all. */}
              {data.rows_untestable ? (
                <p className="coh-figure__missing">
                  <span aria-hidden="true">◌</span> {data.rows_untestable} constraint(s) could not be
                  tested: a leg was unquoted.
                </p>
              ) : null}

              {data.verdict !== "coherent" && !chosen?.mutually_exclusive ? (
                <p className="console-empty">
                  <span aria-hidden="true">◌</span> Nothing is drawn here: this family is not
                  mutually exclusive, so there is no guaranteed dollar to price it against. The chips
                  above are the finding; the Portfolio and Proof views are the argument for it.
                </p>
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  );
}
