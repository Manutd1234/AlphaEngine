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
          <dl className="console-facts console-facts--tight" aria-label="Answer provenance">
            <div>
              <dt>Provider</dt>
              <dd>{result.provenance.label} <span className="muted">({result.provenance.provider})</span></dd>
            </div>
            <div>
              <dt>Fetched at (UTC)</dt>
              <dd>
                <time dateTime={result.provenance.fetchedAt}>
                  {absoluteTimestamp(result.provenance.fetchedAt)}
                </time>
              </dd>
            </div>
            <div>
              <dt>Provider latency</dt>
              <dd>{result.provenance.latencyMs}ms</dd>
            </div>
            <div>
              <dt>Delivery</dt>
              <dd>
                {result.provenance.cached ? "Cache hit" : "Upstream"}
                {result.provenance.delayed ? ", delayed tier" : ", live tier"}
              </dd>
            </div>
            <div>
              <dt>Quota remaining</dt>
              <dd>
                {result.provenance.quotaRemaining === null
                  ? "not metered"
                  : quotaSentence(result.provenance.quotaRemaining, result.provenance.quotaLimit ?? null, result.provenance.quotaWindow)}
              </dd>
            </div>
          </dl>
        </>
      )}

      {result.attempts.length > 0 && (
        <>
          <p className="console-subhead">
            Skipped before the answer
            <small className="muted"> — ranked above the provider that answered.</small>
          </p>
          <ul className="console-skips">
            {result.attempts.map((attempt) => (
              <li key={`${attempt.provider}-${attempt.reason}`}>
                <strong>{attempt.provider}</strong>
                <span className="console-skip__reason">{SKIP_LABEL[attempt.reason] ?? attempt.reason}</span>
                {attempt.detail && <small className="muted console-wrap">{attempt.detail}</small>}
              </li>
            ))}
          </ul>
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
        <ul className="console-calls">
          {result.upstream.calls.map((call, index) => (
            <li key={`${call.url}-${index}`}>
              <div className="console-call__head">
                <span className={`method-badge method-${call.method.toLowerCase()}`}>{call.method}</span>
                <span style={{ color: call.ok ? "var(--success-text)" : "var(--critical-text)" }}>
                  <span aria-hidden>{call.ok ? "●" : "✕"}</span> {call.status ?? "no response"}
                </span>
                <span className="num muted">{call.ms}ms</span>
                {call.body && (
                  <span className="num muted">
                    {call.body.bytes.toLocaleString()} B{call.body.truncated ? " (sampled)" : ""}
                  </span>
                )}
              </div>
              <code className="console-call__url">{call.url}</code>
              {call.error && <small className="console-warn console-wrap">{call.error}</small>}
              {call.body && (
                <details>
                  <summary>Raw response body</summary>
                  <JsonTree value={call.body.value} initialDepth={1} />
                </details>
              )}
            </li>
          ))}
        </ul>
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
