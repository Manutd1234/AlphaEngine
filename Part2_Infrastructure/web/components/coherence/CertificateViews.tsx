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

import type { CoherenceCertificate, CoherenceEventView } from "@/lib/coherence/types";
export { verdictChip } from "./certificate-verdict";
import { statValue } from "@/lib/coherence/decimals";
import CheckLadder from "./CheckLadder";
import ConstraintLadder from "./ConstraintLadder";
import MarginAxis from "./MarginAxis";
import ValueStrip, { type StripRow } from "./ValueStrip";

/**
 * What the drawings below cannot say, and nothing else. Empty when they say it all.
 *
 * IT USED TO RESTATE `MarginAxis`. On the ordinary answer this returned "No
 * portfolio of these quotes pays more than it costs in every state, so a
 * consistent probability measure exists" — and the axis three elements below it
 * reads "Nothing clears the line … so a consistent probability measure exists",
 * under the figure that measures exactly that. One claim, twice, on one screen,
 * which is the shape `copy-audit` is for.
 *
 * So the coherent branch is now the gateway's own `because` or nothing at all,
 * and the caller renders no paragraph when there is nothing to put in it. What
 * survives is the three cases the figures genuinely cannot carry: a test that
 * did not run, the pointer to where the basket is drawn, and the two-readings
 * distinction a single verdict word flattens.
 */
export function verdictReading(certificate: CoherenceCertificate): string {
  const because = certificate.because ? `${certificate.because}.` : "";
  if (certificate.verdict === "untestable") {
    return `This family could not be tested. ${because}`.trim();
  }
  if (certificate.priced_out) {
    return `These quotes admit no probability measure and the fees remove the edge — two true readings, kept apart on purpose. ${because}`.trim();
  }
  if (certificate.verdict === "incoherent") {
    return `Basket draws the portfolio that pays whatever settles. ${because}`.trim();
  }
  // NOTHING on the ordinary answer. The gateway's own `because` for a coherent
  // family reads "no portfolio of these quotes pays more than it costs in every
  // state, so a probability measure consistent with all of them exists" — which
  // is `MarginAxis`'s reading in the gateway's words, three elements below it.
  // Measured on the live feed, not reasoned about: both sentences were on one
  // screen. It is not lost — `CheckLadder` carries it as a note under the figure
  // whose subject is how the verdict was reached.
  return "";
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
  { label: "Gross edge", of: (c) => c.gross_edge ?? "—", decides: "From the closed-form checks, before any fee." },
  { label: "Total fees", of: (c) => c.total_fees ?? "—", decides: "All three components, per fill, every leg." },
  // "Gross minus fees" went on 2026-08-25: the strip above draws gross, then
  // fees entering negative, then net, so the subtraction is the picture. What
  // is left is the decision the number carries, which no bar can say.
  { label: "Net edge", of: (c) => c.net_edge ?? "—", decides: "Only a positive one is a trade." },
  {
    label: "Worst-case payoff",
    of: (c) => c.worst_case_payoff ?? "—",
    decides: "The least this basket pays in any testable state.",
  },
  // No third column on this row. "Rows the solver evaluated" is the row's own
  // label in different words, which is the shape `copy-audit` calls a note
  // repeating the figure beside it.
  { label: "Constraints tested", of: (c) => String(c.rows_tested), decides: "" },
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
      // The bar prints its own label and value, so the hover adds only what the
      // drawing cannot show: which side of the sum this row sits on.
      title: raw == null
        ? `${label} was not reported`
        : subtracted ? `${label}, subtracted from the gross` : `${label}`,
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
  const money = moneyRows(data);
  // Every one of the four describes a portfolio, so on the common answer — no
  // portfolio exists — all four are correctly absent. Drawing an axis of four
  // dashes is what made this view read as broken.
  const anyMoney = money.some((row) => row.value != null);

  return (
    <>
      {/* THE LEAD IS THE MARGIN, not the money. What the programme decided on
          is its own optimum, which exists on every solve; the money rows are
          the arithmetic of a portfolio that usually does not exist. Leading
          with them meant the headline figure of the headline view said
          "not reported" four times on the answer a reader sees almost every
          time.

          PAIRED WITH THE LADDER since 2026-08-25, and the pairing is the
          point rather than the packing: the axis says WHERE the optimum
          landed and the ladder says HOW it was reached, so a reader meets
          the answer and its derivation in one glance instead of scrolling
          between them. Both exist on every solve, which is why these two are
          the pair and the money strip below is not. */}
      <div className="coh-figpair">
        <MarginAxis margin={data.margin} verdict={data.verdict} engine={data.engine} pricedOut={Boolean(data.priced_out)} />
        <CheckLadder certificate={data} />
      </div>

      {anyMoney ? (
        <ValueStrip
          caption="The portfolio's money rows, signed, against the zero rule — fees enter negative"
          ariaLabel={`Gross edge, fees, net edge and worst-case payoff for ${data.family || target} on one signed axis`}
          rows={money}
          missing="The two count rows decline a bar: a count is not an amount."
        />
      ) : null}
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

/**
 * What the solver concluded, as labelled facts rather than as a wall of text.
 *
 * The fixed-width block stays — it is what the view is called and it is what a
 * reader pastes elsewhere — but it stopped being the first thing on the view.
 * Six facts a reader wants at a glance were reachable only by reading five
 * lines of monospace prose for them, and four of the six are already typed
 * fields on the payload rather than substrings of that string.
 */
const CONCLUSIONS: ReadonlyArray<{ label: string; of: (data: CoherenceCertificate) => string }> = [
  { label: "Verdict", of: (data) => data.verdict },
  { label: "Solver", of: (data) => (data.engine === "highs" ? "linear programme (HiGHS)" : data.engine) },
  { label: "Rows tested", of: (data) => `${data.rows_tested}` },
  { label: "Rows untestable", of: (data) => `${data.rows_untestable}` },
  { label: "Best worst-case payoff", of: (data) => data.worst_case_payoff ?? data.margin ?? "—" },
  { label: "Legging tier", of: (data) => `${data.tier}, ${data.scope}` },
];

export function ProofView({ data, event }: {
  data: CoherenceCertificate;
  /**
   * The family's own quotes, off the universe read the section already holds.
   *
   * The proof is ABOUT these, and until 2026-08-26 the view drew none of them:
   * its only figure was a two-row strip of the certificate's own row counts.
   * Null while the universe read is in flight, which the figure reports rather
   * than waiting on.
   */
  event: CoherenceEventView | null;
}) {
  return (
    <>
      <ConstraintLadder event={event} certificate={data} />

      <div className="table-wrap">
        <table className="coh-table">
          <caption className="coh-table__caption">
            What the solver concluded, and the shape of the run it concluded it from.
          </caption>
          <thead>
            <tr>
              <th scope="col">Reading</th>
              <th scope="col" className="num">Value</th>
            </tr>
          </thead>
          <tbody>
            {CONCLUSIONS.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                <td className="num">{row.of(data)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.proof ? (
        <details className="disclosure">
          <summary>{`The solver's own words, ${data.proof.split("\n").length} lines`}</summary>
          <pre className="coh-proof">{data.proof}</pre>
        </details>
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
          <summary>{`What the solver had to assume to reach this verdict, ${data.notes.length}`}</summary>
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
