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
 */

import { useState } from "react";

import type { CoherenceCertificate, CoherenceEventView } from "@/lib/coherence/types";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import DollarBar from "./DollarBar";
import Figure, { FigureEmpty, StateChip } from "./Figure";

function verdictChip(certificate: CoherenceCertificate) {
  if (certificate.verdict === "incoherent") {
    return certificate.worth_doing
      ? { mark: "▲", word: "Dutch book, net of fees", tone: "critical" as const }
      : { mark: "▲", word: "Violated, but the fees eat it", tone: "warn" as const };
  }
  if (certificate.verdict === "untestable") {
    return { mark: "◌", word: "Not testable", tone: "muted" as const };
  }
  return { mark: "●", word: "Coherent", tone: "good" as const };
}

function LegTable({ certificate }: { certificate: CoherenceCertificate }) {
  return (
    <div className="table-wrap">
      <table className="coh-table">
        <caption className="coh-table__caption">
          The portfolio, and what each leg costs after all three fee components
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
  const target = selected ?? events[0]?.event_ticker ?? "";
  const { data, error } = useCoherenceRead<CoherenceCertificate>(
    `/api/gateway/coherence/certify?event_ticker=${encodeURIComponent(target)}`,
    active && Boolean(target),
  );

  if (!events.length) {
    return (
      <p className="console-empty">
        <span aria-hidden="true">◌</span> Nothing to test yet — the Universe section reads the families this engine
        prices, and none has been read.
      </p>
    );
  }

  const chosen = events.find((event) => event.event_ticker === target) ?? events[0];

  return (
    <div className="coh-certificate">
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

          {data.verdict === "coherent" ? (
            <Figure
              caption="What the test found"
              ariaLabel="This family's prices are coherent"
              reading={`No portfolio of these quotes pays more than it costs in every state, so a probability measure consistent with all of them exists. ${data.rows_tested} state(s) were checked by the ${data.engine === "highs" ? "linear programme" : "closed-form checks"}.`}
              missing={data.rows_untestable ? `${data.rows_untestable} constraint(s) could not be tested: a leg was unquoted.` : null}
            >
              <FigureEmpty reason="Nothing to draw — there is no violating portfolio." />
            </Figure>
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

          {data.legs.length ? <LegTable certificate={data} /> : null}

          <details className="coh-lesson__mechanics" open>
            <summary>The proof, as a reader checks it</summary>
            <pre className="coh-proof">{data.proof}</pre>
          </details>

          {data.notes.length ? (
            <ul className="coh-notes">
              {data.notes.map((note, index) => (
                <li key={`${index}-${note}`}>{note}</li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </div>
  );
}
