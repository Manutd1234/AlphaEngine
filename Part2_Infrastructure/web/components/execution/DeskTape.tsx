"use client";

import { describeOpening, openingSurface, tapeSurface } from "@/components/execution/tape-view";
import { describeTape, useDeskTape } from "@/lib/use-desk-tape";
import { formatDuration, usd } from "@/lib/format";

/**
 * The live decision tape.
 *
 * Sits one pane over from the blotter rather than replacing it, and the copy
 * says why: the blotter is the complete record polled from the authoritative
 * DuckDB store, this is the stream of what has just been decided. A realtime
 * channel drops silently while it reconnects, so it is the wrong thing to
 * source a record from — and exactly the right thing to watch a desk with.
 *
 * Every non-live state renders as a stated reason, never as an empty table. A
 * tape that shows nothing because its channel died looks identical to a quiet
 * desk, and on a trading surface those must never be confusable.
 *
 * THE OPENING READ, and why the table gained a column for it. A subscription
 * delivers only what commits after it is established, so this card used to
 * open blank for a desk that had traded a minute earlier — a green LIVE badge
 * over an empty table, which reads as "the desk is quiet". `useDeskTape` now
 * fetches a bounded page of the same mirror on mount, and every row of it
 * arrives marked `origin: "opening"`.
 *
 * Those rows may not be allowed to pass for streamed ones. The pane split
 * exists because the blotter is the RECORD and this is the STREAM; a page of
 * the record silently joining the stream is the tape impersonating the pane
 * next door. So the origin is a column of words — not a tint, not a border,
 * which forced colours and a colour-blind reader both lose — read out with
 * every row, and the sentence under the state line says how many of the rows
 * on screen came from it.
 */
export default function DeskTape({ symbol }: { symbol: string }) {
  const { state, rows, seen, opening } = useDeskTape(symbol);
  /**
   * The table used to render only while `state === "live"`, so a channel drop
   * replaced every decision already on the tape with the banner — and back
   * again on the resubscribe, at whatever cadence the socket flapped. The rows
   * are measured; the decision that they stay on screen through any transport
   * state is `tapeSurface`, pure so the stability suite can replay the flap.
   */
  const surface = tapeSurface(state, rows.length);
  /**
   * A second, independent decision, because there are two ways for this tape to
   * be missing rows. With rows in hand and a live channel `surface.notice` is
   * false; a failed opening read still has to speak, and it speaks here.
   */
  const readNotice = openingSurface(opening, state);

  return (
    <section className="card desk-tape" aria-labelledby="desk-tape-title">
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">Postgres realtime</span>
          {/* h3, like OrderBlotter and AlertFeed either side of it — the tape
              alone sat at h2, so the subtab's outline ran h3 / h2 / h3. The id
              stays: the section's aria-labelledby reads it. */}
          <h3 id="desk-tape-title">Decision tape</h3>
        </div>
        <span className={`desk-tape__state is-${state}`}>
          <i aria-hidden />
          {state === "live" ? "live" : state === "connecting" ? "connecting" : state === "unavailable" ? "dropped" : "off"}
        </span>
      </div>

      <p className="sub">Filtered to {symbol}.</p>

      {/* The summary, not a neutral label, is what keeps `desk-tape.test.ts`
          honest. That suite's assertion is named "the panel says so where a
          reader will see it", and its intent is at-rest visibility — which a
          `<details>` body satisfies mechanically and not in spirit. So the
          summary itself carries "not the record": at rest the reader still
          learns the tape is a stream, and only the mechanism folds. */}
      <details className="disclosure">
        <summary>Why is this not the record?</summary>
        <p className="research-note">
          The complete record is the Blotter pane, polled from the gateway&apos;s authoritative
          store; a stream can drop silently, so this is watched, not counted on.
        </p>
      </details>

      {surface.notice && (
        <p className={state === "unavailable" ? "banner warn" : "muted"} role="status">
          {state === "unavailable" && <span aria-hidden>! </span>}
          {describeTape(state, rows.length)}
        </p>
      )}
      {readNotice.notice && (
        <p className={readNotice.warn ? "banner warn" : "muted"} role="status">
          {readNotice.warn && <span aria-hidden>! </span>}
          {describeOpening(opening)}
        </p>
      )}
      {surface.table && (
        <div className="table-wrap" tabIndex={0}>
          <table>
            <caption className="sr-only">
              Decisions on the tape for {symbol}, newest first. The origin column says whether a row
              was watched arriving on the Postgres channel or came from the opening read taken when
              this pane opened. A dash means the mirror recorded no value in that column.
            </caption>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Origin</th>
                <th scope="col">Side</th>
                <th scope="col">Notional</th>
                <th scope="col">Verdict</th>
                <th scope="col">Decision latency</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={row.fresh ? "desk-tape__row is-fresh" : "desk-tape__row"}>
                  {/* The same clock as every other time column on this tab.
                      `AlertFeed` sits in the SAME grid row as this card and
                      `OrderBlotter` one pane over; both render
                      `toLocaleTimeString("en-GB", { hour12: false })`, so a
                      reader on a US-default browser was comparing "3:35:07 PM"
                      here against "15:35:07" beside it, for decisions seconds
                      apart on one desk. `WorkingOrders`, the remediation ledger
                      and the quarantine panel use the same call: a time in a
                      table column is 24-hour on this desk, and a 12-hour one
                      also loses the tabular column width the `num` class is
                      here for, because AM/PM is not a digit.
                      The instant itself is unchanged — the mirror's two
                      renderings both carry a +00 offset (see `use-desk-tape`),
                      so this parses to the same moment either way; what was
                      wrong was only how it was spelt. */}
                  <td className="num">
                    {new Date(row.occurredAt).toLocaleTimeString("en-GB", { hour12: false })}
                  </td>
                  {/* Words, in every row. The tint on a freshly streamed row is
                      a one-off flash and forced colours strip it, so it can
                      carry none of this meaning. */}
                  <td>{row.origin === "stream" ? "streamed" : "opening read"}</td>
                  <td className={row.side === "BUY" ? "pos" : "neg"}>{row.side}</td>
                  {/* usd() dashes a null rather than printing $0 — the mirror's
                      notional column is nullable and a refused order can carry
                      none, and a zero there would claim the desk decided on
                      nothing. The caption says what the dash means. */}
                  <td className="num">{usd(row.notional, 0)}</td>
                  <td className={row.verdict === "ACCEPTED" ? "pos" : "neg"}>
                    {row.verdict.replaceAll("_", " ").toLowerCase()}
                  </td>
                  <td className="num">{formatDuration(row.latencyMs, "ms")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {state === "live" && seen > rows.length && (
        <p className="muted">
          {seen} decisions seen this session; showing the {rows.length} most recent.
        </p>
      )}
    </section>
  );
}
