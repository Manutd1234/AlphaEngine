"use client";

/**
 * The REST half of the pipeline inspector: what `GET /api/system/inspect`
 * actually did, stage by stage.
 *
 * Split out of `PipelineInspector` when that file passed the length ceiling.
 * The inspector still owns every request, every piece of state and both gates;
 * this renders one `InspectResponse` and holds no state of its own, which is
 * why it could leave without taking a hook with it.
 *
 * The zone order is the argument and does not change: cache verdict and timing,
 * then the executed lineage, then who answered and what it cost, then the raw
 * bodies, then the normalised output. Methodology folds into a disclosure; an
 * absence of evidence never does — a reader must not have to open anything to
 * learn that nothing was captured.
 *
 * WHY THE RECORD ZONES ARE TABLES
 * ---------------------------------------------------------------------------
 * Provenance, the skipped providers and the upstream calls are RECORDS — the
 * same fields repeated over a population — and were drawn as three bespoke
 * shapes: a definition grid, left-accented cards, bordered cards with a flex
 * badge row. So "compare these providers to each other", the question this
 * panel exists for, meant scanning three layouts. They are `.table-wrap` plus
 * a plain `<table>` now, the idiom ~thirty other panels use, so the border,
 * the header band and the tabular-mono figures come from
 * `00-tokens-and-base.css` and this card needed no new rule. No field was
 * dropped to fit: a wide table scrolls INSIDE its wrap, never the page, and
 * the wrap carries `tabIndex={0}` because a scroll container nobody can focus
 * is unreachable by keyboard and by every switch device. Raw vendor bodies
 * stayed in `JsonTree` — a payload is a tree, not a row.
 *
 * Two zones deliberately did NOT move, recorded here so the next reader does
 * not read it as an oversight: the cache verdict is ONE record of name/value
 * facts, which is what a `<dl>` is for, and the executed lineage is a PATH
 * whose order is its meaning, which is what an `<ol>` is for. Both are pinned
 * in that shape by `tests/data-diagnostics-ui.test.ts`.
 */

import JsonTree from "@/components/systems/JsonTree";
import { SKIP_LABEL, type InspectResponse } from "@/components/systems/types";
import { fmt } from "@/lib/format";

/** "23 of 25 left today" — the remainder, its allowance and its window, as words. */
function quotaSentence(remaining: number, limit: number | null, window: string | null): string {
  const when = window === "day" ? " today"
    : window === "minute" ? " this minute"
      : window === "month" ? " this month"
        : window ? ` this ${window}` : "";
  return limit === null ? `${remaining} left${when}` : `${remaining} of ${limit} left${when}`;
}

function absoluteTimestamp(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  return new Date(parsed).toISOString().replace("T", " ").replace(".000Z", " UTC");
}

interface NewsRow {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  sentiment: number | null;
}

export default function RestTrace({ result, interval }: { result: InspectResponse; interval?: string }) {
  const cacheHit = result.cache.state === "hit";
  return (
    <>
      <p className="console-subhead">Cache &amp; timing</p>
      <dl className="console-facts" aria-label="Cache verdict and timing">
        {result.capability === "bars" && interval && (
          <div>
            <dt>Requested interval</dt>
            <dd>{interval}</dd>
          </div>
        )}
        <div>
          <dt>State</dt>
          {/* "dispatched to a provider", not "fetched upstream": the registry
              cache missing does not prove a packet left the process. Binance's
              public endpoints sit behind Next's fetch cache too, so a miss here
              can still be answered without touching the exchange. */}
          <dd style={{ color: cacheHit ? "var(--series-1)" : "var(--success-text)" }}>
            <span aria-hidden>{cacheHit ? "◆" : "↓"}</span>{" "}
            {cacheHit ? "registry cache hit (in-process)" : "registry cache miss — dispatched"}
          </dd>
        </div>
        <div>
          <dt>TTL remaining</dt>
          <dd>
            {result.cache.ttlRemainingMs === null
              ? "—"
              : `${fmt(result.cache.ttlRemainingMs / 1000, 1)}s of ${Math.round(result.cache.configuredTtlMs / 1000)}s`}
          </dd>
        </div>
        <div>
          <dt>Age when served</dt>
          <dd>{cacheHit ? `${fmt(result.cache.ageMs / 1000, 1)}s` : "0s — newly written"}</dd>
        </div>
        <div>
          <dt>Round trip</dt>
          <dd>{result.totalMs}ms</dd>
        </div>
        {/* The key is identity, not a metric, but it belongs in the verdict
            grid rather than in a stray sentence below it: one zone, one grid. */}
        <div className="console-facts__span">
          <dt>Cache key</dt>
          <dd>{result.cache.key}</dd>
        </div>
      </dl>

      {/* The heart of the panel: the executed path, stage by stage, ahead of
          who answered and what it cost. Everything below is detail on one of
          these nodes. */}
      <p className="console-subhead">Lineage</p>
      <ol className="console-lineage">
        {result.lineage.map((stage) => (
          <li key={stage.stage}>
            <strong>{stage.stage}</strong>
            <small>{stage.detail}</small>
          </li>
        ))}
      </ol>

      {result.provenance && (
        <>
          <p className="console-subhead">Provenance</p>
          {/* One record, five facts: a one-row table, not the two-column
              definition grid this was. The grid put latency and quota at
              different x-positions, which is readable once and useless to
              compare against the skip table below it — both zones describe the
              same population of providers and now share a column grammar and a
              mono figure alignment. The wrap is focusable because the quota
              sentence pushes this past the card on a narrow viewport, and a
              scroll container nobody can focus is unreachable by keyboard. */}
          <div className="table-wrap" tabIndex={0}>
            <table>
              <caption className="sr-only">Answer provenance</caption>
              <thead>
                <tr>
                  <th scope="col">Provider</th>
                  <th scope="col">Fetched at (UTC)</th>
                  <th scope="col" className="num">Latency</th>
                  <th scope="col">Delivery</th>
                  <th scope="col">Quota remaining</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">{result.provenance.label} <span className="muted">({result.provenance.provider})</span></th>
                  <td><time dateTime={result.provenance.fetchedAt}>{absoluteTimestamp(result.provenance.fetchedAt)}</time></td>
                  <td className="num">{result.provenance.latencyMs}ms</td>
                  <td>
                    {result.provenance.cached ? "Cache hit" : "Upstream"}
                    {result.provenance.delayed ? ", delayed tier" : ", live tier"}
                  </td>
                  {/* A dash, and the reason for it. "not metered" alone read as
                      a measurement; the dash says no number exists and the
                      words say why none does. */}
                  <td>
                    {result.provenance.quotaRemaining === null
                      ? "— not metered"
                      : quotaSentence(result.provenance.quotaRemaining, result.provenance.quotaLimit ?? null, result.provenance.quotaWindow)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}

      {result.attempts.length > 0 && (
        <>
          <p className="console-subhead">
            Skipped before the answer
            <small className="muted"> — ranked above the provider that answered.</small>
          </p>
          {/* The most valuable zone on the card, and the one the old markup
              served worst: left-accented cards where provider, reason and the
              vendor's words ran together at three sizes, so "which of these
              four was quota and which was a circuit" could not be read down a
              column. One row per provider, fixed reason column, now.

              The reason keeps `.console-skip__reason` rather than a colour on
              the cell: the mapped word IS the meaning (SKIP_LABEL turns
              `quota_exhausted` into "quota spent") and the hue only underlines
              it. `.console-wrap` on the detail cell is the documented opt-out
              from the global `td { white-space: nowrap }` — without it one long
              vendor message drags the table sideways for all three columns. */}
          <div className="table-wrap" tabIndex={0}>
            <table>
              <caption className="sr-only">Providers ranked above the one that answered, and why each was skipped</caption>
              <thead>
                <tr>
                  <th scope="col">Provider</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {result.attempts.map((attempt) => (
                  <tr key={`${attempt.provider}-${attempt.reason}`}>
                    <th scope="row">{attempt.provider}</th>
                    <td className="console-skip__reason">{SKIP_LABEL[attempt.reason] ?? attempt.reason}</td>
                    {/* An absent detail is a typed state: dispatch recorded the
                        reason and the vendor said nothing further. It dashes
                        and says so rather than leaving an empty cell that
                        looks like a rendering fault. */}
                    <td>
                      {attempt.detail
                        ? <small className="muted console-wrap">{attempt.detail}</small>
                        : <small className="muted">— none recorded</small>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {result.error && (
        <div className="banner warn" role="status">
          <span aria-hidden>!</span>
          <div>
            {/* "Could not answer" and "has no data" are different findings.
                When every provider that was reached said "nothing here" (or
                was never reachable for a licence or key reason), the pool is
                healthy and the symbol is the question. */}
            <strong>
              {result.attempts.length > 0
                && result.attempts.every((a) => a.reason === "no_data" || a.reason === "not_configured" || a.reason === "unlicensed")
                ? `No provider has ${result.capability} data for ${result.symbol}.`
                : "No provider could answer."}
            </strong>{" "}
            {result.error}
          </div>
        </div>
      )}

      <p className="console-subhead">
        Upstream calls
        <small className="muted"> — {result.upstream.note}</small>
      </p>
      {result.upstream.calls.length === 0 ? (
        <p className="muted console-empty">
          {result.cache.state === "hit"
            ? "None — the cache answered. Use “Trace (bypass cache)” to force a real call."
            : "None captured."}
        </p>
      ) : (
        <>
          {/* Was a stack of bordered cards each with its own flex row of
              badges. Every call carries the same facts, so they are columns:
              the ms and byte figures line up in tabular mono, which is what
              makes "which of these four was the slow one" a glance rather than
              a read. The provider column is new — `UpstreamCall.provider` was
              already on the wire and the card threw it away, so a trace with
              two vendors could not say which call belonged to whom. The URL
              keeps `.console-call__url`; it is the one cell routinely wider
              than the card, which is why the wrap is focusable here. */}
          <div className="table-wrap" tabIndex={0}>
            <table>
              <caption className="sr-only">HTTP calls captured while answering this inspection</caption>
              <thead>
                <tr>
                  <th scope="col" className="num">#</th>
                  <th scope="col">Provider</th>
                  <th scope="col">Method</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">Time</th>
                  <th scope="col" className="num">Body</th>
                  <th scope="col">Error</th>
                  <th scope="col">URL</th>
                </tr>
              </thead>
              <tbody>
                {result.upstream.calls.map((call, index) => (
                  <tr key={`${call.url}-${index}`}>
                    <th scope="row" className="num">{index + 1}</th>
                    <td>{call.provider}</td>
                    <td><span className={`method-badge method-${call.method.toLowerCase()}`}>{call.method}</span></td>
                    {/* Glyph and number, never the hue alone. A call that never
                        got a response has no status code, so it dashes and
                        says which absence it was. */}
                    <td style={{ color: call.ok ? "var(--success-text)" : "var(--critical-text)" }}>
                      <span aria-hidden>{call.ok ? "●" : "✕"}</span> {call.status ?? "— no response"}
                    </td>
                    <td className="num">{call.ms}ms</td>
                    {/* Raw retention is a checkbox on this card. Off means no
                        body was kept, which is not the finding "the vendor
                        returned nothing" — so the cell names the cause rather
                        than printing a bare dash or, worse, a zero. */}
                    <td className="num">
                      {call.body
                        ? `${call.body.bytes.toLocaleString()} B${call.body.truncated ? " (sampled)" : ""}`
                        : "— not retained"}
                    </td>
                    <td>
                      {call.error
                        ? <small className="console-warn console-wrap">{call.error}</small>
                        : <small className="muted">— none</small>}
                    </td>
                    <td><code className="console-call__url">{call.url}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result.upstream.calls.some((call) => call.body !== undefined) && (
            <>
              {/* Keyed back to the table by call number and URL, so the two
                  zones read together without repeating the figures. */}
              <p className="console-subhead">
                Raw response bodies
                <small className="muted"> — the vendor&apos;s own shape, before the normaliser.</small>
              </p>
              <ul className="console-calls">
                {result.upstream.calls.map((call, index) =>
                  call.body === undefined ? null : (
                    <li key={`body-${call.url}-${index}`}>
                      <div className="console-call__head">
                        <span className="num muted">#{index + 1}</span>
                        <span className={`method-badge method-${call.method.toLowerCase()}`}>{call.method}</span>
                      </div>
                      <code className="console-call__url">{call.url}</code>
                      <details>
                        <summary>Raw response body</summary>
                        <JsonTree value={call.body.value} initialDepth={1} />
                      </details>
                    </li>
                  ),
                )}
              </ul>
            </>
          )}
        </>
      )}

      {result.upstream.calls.some((call) => call.body !== undefined) && (
        /* Static methodology, not a number a reader would be wrong to miss —
           exactly what the disclosure grammar exists for. */
        <details className="disclosure">
          <summary>Why raw and normalised are shown separately</summary>
          <p className="console-footnote">
            Raw vendor bodies and normalised output are separate evidence. This response exposes no
            field-level transformation map, so none is inferred.
          </p>
        </details>
      )}

      <p className="console-subhead">Normalised output</p>
      {/* Headlines are the one normalised payload that is unreadable as a tree —
          a list of titles answers "did the news capability actually serve
          something usable" at a glance, which the JSON below cannot. */}
      {result.capability === "news" && Array.isArray(result.data) && (
        <ul className="console-headlines">
          {(result.data as NewsRow[]).slice(0, 8).map((item) => (
            <li key={item.id ?? item.url}>
              <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a>
              <small className="muted">
                {item.source}
                {item.publishedAt && `, ${new Date(item.publishedAt).toLocaleString()}`}
                {/* null sentiment = not scored; only a real score renders */}
                {item.sentiment != null
                  && `; sentiment ${item.sentiment >= 0 ? "+" : ""}${fmt(item.sentiment, 2)}`}
              </small>
            </li>
          ))}
          {result.data.length === 0 && (
            <li className="muted">The capability answered, with no stories for this symbol.</li>
          )}
        </ul>
      )}
      <details open={result.capability !== "news"}>
        <summary>
          {result.capability === "bars" && interval
            ? `${interval} bars after coercion`
            : `${result.capability} after coercion`}
        </summary>
        <JsonTree value={result.data} initialDepth={2} />
      </details>
    </>
  );
}
