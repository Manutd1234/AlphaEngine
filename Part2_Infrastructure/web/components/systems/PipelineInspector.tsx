"use client";

/**
 * Symbol pipeline inspector — what happened, not what the price is.
 *
 * The panel this replaces looked up a symbol and printed `591.31 USDT`, which
 * the Execution tab already shows better. A developer arriving here is not
 * asking what the number is. They are asking why it is *that* number: whether it
 * came off the wire or out of a cache, how much life that cache entry had left,
 * which providers were ranked above the one that answered and what disqualified
 * each of them, how many HTTP calls it took, and — when a field is null — what
 * the vendor actually sent before the normaliser touched it.
 *
 * All of that comes from `GET /api/system/inspect`, which runs the real
 * registry path under a capture scope. Nothing is re-derived in the browser, so
 * what is on screen is what a curl would return.
 *
 * The second tab is the WebSocket wire tap. Those frames never reach the server
 * — the browser subscribes to the exchanges directly — so they are captured
 * client-side and labelled as such. Sockets open only while that tab is
 * selected, because a hidden panel holding two exchange connections is a cost
 * with no reader.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import JsonTree from "@/components/systems/JsonTree";
import { SKIP_LABEL, type InspectResponse } from "@/components/systems/types";
import { fmt } from "@/lib/format";
import { useLiveBook } from "@/lib/livebook";
import { applicableAssets, inapplicableReason, isApplicable } from "@/lib/providers/capabilities";
import { classify } from "@/lib/providers/symbols";
import { SYMBOLS } from "@/lib/venues";
import { usePolling } from "@/lib/use-polling";

const CAPABILITIES = ["quote", "bars", "news", "fundamentals"] as const;
type Capability = (typeof CAPABILITIES)[number];

const LIVE_SYMBOLS = new Set<string>(SYMBOLS);

/** The equity the callout offers when a capability cannot answer for the desk symbol. */
const EQUITY_EXAMPLE = "AAPL";

/** "23 of 25 left today" — the remainder, its allowance and its window, as words. */
function quotaSentence(remaining: number, limit: number | null, window: string | null): string {
  const when = window === "day" ? " today"
    : window === "minute" ? " this minute"
      : window === "month" ? " this month"
        : window ? ` this ${window}` : "";
  return limit === null ? `${remaining} left${when}` : `${remaining} of ${limit} left${when}`;
}

interface PipelineInspectorProps {
  symbol: string;
  onSymbolChange: (symbol: string) => void;
  /** Workspace bar interval. Only sent to the bars capability. */
  interval: string;
  /** Console-wide poll cadence; 0 means paused. */
  pollMs: number;
  onEvent: (level: "info" | "warn" | "error", message: string, fields?: Record<string, string | number | boolean | null>) => void;
  /** Hidden outer subtabs stay mounted, so network work must be gated explicitly. */
  active: boolean;
}

export default function PipelineInspector({
  symbol,
  onSymbolChange,
  interval,
  pollMs,
  onEvent,
  active,
}: PipelineInspectorProps) {
  const [draft, setDraft] = useState(symbol);
  const [capability, setCapability] = useState<Capability>("quote");
  const [raw, setRaw] = useState(true);
  const [tab, setTab] = useState<"rest" | "socket">("rest");
  const [result, setResult] = useState<InspectResponse | null>(null);
  const [resultKey, setResultKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const busySeq = useRef(0);
  const autoInspectKey = useRef<string | null>(null);
  const requestedInterval = capability === "bars" ? interval : null;
  const inspectionKey = `${symbol}:${capability}:${requestedInterval ?? "-"}:${raw ? "raw" : "normalised"}`;
  // The applicability gate, mirrored here so a request the registry would
  // refuse is never sent — not on the first load, and not on every poll after.
  // Fundamentals describe an issuer; a crypto pair has none, and tracing it
  // used to spend four provider calls per poll to be told so four times.
  const asset = classify(symbol);
  const inapplicable = !isApplicable(capability, asset);

  useEffect(() => setDraft(symbol), [symbol]);

  const inspect = useCallback(
    async (refresh: boolean, quiet: boolean) => {
      const current = ++sequence.current;
      if (!quiet) {
        // Tracked separately from the staleness cursor. Clearing on
        // `current === sequence.current` latches `busy` on forever whenever a
        // background poll starts while an interactive trace is in flight: the
        // poll bumps the cursor, the trace's finally sees a mismatch, and the
        // button stays "Tracing…" until the component remounts.
        busySeq.current = current;
        setBusy(true);
        setError(null);
      }
      const requestKey = inspectionKey;
      const startedAt = Date.now();
      try {
        const qs = new URLSearchParams({
          symbol,
          capability,
          // An unattended tick is background traffic and must be fenced out of
          // each provider's interactive reserve — the whole reason the Priority
          // type exists. Only a human pressing Trace, or the first load after a
          // symbol change, may spend into it.
          priority: quiet ? "background" : "interactive",
        });
        if (capability === "bars") qs.set("interval", interval);
        if (raw) qs.set("raw", "1");
        if (refresh) qs.set("refresh", "1");
        const response = await fetch(`/api/system/inspect?${qs}`, { cache: "no-store" });
        const body = await response.json().catch(() => ({}));
        // A stale response racing a newer request must not win the state.
        if (current !== sequence.current) return;
        if (!response.ok) {
          if (!quiet) setError((body as { error?: string }).error ?? `HTTP ${response.status}`);
          return;
        }
        setResult(body as InspectResponse);
        setResultKey(requestKey);
        setError(null);
        const eventFields: Record<string, string | number | boolean | null> = {
          symbol,
          capability,
          cache: (body as InspectResponse).cache.state,
        };
        if (capability === "bars") eventFields.interval = interval;
        onEvent(
          (body as InspectResponse).ok ? "info" : "warn",
          `inspect ${symbol} ${capability}${capability === "bars" ? ` ${interval}` : ""} — ${(body as InspectResponse).cache.state} in ${Date.now() - startedAt}ms`,
          eventFields,
        );
      } catch (err) {
        // A quiet refresh keeps the last good trace on screen. The timestamp
        // going stale is the honest signal; a panel that flashes into an error
        // banner every few seconds is not.
        if (current === sequence.current && !quiet) {
          setError(err instanceof Error ? err.message : "inspection failed");
        }
      } finally {
        if (!quiet && busySeq.current === current) setBusy(false);
      }
    },
    [symbol, capability, interval, raw, inspectionKey, onEvent],
  );

  useEffect(() => {
    if (!active || tab !== "rest") return;
    if (inapplicable) return;
    if (autoInspectKey.current === inspectionKey) return;
    autoInspectKey.current = inspectionKey;
    void inspect(false, false);
  }, [active, tab, inspect, inspectionKey, inapplicable]);

  usePolling({
    tick: () => inspect(false, true),
    intervalMs: pollMs ?? 0,
    maxBackoffMs: 300_000,
    enabled: active && tab === "rest" && Boolean(pollMs) && !inapplicable,
  });

  const submit = () => {
    const next = draft.trim().toUpperCase();
    if (/^[A-Z0-9.\-]{1,20}$/.test(next)) onSymbolChange(next);
    else setDraft(symbol);
  };

  const socketSupported = LIVE_SYMBOLS.has(symbol);
  // Sockets open only while the wire tap is on screen and the pair is covered.
  const snapshot = useLiveBook(symbol, active && tab === "socket" && socketSupported);
  const resultMatchesControls = result !== null && resultKey === inspectionKey;

  return (
    <div className="card console-card console-inspector">
      {/* portfolio-card-heading, like every other card on the Data surface —
          this was the last holdout on the non-card section grammar, so its
          title rendered at a different size from the equal-rank cards a reader
          had just left. */}
      <div className="portfolio-card-heading">
        <div>
          <span className="page-kicker">Live debug</span>
          <h2>Pipeline inspector</h2>
        </div>
        <span className="section-note">
          {symbol}{capability === "bars" ? ` at ${interval}` : ""}
        </span>
      </div>

      <div className="console-inspector__controls">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value.toUpperCase())}
          onKeyDown={(event) => event.key === "Enter" && submit()}
          onBlur={() => draft !== symbol && submit()}
          aria-label="Symbol to inspect"
          spellCheck={false}
        />
        <button
          type="button"
          onClick={() => void inspect(true, false)}
          disabled={busy || inapplicable}
          title={inapplicable ? inapplicableReason(capability, symbol, asset) : undefined}
        >
          {busy ? "Tracing…" : "Trace (bypass cache)"}
        </button>
      </div>
      {/* The price tag lives beside the button that pays it. Trace is the one
          control on this card that costs something real, so it stays visible
          with its cost stated rather than folded into a disclosure. */}
      <p className="console-trace-cost">
        Spends one interactive provider call.
      </p>

      <div className="seg console-seg" role="group" aria-label="Capability to inspect">
        {CAPABILITIES.map((item) => {
          const applies = isApplicable(item, asset);
          const scope = applicableAssets(item);
          return (
            <button
              key={item}
              type="button"
              aria-pressed={item === capability}
              onClick={() => setCapability(item)}
              title={applies ? undefined : `${item}: ${scope.join(", ")} only; ${symbol} is ${asset}`}
            >
              {item}
              {/* The word, not a colour: the chip stays selectable so the
                  reader can see the refusal explained, but says up front
                  that this symbol is not one it can answer for. */}
              {!applies && <small className="muted"> {scope.length === 1 ? `${scope[0]} only` : "n/a"}</small>}
            </button>
          );
        })}
      </div>

      <label className="console-check">
        <input type="checkbox" checked={raw} onChange={(event) => setRaw(event.target.checked)} />
        Retain raw upstream payloads
      </label>

      <div className="seg console-seg" role="group" aria-label="Inspector view">
        <button type="button" aria-pressed={tab === "rest"} onClick={() => setTab("rest")}>
          REST pipeline
        </button>
        <button type="button" aria-pressed={tab === "socket"} onClick={() => setTab("socket")}>
          WebSocket frames
        </button>
      </div>

      {error && (
        <div className="banner error" role="alert">
          <span aria-hidden>✕</span>
          <div>{error}</div>
        </div>
      )}

      {tab === "rest" && inapplicable && (
        // The refusal, explained where the trace would have been. Nothing was
        // sent, so there is no lineage to show — and no auto-poll to keep
        // re-sending it. Both buttons change desk-wide state, the same way the
        // symbol input above already does.
        <div className="banner warn" role="status">
          <span aria-hidden>!</span>
          <div>
            <strong>Not applicable.</strong> {inapplicableReason(capability, symbol, asset)}
            <div className="console-inspector__controls" style={{ marginTop: 8, marginBottom: 0 }}>
              {applicableAssets(capability).includes("equity") && (
                <button type="button" onClick={() => onSymbolChange(EQUITY_EXAMPLE)}>
                  Trace {EQUITY_EXAMPLE} instead
                </button>
              )}
              <button type="button" onClick={() => setCapability("quote")}>
                Back to quote
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === "rest" && !inapplicable && (
        <>
          {!resultMatchesControls && busy && <div className="skeleton" style={{ height: 160 }} />}
          {resultMatchesControls && result && (
            <RestTrace result={result} interval={requestedInterval ?? undefined} />
          )}
        </>
      )}

      {tab === "socket" && (
        <SocketTrace symbol={symbol} supported={socketSupported} snapshot={snapshot} />
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// REST trace
// --------------------------------------------------------------------------

function absoluteTimestamp(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  return new Date(parsed).toISOString().replace("T", " ").replace(".000Z", " UTC");
}

function RestTrace({ result, interval }: { result: InspectResponse; interval?: string }) {
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
            field-level transformation map, so the console does not infer one.
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

interface NewsRow {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  sentiment: number | null;
}

// --------------------------------------------------------------------------
// WebSocket wire tap
// --------------------------------------------------------------------------

function SocketTrace({
  symbol,
  supported,
  snapshot,
}: {
  symbol: string;
  supported: boolean;
  snapshot: ReturnType<typeof useLiveBook>;
}) {
  if (!supported) {
    return (
      <p className="muted console-empty">
        {symbol} has no streaming venue coverage. The wire tap follows the browser&apos;s direct
        Binance and Bybit sockets, which carry the Execution tab&apos;s pairs.
      </p>
    );
  }
  if (!snapshot) {
    return <div className="skeleton" style={{ height: 140 }} />;
  }

  return (
    <>
      {snapshot.venues.map((venue) => (
        <div className="console-socket" key={venue.venue}>
          <div className="console-socket__head">
            <strong>{venue.venue}</strong>
            <span
              style={{
                color:
                  venue.status === "live"
                    ? "var(--success-text)"
                    : venue.status === "stale"
                      ? "var(--warning-text)"
                      : venue.status === "error"
                        ? "var(--critical-text)"
                        : "var(--text-secondary)",
              }}
            >
              <span aria-hidden>
                {venue.status === "live" ? "●" : venue.status === "stale" ? "▲" : venue.status === "error" ? "✕" : "◌"}
              </span>{" "}
              {venue.status}
            </span>
          </div>
          <dl className="console-facts console-facts--tight">
            <div>
              <dt>Frames</dt>
              <dd>{venue.frames}</dd>
            </div>
            <div>
              <dt>Books published</dt>
              <dd>{venue.updates}</dd>
            </div>
            <div>
              <dt>Reconnects</dt>
              <dd>{venue.reconnects}</dd>
            </div>
            <div>
              <dt>Forced restarts</dt>
              <dd>{venue.restarts}</dd>
            </div>
          </dl>
          {venue.lastFrame !== undefined ? (
            <details>
              <summary>
                Last raw frame
                {venue.lastFrameAt && (
                  <span className="muted"> at {new Date(venue.lastFrameAt).toLocaleTimeString()}</span>
                )}
              </summary>
              <JsonTree value={venue.lastFrame} initialDepth={2} />
            </details>
          ) : (
            <p className="muted console-empty">No frame received yet.</p>
          )}
        </div>
      ))}
      {/* Capture provenance is static documentation of how the tap works, so
          it folds; the per-venue counts above are the live evidence and stay
          in the open. */}
      <details className="disclosure">
        <summary>Where these frames are captured</summary>
        <p className="console-footnote">
          These frames arrive in the browser: a serverless function cannot hold a subscription open.
          They are captured client-side and never appear in the server trace.
        </p>
      </details>
    </>
  );
}
