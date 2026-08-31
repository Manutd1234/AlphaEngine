"use client";

/**
 * Routes the authoritative solver proof and the independent browser checks.
 *
 * The distinction is intentional: `constraintsOf(event)` is useful immediate
 * quote arithmetic, but its rows are not the state matrix solved by HiGHS.
 */

import type { CSSProperties } from "react";

import { constraintsOf, type ConstraintKind } from "@/lib/coherence/constraints";
import { fromCenticents } from "@/lib/coherence/fixed-point";
import type { CoherenceCertificate, CoherenceEventView } from "@/lib/coherence/types";

import Figure, { FigureEmpty } from "./Figure";
import SolverProofLoom from "./SolverProofLoom";

const KIND_WORD: Record<ConstraintKind, string> = {
  book: "Book spreads",
  ladder: "Adjacent strikes",
  partition: "Partition sum",
};

const money = (centicents: number | null): string => fromCenticents(centicents) ?? "—";

export type ConstraintLadderView = "proof" | "checks";

export default function ConstraintLadder({ event, certificate, view = "proof" }: {
  event: CoherenceEventView | null;
  certificate: CoherenceCertificate | null;
  /** Keep the solver derivation and browser-side quote checks addressable. */
  view?: ConstraintLadderView;
}) {
  if (view === "proof") {
    if (!certificate) {
      return (
        <Figure
          caption="Observation → solver system → decision boundary → verdict"
          ariaLabel="The selected family's solver certificate has not arrived"
          missing="The certificate endpoint has not supplied a solver run to inspect."
          reserveInteractionRow={false}
        >
          <FigureEmpty reason="Waiting for the selected family's solver certificate." busy />
        </Figure>
      );
    }
    return <SolverProofLoom certificate={certificate} event={event} />;
  }

  const caption = "Independent quote checks ranked against the zero boundary";
  if (!event) {
    return (
      <Figure
        caption={caption}
        ariaLabel="The selected family's quotes have not arrived"
        missing="The family list has not supplied the quotes these browser checks need."
        reserveInteractionRow={false}
      >
        <FigureEmpty reason="Waiting for the selected family and its quotes." busy />
      </Figure>
    );
  }

  const set = constraintsOf(event);
  const tested = set.tested;
  const skipped = set.untestable;
  const total = tested.length + skipped;

  if (!tested.length) {
    return (
      <Figure
        caption={caption}
        ariaLabel={`No independent quote check could be evaluated for ${event.event_ticker}`}
        missing={
          skipped
            ? `${skipped} checks need a quote side the venue did not publish: ${set.untestableReason}`
            : "This family contains no pair of quotes from which to derive a check."
        }
        reserveInteractionRow={false}
      >
        <FigureEmpty reason="There is no evaluable quote-side bound to rank." />
      </Figure>
    );
  }

  const tightest = tested[0];
  const violations = set.violations;
  const shown = tested.slice(0, 6);
  const maxMagnitude = Math.max(...shown.map((constraint) => Math.abs(constraint.slack)), 1);
  const kindSummary = (Object.entries(set.kinds) as Array<[ConstraintKind, number]>)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${count} ${KIND_WORD[kind].toLowerCase()}`)
    .join(", ");

  return (
    <Figure
      caption={caption}
      ariaLabel={
        `${tested.length} independent quote constraints for ${event.event_ticker}; `
        + `the tightest has ${money(tightest.slack)} of room and ${violations} cross zero`
      }
      reading={
        violations
          ? `${violations} browser-derived bound${violations === 1 ? "" : "s"} cross zero.`
          : `The tightest browser-derived bound has ${money(tightest.slack)} of room.`
      }
      missing={
        skipped
          ? `${skipped} of ${total} checks are absent because a required side was not quoted; they are skipped, never counted as passes.`
          : null
      }
      notes={[
        kindSummary ? `The evaluated set contains ${kindSummary}.` : "",
        certificate?.proof_evidence
          ? `These are browser-side quote checks. The solver proof separately reports ${certificate.proof_evidence.solver.state_rows ?? "—"} state rows.`
          : "The solver's structured row evidence has not arrived; these checks are not presented as its proof.",
        "Room is measured before fees. Positive stays on the safe side of zero; negative is a violated inequality.",
      ].filter(Boolean)}
      readout={<span className="num">{`${tested.length} checked; tightest ${money(tightest.slack)}`}</span>}
      reserveInteractionRow={false}
    >
      <div className="coh-proof-flow">
        <section className="coh-proof-rank" aria-labelledby="coh-proof-rank-heading">
          <header>
            <div>
              <span className="eyebrow">Binding edge</span>
              <h4 id="coh-proof-rank-heading">The six tightest independent checks</h4>
            </div>
            <span className="muted">zero is the decision boundary</span>
          </header>
          <ol>
            {shown.map((constraint, index) => {
              const width = Math.max(4, (Math.abs(constraint.slack) / maxMagnitude) * 50);
              return (
                <li key={`${constraint.kind}-${index}`} data-state={constraint.violated ? "flagged" : "holds"}>
                  <span className="coh-proof-rank__label">
                    <strong>{index + 1}. {KIND_WORD[constraint.kind]}</strong>
                    <span>{constraint.subject}</span>
                  </span>
                  <span className="coh-proof-rank__meter" aria-hidden="true">
                    <i style={{ "--constraint-room": `${width}%` } as CSSProperties} />
                  </span>
                  <span className="coh-proof-rank__value num">
                    <span aria-hidden="true">{constraint.violated ? "✕" : "●"}</span> {money(constraint.slack)}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>

        <details className="disclosure coh-proof-constraints">
          <summary>{`All ${tested.length} independent quote checks`}</summary>
          <div className="table-wrap" role="region" aria-label={`All ${tested.length} independent quote checks`} tabIndex={0}>
            <table className="coh-table">
              <caption className="coh-table__caption">
                Browser-derived quote constraints, ordered from the tightest bound outward.
              </caption>
              <thead>
                <tr><th scope="col">Constraint</th><th scope="col">Subject</th><th scope="col" className="num">Room</th><th scope="col">Result</th></tr>
              </thead>
              <tbody>
                {tested.map((constraint, index) => (
                  <tr key={`${constraint.kind}-${index}`}>
                    <th scope="row">{KIND_WORD[constraint.kind]}</th>
                    <td>{constraint.subject}</td>
                    <td className="num">{money(constraint.slack)}</td>
                    <td>{constraint.violated ? "✕ Violated" : "● Holds"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </Figure>
  );
}
