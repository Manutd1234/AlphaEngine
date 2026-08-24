"use client";

/**
 * The Dutch-book verdict and its proof, as two views of one `certify` answer.
 *
 * Split out of `CertificatePane` on 2026-08-24, when the consolidation folded
 * the parlays in and the section went to six views. The ceiling's own rule is
 * to SPLIT rather than shave prose, and the switcher is the seam the component
 * already had: everything here is a pure render over a payload the parent has
 * already read, holds no state, and asks the gateway for nothing.
 *
 * The verdict a reader will see almost every time is "coherent", and that is
 * the point rather than a disappointment: the engine is making a claim about
 * the market, and the claim is usually that its prices admit a probability. A
 * detector that only spoke when it found something would leave "no opportunity"
 * and "the feed is down" looking identical.
 *
 * The two `<Figure>`s the Verdict view drew on the morning of 2026-08-24 left
 * the same day: both required an INCOHERENT verdict, so in the common coherent
 * case both rendered `FigureEmpty` under a caption — an empty frame dressed as
 * a drawing — and the arithmetic became the six-row table below.
 *
 * A DRAWING WAS RE-ADDED LATER THAT DAY, and the reversal is deliberate: the
 * reader that rejection was guessing at asked, in his third review, for a
 * drawing of the numbers on every subtab. What returned is not what was
 * removed. `ValueStrip` draws the verdict's four money rows as signed bars
 * against a zero rule, and it shows honestly in the coherent case too — bars
 * sitting at or under zero ARE that verdict, not an empty frame. The proof view
 * draws its coverage the same way.
 *
 * REJECTED, still: redrawing `PayoffByState` under the verdict. It is one press
 * away on Certificate; drawn in both places the tab's headline claim would be
 * on screen twice with no way to tell which was the finding.
 */

import type { CoherenceCertificate } from "@/lib/coherence/types";
import { statValue } from "./ReliabilityDiagram";
import ValueStrip, { type StripRow } from "./ValueStrip";

export function verdictChip(certificate: CoherenceCertificate) {
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

/** One sentence for the verdict on screen. The chips carry the state; this says what it means. */
export function verdictReading(certificate: CoherenceCertificate): string {
  const because = certificate.because ? ` ${certificate.because}.` : "";
  if (certificate.verdict === "untestable") {
    return `This family could not be tested.${because}`;
  }
  if (certificate.verdict === "incoherent") {
    return `These quotes admit no probability measure; Certificate draws the basket that pays in every state.${because}`;
  }
  if (certificate.priced_out) {
    return "These quotes admit no probability measure and the fees remove the edge — two true readings, kept apart on purpose.";
  }
  return "No portfolio of these quotes pays more than it costs in every state, so a consistent probability measure exists.";
}

/**
 * The six quantities the verdict is read off, and what each one decides.
 *
 * A table rather than the paragraph that used to recite them, because the
 * reader's question is a comparison — is net still positive once fees come off
 * gross, and is the worst state above zero — and a comparison is what a column
 * is for. The third column is a fixed one-liner per row, so no number is
 * explained twice and none is left to be inferred from its name: "untestable"
 * in particular reads as a pass unless something says it is a skip.
 */
const ARITHMETIC: ReadonlyArray<{
  label: string;
  of: (certificate: CoherenceCertificate) => string;
  decides: string;
}> = [
  { label: "Gross edge", of: (c) => c.gross_edge ?? "—", decides: "Before any fee, from the closed-form checks." },
  { label: "Total fees", of: (c) => c.total_fees ?? "—", decides: "All three components, per fill, every leg." },
  { label: "Net edge", of: (c) => c.net_edge ?? "—", decides: "Gross minus fees. Only a positive one is a trade." },
  {
    label: "Worst-case payoff",
    of: (c) => c.worst_case_payoff ?? "—",
    decides: "The least this basket pays in any testable state.",
  },
  { label: "Constraints tested", of: (c) => String(c.rows_tested), decides: "Rows the solver evaluated." },
  {
    label: "Untestable",
    of: (c) => String(c.rows_untestable),
    decides: "A leg was unquoted, so the row was skipped, not passed.",
  },
];

/**
 * The verdict's four money rows as strip rows, fees entering NEGATIVE
 * because that is the side of the sum they sit on. `statValue` floats are
 * geometry only; every printed figure is the wire string itself.
 */
function moneyRows(certificate: CoherenceCertificate): StripRow[] {
  const row = (label: string, raw: string | null, subtracted = false): StripRow => {
    const value = statValue(raw);
    return {
      label,
      value: value == null ? null : subtracted ? -value : value,
      text: raw ?? "—",
      title: raw == null ? `${label}: not reported` : `${label}: ${raw}${subtracted ? ", subtracted" : ""}`,
      noBar: raw == null ? "not reported" : undefined,
    };
  };
  return [
    row("Gross edge", certificate.gross_edge),
    row("Total fees", certificate.total_fees, true),
    row("Net edge", certificate.net_edge),
    row("Worst-case payoff", certificate.worst_case_payoff),
  ];
}

export function VerdictView({ data, target }: { data: CoherenceCertificate; target: string }) {
  return (
    <>
      <ValueStrip
        caption="The verdict's money rows, signed, against the zero rule — fees enter negative"
        ariaLabel={`Gross edge, fees, net edge and worst-case payoff for ${data.family || target} on one signed axis`}
        rows={moneyRows(data)}
        missing="The two count rows are in the table behind the summary; a count is not an amount."
      />
      {/* THE TABLE MOVED BEHIND A SUMMARY on the fourth review of 2026-08-24
          ("use dropdowns, hide, summarise, remove but keep the details"), and
          what makes that safe is the strip above it: the four money rows are
          drawn, so the view's own question — is net still positive once fees
          come off gross, and is the worst state above zero — is answered
          without opening anything. What the table adds is the two COUNT rows
          the strip declines to draw and one fixed line per row saying what
          each quantity decides, which is method rather than finding. The
          summary names both, so nobody has to open it to learn whether it is
          worth opening. Nothing was removed. */}
      <details className="disclosure">
        <summary>What each of the six quantities decides, and the two counts, at the exchange&rsquo;s precision</summary>
      <div className="table-wrap">
        <table className="coh-table">
          <caption className="coh-table__caption">
            Scope {data.scope}; {data.tier_note}
          </caption>
          <thead>
            <tr>
              <th scope="col">Quantity</th>
              <th scope="col" className="num">Value</th>
              <th scope="col">What it decides</th>
            </tr>
          </thead>
          <tbody>
            {ARITHMETIC.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                <td className="num">{row.of(data)}</td>
                <td>{row.decides}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </details>
    </>
  );
}

export function ProofView({ data }: { data: CoherenceCertificate }) {
  return (
    <>
      <ValueStrip
        caption="What the proof covers: rows evaluated against rows skipped as unquotable"
        ariaLabel={`${data.rows_tested} constraints tested, ${data.rows_untestable} untestable`}
        rows={[
          {
            label: "Tested",
            value: data.rows_tested,
            text: String(data.rows_tested),
            title: `${data.rows_tested} constraint(s) the solver evaluated`,
          },
          {
            label: "Untestable",
            value: data.rows_untestable,
            text: String(data.rows_untestable),
            title: `${data.rows_untestable} row(s) skipped — a leg was unquoted`,
          },
        ]}
      />
      {data.proof ? (
        <pre className="coh-proof">{data.proof}</pre>
      ) : (
        <p className="console-empty">
          <span aria-hidden="true">◌</span> No proof was returned for this family.
        </p>
      )}
      {/* The proof text itself stays open — it is what the view is called and
          what it is for. The solver's notes are provenance about the run, so
          they take a summary that says how many there are; a reader deciding
          whether to open it should not have to open it to count them. */}
      {data.notes.length ? (
        <details className="disclosure">
          <summary>{`Notes the solver returned with this proof, ${data.notes.length}`}</summary>
          <ul className="coh-notes" aria-label="Notes returned with the proof">
            {data.notes.map((note, index) => (
              <li key={`${index}-${note}`}>{note}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}
