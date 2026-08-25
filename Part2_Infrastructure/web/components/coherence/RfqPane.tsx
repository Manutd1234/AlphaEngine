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
 * THE FOUR STATES ARE A TABLE NOW, and that is the point of this rewrite. They
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
 * A fifth state — the gateway saying something this pane has not been taught —
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
 * and it renders only when there are rows, so the demo deployment's empty
 * channel keeps its `.console-empty` line rather than gaining a bordered plot
 * with nothing in it.
 */

import { type ReactNode } from "react";

import type { CoherenceDispersion, CoherenceRfqPanel } from "@/lib/coherence/types-lab";
import { rfqRoute } from "@/lib/coherence/routes";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import ChannelStates from "./ChannelStates";
import DispersionStrips from "./DispersionStrips";

/** The section's two subjects since the second 2026-08-24 pass: the quotes
 *  themselves, and the channel that did or did not carry them. They were
 *  stacked — the four-state table above the twelve-column dispersion table —
 *  which put a reader through the epistemology every time they wanted a
 *  number. Quotes is the default because it answers the section's headline
 *  question; the Channel view is where a no-answer explains itself. */
export type RfqView = "quotes" | "channel";

/** Below this many independent makers a spread is an anecdote, not a distribution. */
const THIN_PANEL = 3;

/**
 * The four answers the channel can give, as data rather than as four branches.
 *
 * `not` is the load-bearing column. Every one of these four would be reported as
 * "no data" by a panel that only tracked whether it had quotes, and three of the
 * four are then indistinguishable from the fourth — which is the failure this
 * whole pane exists to prevent.
 */
const STATES: ReadonlyArray<{ state: string; mark: string; word: string; means: string; not: string }> = [
  {
    state: "signing_unavailable",
    mark: "○",
    word: "No view, unsigned",
    means: "Nothing was asked: no key, or no signing library.",
    not: "Not an empty market. Our credentials, not their quotes.",
  },
  {
    state: "refused",
    mark: "✕",
    word: "Signed and refused",
    means: "The venue said no.",
    not: "Not silence. The same key will be refused again.",
  },
  {
    state: "empty",
    mark: "◌",
    word: "Read, and empty",
    means: "Zero open requests.",
    not: "Not a failed read. Makers do not quote a sandbox, so the zero is a measurement.",
  },
  {
    state: "available",
    mark: "●",
    word: "Quotes in hand",
    means: "Quotes on the channel.",
    not: "Not a price. Several makers answering independently.",
  },
];

function wordFor(state: string): string {
  return STATES.find((row) => row.state === state)?.word ?? `State ${state}`;
}

/** All four outcomes, with this read's own marked. */
function StateTable({ panel }: { panel: CoherenceRfqPanel }) {
  const known = STATES.some((row) => row.state === panel.state);
  /* The untaught state gets a fifth row, so the count in the summary is
     computed rather than written down — a summary that says "4 rows" over five
     is the kind of small lie that costs a guard its credibility. */
  const rows = known ? STATES.length : STATES.length + 1;
  return (
    <div className="coh-rfq__state">
      {/* FOLDED on the fourth pass of 2026-08-24. `ChannelStates` above draws
          the same four answers in order and marks the one this read got, so
          open, this table is the figure again in words; what it alone carries
          is the "what it is not" column, which is the distinction the whole
          pane exists to defend. That is worth a click and not worth the screen.
          The gateway's own sentence stays OUTSIDE the fold: it is this read's
          answer, not the vocabulary. */}
      <details className="disclosure">
        <summary>What each of the {rows} answers means, and what it is not</summary>
        <div className="table-wrap">
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
                <td>Not one of the four. Shown as itself, rather than folded into the nearest.</td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </details>
      {panel.detail ? <p className="coh-rfq__lead">The gateway says: {panel.detail}</p> : null}
    </div>
  );
}

function Row({ row }: { row: CoherenceDispersion }) {
  const band = row.lowest == null || row.highest == null ? "—" : `${row.lowest} to ${row.highest}`;
  return (
    <tr>
      <th scope="row">{row.market_ticker}</th>
      <td className="num">{row.quotes}</td>
      <td className="num">{row.usable}</td>
      <td className="num">{row.median ?? "—"}</td>
      <td className="num">{band}</td>
      <td className="num">{row.spread ?? "—"}</td>
      <td className="num">{row.median_width ?? "—"}</td>
      <td className="num">{row.crossed}</td>
      <td className="num">{row.band_width ?? "—"}</td>
      <td className="num">{row.band_fraction ?? "—"}</td>
      <td>
        {row.thin ? (
          <span>
            <span aria-hidden="true">▲</span> thin, fewer than {THIN_PANEL} makers
          </span>
        ) : (
          <span>
            <span aria-hidden="true">●</span> {THIN_PANEL} makers or more
          </span>
        )}
      </td>
      <td>
        {row.detail ? (
          <details className="disclosure">
            <summary>How this row reached its usable count</summary>
            <p>{row.detail}</p>
          </details>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}

export default function RfqPane({ view, active }: { view: RfqView; active: boolean }) {
  const { data, error } = useCoherenceRead<CoherenceRfqPanel>(rfqRoute(), active);

  /** The count, and one thing under it. Drawn on every branch. */
  const framed = (body: ReactNode) => (
    <div className="coh-rfq">
      {/* THE CLAIM LEFT THIS LINE ON 2026-08-25 and only the count stayed.
          While this pane was two views of Books it opened with the sentence
          that a book shows one most aggressive opinion and this channel is the
          only place the venue exposes several professionals answering
          separately — because as a view it had no head of its own to put it in.
          `MakersSection` has a head now, and that sentence is its lede. Left
          here as well it was the same claim twice in forty pixels, which is
          exactly the reading the section was reported for: "it is too wordy".

          What is NOT prose is the open-request count, which is this read's own
          answer and belongs beside the figure it describes. */}
      <p className="sub">
        {data
          ? `${data.open_requests} open ${data.open_requests === 1 ? "request" : "requests"} on the channel.`
          : "Asking the channel now."}
      </p>
      {body}
    </div>
  );

  if (error && !data) {
    return framed(
      <p className="console-empty">
        <span aria-hidden="true">✕</span> The RFQ panel could not be read: {error}. That is this desk failing to reach
        its own gateway, not the venue answering.
      </p>,
    );
  }
  if (!data) return framed(<p className="console-empty muted">Asking the makers…</p>);

  const available = data.state === "available";

  return framed(
    <>
      {view === "channel" ? (
        <>
          {/* The figure carries the state and the count; the chips that said
              the same two things again are gone (third 2026-08-24 review:
              duplicates out, a drawing in). */}
          <ChannelStates states={STATES} current={data.state} openRequests={data.open_requests} />
          <StateTable panel={data} />
        </>
      ) : available && data.dispersions.length ? (
        <>
          <DispersionStrips rows={data.dispersions} />
          {/* The strips rank the panels; this proves them, twelve columns wide.
              Folded on the fourth pass of 2026-08-24: it is the longest table
              on the tab and every column of it is per-row detail, so it opens
              when a reader wants to check a number and costs nothing when they
              want the ranking. The summary states both the shape and the size,
              so nobody opens it to find out how big it is. */}
          <details className="disclosure">
            <summary>
              Every maker panel across twelve columns, {data.dispersions.length}{" "}
              {data.dispersions.length === 1 ? "market" : "markets"}
            </summary>
          <div className="table-wrap">
            <table className="coh-table">
              <caption className="coh-table__caption">
                Spread is the disagreement between makers, median width is one maker&rsquo;s own bid-offer — opposite
                situations. Band and share are blank without a combo reading: an unmeasured ratio is
                not a ratio of zero.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Market</th>
                  <th scope="col" className="num">Quotes</th>
                  <th scope="col" className="num">Usable</th>
                  <th scope="col" className="num">Median</th>
                  <th scope="col" className="num">Lowest to highest</th>
                  <th scope="col" className="num">Spread between makers</th>
                  <th scope="col" className="num">Median maker width</th>
                  <th scope="col" className="num">Crossed</th>
                  <th scope="col" className="num">Band the legs leave</th>
                  <th scope="col" className="num">Share of it used</th>
                  <th scope="col">Panel</th>
                  <th scope="col">Notes</th>
                </tr>
              </thead>
              <tbody>
                {data.dispersions.map((row) => (
                  <Row key={row.market_ticker} row={row} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="coh-rfq__note">
            Crossed quotes are counted and excluded, never averaged in: their two sides were priced at different
            moments. A dash is a quantity the panel could not produce, never a zero.
          </p>
          </details>
        </>
      ) : (
        <>
          {/* A DRAWING IN THE EMPTY STATE, since 2026-08-25 and the report that
              this section is "too wordy and no diagrams". It was one grey
              sentence, and on every keyless deployment — which is every demo of
              this engine — that sentence WAS the view. `ChannelStates` is the
              right figure for it rather than a placeholder: the question a
              reader has when no panel comes back is how far the request got,
              and that is precisely what it draws. It is the same figure the
              Channel view leads with, drawn from the same four rows; what
              Channel adds under it is the table of what each answer is NOT. */}
          <ChannelStates states={STATES} current={data.state} openRequests={data.open_requests} />
          <p className="console-empty">
            <span aria-hidden="true">◌</span> No dispersion to rank on this read: the channel answered
            &ldquo;{wordFor(data.state).toLowerCase()}&rdquo;, so there are no maker panels to draw. Channel says what
            that answer means and what it does not.
          </p>
        </>
      )}

      {error ? (
        <p className="coh-rfq__note">
          <span aria-hidden="true">✕</span> The last refresh failed: {error}. What is above is the previous answer.
        </p>
      ) : null}
    </>,
  );
}
