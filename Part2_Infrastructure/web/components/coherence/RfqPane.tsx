"use client";

/**
 * What the makers disagree about, where the public book shows nothing.
 *
 * A book publishes its most aggressive opinion, not the typical one. The RFQ
 * endpoint exposes several professionals pricing one request independently.
 * `MakersSection` owns the heading; this pane owns the result and renders the
 * selected signer's provenance without pretending a REST poll is a connection.
 *
 * Two quantities in the dispersion table are routinely conflated and are kept
 * apart: `spread` is the disagreement BETWEEN makers, `median_width` is one
 * maker's own bid-offer. A wide panel of tight makers and a tight panel of wide
 * makers are opposite situations and would read identically if either number
 * stood alone. `DispersionStrips` draws each panel's range on one shared dollar
 * axis, while the folded table retains the exact rows. Empty reads get the
 * outcome map rather than a fabricated dispersion plot.
 */

import { type ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { CoherenceRfqPanel } from "@/lib/coherence/types-lab";
import { rfqRoute } from "@/lib/coherence/routes";
import { measuredOpenRequests } from "@/lib/coherence/rfq-measurements";
import { makerPanelKey, makerPanelLabel } from "@/lib/coherence/maker-dispersion";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import { useLiveSeries } from "@/lib/coherence/use-live-series";
import LiveTape from "./LiveTape";
import ChannelStates from "./ChannelStates";
import DispersionTable, { THIN_PANEL } from "./DispersionTable";
import KpiRow, { type Reading } from "./KpiRow";
import DispersionStrips from "./DispersionStrips";
import ProofsTransportNotice from "./ProofsTransportNotice";

/** The section's two subjects since the second 2026-08-24 pass: the quotes
 *  themselves, and the REST poll that did or did not carry them. They were
 *  stacked — the outcome table above the twelve-column dispersion table —
 *  which put a reader through the epistemology every time they wanted a
 *  number. Quotes is the default because it answers the section's headline
 *  question; the REST-poll view is where a no-answer explains itself. */
export type RfqView = "quotes" | "channel";

/**
 * The answers the RFQ poll can give, as data rather than as rendering branches.
 *
 * `not` is the load-bearing column. Every one of these would be reported as
 * "no data" by a panel that only tracked whether it had quotes, and three of them
 * would otherwise be indistinguishable — which is the failure this pane prevents.
 */
type SigningEnvironment = NonNullable<CoherenceRfqPanel["signing_environment"]>;
type RfqStateRow = { state: string; mark: string; word: string; means: string; not: string };

function environmentName(environment: SigningEnvironment | null | undefined): string | null {
  if (environment === "production") return "Production";
  if (environment === "demo") return "Demo";
  return null;
}

function authenticatedPollName(environment: SigningEnvironment | null | undefined): string {
  const name = environmentName(environment);
  return name ? `${name} authenticated REST poll` : "Authenticated REST poll";
}

/** The outcome vocabulary names the selected signer instead of assuming demo. */
function statesFor(environment: SigningEnvironment | null | undefined): ReadonlyArray<RfqStateRow> {
  const name = environmentName(environment);
  const poll = authenticatedPollName(environment);
  const setup = name
    ? `${name} REST signing was selected but is not usable.`
    : environment === null
      ? "No usable production or demo REST signer was selected."
      : "REST signing is unavailable; this gateway did not report an environment.";
  const emptyNot = environment === "demo"
    ? "Not a WebSocket subscription or a failed read. Demo accounts commonly have no maker activity."
    : environment === "production"
      ? "Not a WebSocket subscription or a failed read. This production account had no open RFQs on this poll."
      : "Not a WebSocket subscription or a failed read. The older gateway did not report which environment was used.";
  return [
    {
      state: "signing_unavailable",
      mark: "⚙",
      word: "REST signing setup",
      means: setup,
      not: "Not an empty market: no authenticated RFQ request was sent.",
    },
    {
      state: "unavailable",
      mark: "⊘",
      word: "REST poll unavailable",
      means: `The ${name ? `${name.toLowerCase()} ` : ""}REST request could not complete.`,
      not: "Not an empty panel, and not a venue refusal.",
    },
    {
      state: "refused",
      mark: "✕",
      word: "Credentials refused",
      means: `The venue refused the ${name ? `${name.toLowerCase()} ` : ""}signed REST request.`,
      not: "Not silence. The same credentials will be refused again until repaired or rotated.",
    },
    {
      state: "empty",
      mark: "◌",
      word: `${name ?? "Authenticated"} poll, no RFQs`,
      means: `${poll} completed with zero account-visible open requests.`,
      not: emptyNot,
    },
    {
      state: "requests_only",
      mark: "◔",
      word: `${name ?? "Authenticated"} poll, awaiting quotes`,
      means: `${poll} returned open requests that no maker has answered yet.`,
      not: "Not an empty RFQ read and not maker agreement: zero quote rows cannot measure dispersion.",
    },
    {
      state: "available",
      mark: "●",
      word: `${name ?? "Authenticated"} poll, quotes present`,
      means: `${poll} returned account-visible maker quotes.`,
      not: "Not a WebSocket or persistent connection, and not one price. Cursor pages complete inside one bounded poll.",
    },
  ];
}

/**
 * The poll provenance and measurable counts a reader wants before any drawing.
 *
 * The signer/poll state always answers. Counts appear only after a completed
 * REST read; setup and transport states do not manufacture zeros from a list
 * never read.
 */
function channelReadings(panel: CoherenceRfqPanel): Reading[] {
  const panels = panel.dispersions.length;
  const thin = panel.dispersions.filter((row) => row.thin).length;
  const openRequests = measuredOpenRequests(panel);
  const openQuotes = panel.open_quotes ?? panel.dispersions.reduce((sum, row) => sum + row.quotes, 0);
  const name = environmentName(panel.signing_environment);
  const completed = panel.state === "empty" || panel.state === "requests_only" || panel.state === "available";
  const poll: Reading = {
    label: "RFQ REST poll",
    value: panel.state === "signing_unavailable"
      ? name
        ? `${name} signer unavailable`
        : panel.signing_environment === null
          ? "Signing not configured"
          : "Signing unavailable; environment unreported"
      : completed
        ? name ? `${name} authenticated` : "Authenticated; environment unreported"
        : panel.state === "refused"
          ? name ? `${name} credentials refused` : "Credentials refused"
          : name ? `${name} attempt incomplete` : "Attempt incomplete",
    note: completed
      ? "One bounded browser poll; gateway cursor pages complete inside its deadline."
      : panel.state === "signing_unavailable"
        ? "No authenticated RFQ request was sent."
        : undefined,
  };
  if (openRequests == null) return [poll];
  return [
    poll,
    { label: "Open requests", value: String(openRequests), note: openRequests === 0 ? "live read completed" : undefined },
    { label: "Open maker quotes", value: String(openQuotes), note: openQuotes === 0 ? "awaiting maker replies" : undefined },
    {
      label: "Maker panels",
      value: String(panels),
      note: thin ? <><span aria-hidden="true">▲</span> {thin} thin, under {THIN_PANEL} makers</> : undefined,
    },
  ];
}

function ChannelNotice({ panel, onRetry }: { panel: CoherenceRfqPanel; onRetry: () => void }) {
  const fault = panel.state === "unavailable" || panel.state === "refused";
  const name = environmentName(panel.signing_environment);
  const poll = authenticatedPollName(panel.signing_environment);
  const title = panel.state === "signing_unavailable"
    ? name
      ? `${name} RFQ REST signing needs setup`
      : panel.signing_environment === null
        ? "Set up production or demo RFQ REST signing"
        : "RFQ REST signing is unavailable"
    : panel.state === "empty"
      ? `${poll} completed; no open RFQs`
      : panel.state === "requests_only"
        ? `${poll} completed; open RFQs are awaiting maker quotes`
        : panel.state === "available"
          ? `${poll} completed with quotes`
          : panel.state === "refused"
            ? `${name ? `${name} ` : ""}RFQ REST credentials were refused`
            : `${name ? `${name} ` : ""}RFQ REST poll is temporarily unavailable`;
  const environmentDetail = name
    ? `${name} credentials were selected for this request.`
    : panel.state === "signing_unavailable"
      ? panel.signing_environment === null
        ? "No usable production or demo signing environment was selected."
        : "This gateway did not report which signing environment was attempted."
      : "This gateway did not report whether it used production or demo credentials.";
  return (
    <Alert
      role={fault ? "alert" : "status"}
      variant={fault ? "destructive" : "default"}
      className="coh-rfq__connection"
      data-state={panel.state}
    >
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{environmentDetail} The gateway says: {panel.detail}</p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Poll the RFQ REST endpoint now
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/** Every known outcome, with this read's own marked. */
function StateTable({ panel, states }: { panel: CoherenceRfqPanel; states: ReadonlyArray<RfqStateRow> }) {
  const known = states.some((row) => row.state === panel.state);
  /* An untaught state gets one additional row, so the count in the summary is
     computed rather than written down — a stale row count over a longer table
     is the kind of small lie that costs a guard its credibility. */
  const rows = known ? states.length : states.length + 1;
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
        <div className="table-wrap" role="region" aria-label="RFQ REST-poll outcome definitions" tabIndex={0}>
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
            {states.map((row) => (
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
                <td>Not one of the named outcomes. Shown as itself, rather than folded into the nearest.</td>
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
     ON ONE REQUEST, NOT THE PANEL. `spread` is a per-RFQ measurement
     and averaging it across the panel would invent a number the venue never
     sent — the same rule the four size fields on Universe are drawn under. The
     tape follows the first request that has a spread and keys the series on its
     RFQ identity. Two requests for one ticker therefore never become one line;
     an older gateway without RFQ identity gets the same indexed fallback used
     by the table and strips.
     Null where nothing is measured, which on a keyless deployment is always —
     and a null is drawn as a break rather than bridged. */
  const spreadIndex = data?.dispersions.findIndex((row) => row.spread != null) ?? -1;
  const spread = spreadIndex >= 0 ? data?.dispersions[spreadIndex] ?? null : null;
  const spreadKey = spread ? makerPanelKey(spread, spreadIndex) : "unquoted";
  const spreadLabel = spread && data
    ? makerPanelLabel(spread, spreadIndex, data.dispersions)
    : null;
  const spreadTape = useLiveSeries(
    `rfq:${spreadKey}:spread`,
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
        /* The RFQ poll's own measured counts, in the row every other section on
           the tab answers in. They were one sentence — "N open requests on the
           channel." — which is the right fact in the wrong object: a count, a
           verdict and a panel width are measurements, and this section was one
           of four with no KPI row at all while Lattice and Stake had six tiles
           each. When signing or transport is unavailable, provenance itself is
           the answer, so it has to remain legible without invented counts. */
        <KpiRow readings={channelReadings(data)} source="this authenticated RFQ REST poll" />
      ) : (
        <p className="sub">Polling the authenticated RFQ REST endpoint now.</p>
      )}
      <ProofsTransportNotice
        subject="Maker RFQ REST poll"
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
      <ChannelStates states={statesFor(undefined)} current="unavailable" openRequests={null} />,
    );
  }
  if (!data) return framed(<p className="console-empty muted" role="status" aria-busy="true">Polling the makers…</p>);

  const available = data.state === "available";
  const states = statesFor(data.signing_environment);

  return framed(
    <>
      {available && data.dispersions.length ? null : <ChannelNotice panel={data} onRetry={read.refresh} />}
      {view === "channel" ? (
        <>
          {/* The figure carries the state and the count; the chips that said
              the same two things again are gone (third 2026-08-24 review:
              duplicates out, a drawing in). */}
          <ChannelStates states={states} current={data.state} openRequests={measuredOpenRequests(data)} />
          <StateTable panel={data} states={states} />
        </>
      ) : available && data.dispersions.length ? (
        <>
          <DispersionStrips rows={data.dispersions} />
          <DispersionTable rows={data.dispersions} />
        </>
      ) : (
        <ChannelStates states={states} current={data.state} openRequests={measuredOpenRequests(data)} />
      )}

      {/* Drawn only where there is a market to name. A tape captioned "no
          market" would be a figure about the absence of a subject, and the
          empty state above already draws that — better, because it draws how
          far the request got rather than a flat line at nothing. */}
      {spread ? (
        <LiveTape
          points={spreadTape}
          caption={`How far the makers are apart on ${spreadLabel ?? spread.market_ticker}, poll by poll`}
          ariaLabel="The maker-to-maker price spread on this request, over the polls seen since this tab opened"
          reference={{ value: 0, label: "the makers agree exactly" }}
          reading="Widening means the professionals are disagreeing more about the same contract; a gap in the line is a poll that measured nothing, never a poll that measured zero."
        />
      ) : null}
    </>,
  );
}
