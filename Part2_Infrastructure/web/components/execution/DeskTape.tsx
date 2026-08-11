"use client";

import { describeTape, useDeskTape } from "@/lib/use-desk-tape";
import { fmt, usd } from "@/lib/format";

/**
 * The live decision tape.
 *
 * Sits beside the blotter rather than replacing it, and the copy says why: the
 * blotter is the complete record polled from the authoritative DuckDB store,
 * this is the stream of what has just been decided. A realtime channel drops
 * silently while it reconnects, so it is the wrong thing to source a record
 * from — and exactly the right thing to watch a desk with.
 *
 * Every non-live state renders as a stated reason, never as an empty table. A
 * tape that shows nothing because its channel died looks identical to a quiet
 * desk, and on a trading surface those must never be confusable.
 */
export default function DeskTape({ symbol }: { symbol: string }) {
  const { state, rows, seen } = useDeskTape(symbol);

  return (
    <section className="card desk-tape" aria-labelledby="desk-tape-title">
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">Postgres realtime</span>
          <h2 id="desk-tape-title">Decision tape</h2>
        </div>
        <span className={`desk-tape__state is-${state}`}>
          <i aria-hidden />
          {state === "live" ? "live" : state === "connecting" ? "connecting" : state === "unavailable" ? "dropped" : "off"}
        </span>
      </div>

      <p className="sub">
        Mirrored decisions as Postgres commits them, filtered to {symbol}. The blotter beside this
        is the complete record — polled from the gateway&apos;s own store, which stays authoritative.
        A stream can drop silently, so it is watched, not counted on.
      </p>

      {state !== "live" || rows.length === 0 ? (
        <p className={state === "unavailable" ? "banner warn" : "muted"} role="status">
          {state === "unavailable" && <span aria-hidden>! </span>}
          {describeTape(state, rows.length)}
        </p>
      ) : (
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
                  <td className="num">{row.latencyMs == null ? "—" : `${fmt(row.latencyMs, 2)}ms`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {state === "live" && seen > rows.length && (
        <p className="muted">
          {seen} decisions seen this session; the {rows.length} most recent are shown.
        </p>
      )}
    </section>
  );
}
