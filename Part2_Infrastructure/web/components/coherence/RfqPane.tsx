"use client";

/**
 * What the makers disagree about, where the public book shows nothing.
 *
 * A book publishes one number, the best bid, and that is the most aggressive
 * opinion on it rather than the typical one. For a combo there is usually no book
 * at all. The request-for-quote channel is the one place the venue exposes
 * several professionals pricing the same joint probability independently, and the
 * spread between their answers is a quantity nothing else here can produce.
 *
 * TWO VIEWS OF BOOKS AGAIN as of 2026-08-24, after a few hours as a rail
 * section. What that promotion fixed and the merge keeps is the HEADING: this
 * pane used to open with a bare `<h4 className="coh-event__title">Maker
 * dispersion</h4>`, four rungs below every other head on the desk — the exact
 * defect `panel-heading-rung.test.ts` and `PaneHead` exist for. It draws no
 * heading at all now. `BooksSection` draws the one head the section has, which
 * is the rule `coherence-pane-head.test.ts` holds, and the sentence that was
 * this pane's lede leads the two views instead.
 *
 * THE CHANNEL STATES ARE A TABLE NOW, and that is the point of this rewrite. They
 * were four two-paragraph explanations, one rendered at a time, seventy lines of
 * prose that between them said one thing four ways: a channel that could not be
 * read and a channel with nothing on it are different facts. A reader met
 * whichever paragraph their deployment produced and could not see the other
 * three, so the distinction the prose was defending was invisible exactly when it
 * mattered. Four rows of one bordered table show all four AND mark which one this
 * read is, in less vertical space than any single paragraph took. Since the
 * second 2026-08-24 pass that table is the CHANNEL view rather than a block
 * above the quotes: two tables about two subjects were still one stacked
 * column, and the reader after a number met the epistemology first every time.
 *
 * The distinctions themselves are unchanged and none may be dropped:
 *
 *   - `signing_unavailable` — nothing was asked. No key, or no signing library.
 *     That is NO VIEW of the channel: a fact about this deployment, not about the
 *     market.
 *   - `refused` — the request was signed and the venue said no. The channel
 *     answered, which is stronger than silence.
 *   - `empty` — the read succeeded and there is nothing on it. Makers do not
 *     quote a sandbox, so on demo this is the expected state and it is a
 *     measurement, not an absence.
 *   - `available` — quotes in hand.
 *
 * An additional state — the gateway saying something this pane has not been taught —
 * gets its own row rather than being folded into the nearest of the four.
 *
 * Two quantities in the dispersion table are routinely conflated and are kept
 * apart: `spread` is the disagreement BETWEEN makers, `median_width` is one
 * maker's own bid-offer. A wide panel of tight makers and a tight panel of wide
 * makers are opposite situations and would read identically if either number
 * stood alone. That is one clause of the caption now; it used to be a sentence in
 * the caption and again in a closing paragraph.
 *
 * BOTH VIEWS FOLD THEIR TABLE since the fourth 2026-08-24 pass ("hide,
 * summarise, but keep the details"). Each view now shows its drawing and
 * nothing else until asked: the twelve-column dispersion table is per-row
 * detail behind the strips that rank it, and the four-state table is the
 * `ChannelStates` diagram again in words, minus the one column the diagram
 * cannot carry. Neither summary is a bare "Details" — each names what is
 * inside and counts it, because a fold a reader cannot predict is a fold they
 * open every time.
 *
 * THE QUOTES VIEW LEADS WITH A DRAWING since the third 2026-08-24 pass
 * ("some tabs inside have no diagrams"): this was the one view on the
 * whole engine that was tables end to end. `DispersionStrips` draws each panel's lowest-to-highest
 * range on one shared dollar axis — the section's own question, ranked by eye —
 * and it renders only when there are rows, so an empty private channel gets a
 * connection state and outcome map rather than a fabricated dispersion plot.
 */

import { type ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { CoherenceRfqPanel } from "@/lib/coherence/types-lab";
import { rfqRoute } from "@/lib/coherence/routes";
import { measuredOpenRequests } from "@/lib/coherence/rfq-measurements";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import { useLiveSeries } from "@/lib/coherence/use-live-series";
import LiveTape from "./LiveTape";
import ChannelStates from "./ChannelStates";
import DispersionTable, { THIN_PANEL } from "./DispersionTable";
import KpiRow, { type Reading } from "./KpiRow";
import DispersionStrips from "./DispersionStrips";
import ProofsTransportNotice from "./ProofsTransportNotice";

/** The section's two subjects since the second 2026-08-24 pass: the quotes
 *  themselves, and the channel that did or did not carry them. They were
 *  stacked — the four-state table above the twelve-column dispersion table —
 *  which put a reader through the epistemology every time they wanted a
 *  number. Quotes is the default because it answers the section's headline
 *  question; the Channel view is where a no-answer explains itself. */
export type RfqView = "quotes" | "channel";

/**
 * The answers the channel can give, as data rather than as rendering branches.
 *
 * `not` is the load-bearing column. Every one of these would be reported as
 * "no data" by a panel that only tracked whether it had quotes, and three of the
 * four are then indistinguishable from the fourth — which is the failure this
 * whole pane exists to prevent.
 */
const STATES: ReadonlyArray<{ state: string; mark: string; word: string; means: string; not: string }> = [
  {
    state: "signing_unavailable",
    mark: "⚙",
    word: "Private channel setup",
    means: "The gateway needs its demo key id and private-key path.",
    not: "Not an empty market. Public market reads remain live.",
  },
  {
    state: "unavailable",
    mark: "⊘",
    word: "Channel offline",
    means: "The gateway could not complete the private read.",
    not: "Not an empty panel, and not a venue refusal.",
  },
  {
    state: "refused",
    mark: "✕",
    word: "Credentials refused",
    means: "The venue said no.",
    not: "Not silence. The same key will be refused again.",
  },
  {
    state: "empty",
    mark: "◌",
    word: "Authenticated read, no RFQs",
    means: "The signed HTTP poll completed with zero open requests.",
    not: "Not a websocket subscription and not a failed read. Demo makers usually do not quote a sandbox.",
  },
  {
    state: "available",
    mark: "●",
    word: "Authenticated read, quotes present",
    means: "The signed HTTP poll returned quotes.",
    not: "Not a persistent connection or one price. Several makers answered independently.",
  },
];

/**
 * The two measurable counts a reader wants before any drawing.
 *
 * The state always answers. Counts appear only after a completed private read;
 * setup and transport states do not manufacture zeros from a list never read.
 */
function channelReadings(panel: CoherenceRfqPanel): Reading[] {
  const panels = panel.dispersions.length;
  const thin = panel.dispersions.filter((row) => row.thin).length;
  const openRequests = measuredOpenRequests(panel);
  if (openRequests == null) return [];
  return [
    { label: "Open requests", value: String(openRequests), note: openRequests === 0 ? "live read completed" : undefined },
    {
      label: "Maker panels",
      value: `${panels} ${panels === 1 ? "market" : "markets"}`,
      note: thin ? <><span aria-hidden="true">▲</span> {thin} thin, under {THIN_PANEL} makers</> : undefined,
    },
  ];
}

function ChannelNotice({ panel, onRetry }: { panel: CoherenceRfqPanel; onRetry: () => void }) {
  const fault = panel.state === "unavailable" || panel.state === "refused";
  const title = panel.state === "signing_unavailable"
    ? "Connect the private maker channel"
    : panel.state === "empty"
      ? "Private maker read completed; no RFQs"
      : panel.state === "available"
        ? "Private maker read completed with quotes"
        : panel.state === "refused"
          ? "Private-channel credentials were refused"
          : "Private maker channel is temporarily offline";
  return (
    <Alert
      role={fault ? "alert" : "status"}
      variant={fault ? "destructive" : "default"}
      className="coh-rfq__connection"
      data-state={panel.state}
    >
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>The gateway says: {panel.detail}</p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Check channel now
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/** Every known outcome, with this read's own marked. */
function StateTable({ panel }: { panel: CoherenceRfqPanel }) {
  const known = STATES.some((row) => row.state === panel.state);
  /* An untaught state gets one additional row, so the count in the summary is
     computed rather than written down — a summary that says "4 rows" over five
     is the kind of small lie that costs a guard its credibility. */
  const rows = known ? STATES.length : STATES.length + 1;
  return (
    <div className="coh-rfq__state">
      {/* FOLDED on the fourth pass of 2026-08-24. `ChannelStates` above draws
          the same alternative answers as branches and marks the one this read got, so
          open, this table is the figure again in words; what it alone carries
          is the "what it is not" column, which is the distinction the whole
          pane exists to defend. That is worth a click and not worth the screen.
          The gateway's own sentence stays OUTSIDE the fold: it is this read's
          answer, not the vocabulary. */}
      <details className="disclosure">
        <summary>What each of the {rows} answers means, and what it is not</summary>
        <div className="table-wrap" role="region" aria-label="Private-channel outcome definitions" tabIndex={0}>
        <table className="coh-table">
          <caption className="coh-table__caption">
            This read&rsquo;s own answer is marked in the second column.
          </caption>
          <thead>
            <tr>
              <th scope="col">State</th>
              <th scope="col">This read</th>
              <th scope="col">What it means</th>
              <th scope="col">What it is not</th>
            </tr>
          </thead>
          <tbody>
            {STATES.map((row) => (
              <tr key={row.state}>
                <th scope="row">
                  <span aria-hidden="true">{row.mark}</span> {row.word}
                </th>
                <td>{row.state === panel.state ? "→ this one" : "—"}</td>
                <td>{row.means}</td>
                <td>{row.not}</td>
              </tr>
            ))}
            {known ? null : (
              <tr>
                <th scope="row">
                  <span aria-hidden="true">◌</span> State {panel.state}
                </th>
                <td>→ this one</td>
                <td>A state this pane has not been taught.</td>
                <td>Not one of the five. Shown as itself, rather than folded into the nearest.</td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </details>
    </div>
  );
}

export default function RfqPane({ view, active }: { view: RfqView; active: boolean }) {
  const read = useCoherenceRead<CoherenceRfqPanel>(rfqRoute(), active);
  const { data, error, updatedAt } = read;

  /* How far the makers are apart, poll by poll.
     ON ONE MARKET, NOT THE PANEL. `spread` is a per-market measurement
     and averaging it across the panel would invent a number the venue never
     sent — the same rule the four size fields on Universe are drawn under. So
     the tape follows the first market that HAS a spread, and is keyed on that
     market: when the panel reorders, a different ticker starts a different
     series rather than welding two markets into one line.
     Null where nothing is measured, which on a keyless deployment is always —
     and a null is drawn as a break rather than bridged. */
  const spread = data?.dispersions.find((row) => row.spread != null) ?? null;
  const spreadTape = useLiveSeries(
    `rfq:${spread?.market_ticker ?? "unquoted"}:spread`,
    updatedAt,
    spread?.spread == null ? null : Number(spread.spread),
  );

  /** The count, and one thing under it. Drawn on every branch. */
  const framed = (body: ReactNode) => (
    <div className="coh-rfq">
      {/* THE CLAIM LEFT THIS LINE ON 2026-08-25 and only measurable counts stayed.
          While this pane was two views of Books it opened with the sentence
          that a book shows one most aggressive opinion and this channel is the
          only place the venue exposes several professionals answering
          separately — because as a view it had no head of its own to put it in.
          `MakersSection` has a head now, and that sentence is its lede. Left
          here as well it was the same claim twice in forty pixels, which is
          exactly the reading the section was reported for: "it is too wordy".

          What is NOT prose is the open-request count, which is this read's own
          answer and belongs beside the figure it describes. */}
      {data ? (
        /* The channel's own measured counts, in the row every other section on
           the tab answers in. They were one sentence — "N open requests on the
           channel." — which is the right fact in the wrong object: a count, a
           verdict and a panel width are measurements, and this section was one
           of four with no KPI row at all while Lattice and Stake had six tiles
           each. On a keyless deployment, which is every demo of this engine,
           these three ARE the view, so they had better be legible. */
        <KpiRow readings={channelReadings(data)} source="this call to the channel" />
      ) : (
        <p className="sub">Asking the channel now.</p>
      )}
      <ProofsTransportNotice
        subject="Maker channel read"
        error={error}
        hasSnapshot={Boolean(data)}
        transport={read.transport}
        retryAt={read.retryAt}
        consecutiveFailures={read.consecutiveFailures}
        onRetry={read.refresh}
      />
      {body}
    </div>
  );

  if (error && !data) {
    return framed(
      <ChannelStates states={STATES} current="unavailable" openRequests={null} />,
    );
  }
  if (!data) return framed(<p className="console-empty muted" role="status" aria-busy="true">Asking the makers…</p>);

  const available = data.state === "available";

  return framed(
    <>
      {available && data.dispersions.length ? null : <ChannelNotice panel={data} onRetry={read.refresh} />}
      {view === "channel" ? (
        <>
          {/* The figure carries the state and the count; the chips that said
              the same two things again are gone (third 2026-08-24 review:
              duplicates out, a drawing in). */}
          <ChannelStates states={STATES} current={data.state} openRequests={measuredOpenRequests(data)} />
          <StateTable panel={data} />
        </>
      ) : available && data.dispersions.length ? (
        <>
          <DispersionStrips rows={data.dispersions} />
          <DispersionTable rows={data.dispersions} />
        </>
      ) : (
        <ChannelStates states={STATES} current={data.state} openRequests={measuredOpenRequests(data)} />
      )}

      {/* Drawn only where there is a market to name. A tape captioned "no
          market" would be a figure about the absence of a subject, and the
          empty state above already draws that — better, because it draws how
          far the request got rather than a flat line at nothing. */}
      {spread ? (
        <LiveTape
          points={spreadTape}
          caption={`How far the makers are apart on ${spread.market_ticker}, poll by poll`}
          ariaLabel="The maker-to-maker price spread on this market, over the polls seen since this tab opened"
          reference={{ value: 0, label: "the makers agree exactly" }}
          reading="Widening means the professionals are disagreeing more about the same contract; a gap in the line is a poll that measured nothing, never a poll that measured zero."
        />
      ) : null}
    </>,
  );
}
