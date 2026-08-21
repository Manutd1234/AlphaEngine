"use client";

import { tapeSurface } from "@/components/execution/tape-view";
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
 */
export default function DeskTape({ symbol }: { symbol: string }) {
  const { state, rows, seen } = useDeskTape(symbol);
  /**
   * The table used to render only while `state === "live"`, so a channel drop
   * replaced every decision already on the tape with the banner — and back
   * again on the resubscribe, at whatever cadence the socket flapped. The rows
   * are measured; the decision that they stay on screen through any transport
   * state is `tapeSurface`, pure so the stability suite can replay the flap.
   */
  const surface = tapeSurface(state, rows.length);

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
      {surface.table && (
        <div className="table-wrap" tabIndex={0}>
          <table>
            <caption className="sr-only">
              Decisions streamed from the Postgres mirror since this page opened, newest first.
            </caption>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Side</th>
                <th scope="col">Notional</th>
                <th scope="col">Verdict</th>
                <th scope="col">Decision latency</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={row.fresh ? "desk-tape__row is-fresh" : "desk-tape__row"}>
                  <td className="num">{new Date(row.occurredAt).toLocaleTimeString()}</td>
                  <td className={row.side === "BUY" ? "pos" : "neg"}>{row.side}</td>
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
