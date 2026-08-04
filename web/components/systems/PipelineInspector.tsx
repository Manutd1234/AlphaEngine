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
import { SYMBOLS } from "@/lib/venues";

const CAPABILITIES = ["quote", "bars", "news", "fundamentals"] as const;
type Capability = (typeof CAPABILITIES)[number];

const LIVE_SYMBOLS = new Set<string>(SYMBOLS);

interface PipelineInspectorProps {
  symbol: string;
  onSymbolChange: (symbol: string) => void;
  /** Console-wide poll cadence; 0 means paused. */
  pollMs: number;
  onEvent: (level: "info" | "warn" | "error", message: string, fields?: Record<string, string | number | boolean | null>) => void;
}

export default function PipelineInspector({
  symbol,
  onSymbolChange,
  pollMs,
  onEvent,
}: PipelineInspectorProps) {
  const [draft, setDraft] = useState(symbol);
  const [capability, setCapability] = useState<Capability>("quote");
  const [raw, setRaw] = useState(true);
  const [tab, setTab] = useState<"rest" | "socket">("rest");
  const [result, setResult] = useState<InspectResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const busySeq = useRef(0);

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
      }
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
        setError(null);
        onEvent(
          (body as InspectResponse).ok ? "info" : "warn",
          `inspect ${symbol} ${capability} — ${(body as InspectResponse).cache.state} in ${Date.now() - startedAt}ms`,
          { symbol, capability, cache: (body as InspectResponse).cache.state },
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
    [symbol, capability, raw, onEvent],
  );

  useEffect(() => {
    void inspect(false, false);
  }, [inspect]);

  useEffect(() => {
    if (!pollMs) return;
    const timer = setInterval(() => {
      if (!document.hidden) void inspect(false, true);
    }, pollMs);
    return () => clearInterval(timer);
  }, [pollMs, inspect]);

  const submit = () => {
    const next = draft.trim().toUpperCase();
    if (/^[A-Z0-9.\-]{1,20}$/.test(next)) onSymbolChange(next);
    else setDraft(symbol);
  };

  const socketSupported = LIVE_SYMBOLS.has(symbol);
  // Sockets open only while the wire tap is on screen and the pair is covered.
  const snapshot = useLiveBook(symbol, tab === "socket" && socketSupported);

  return (
    <div className="card console-card console-inspector">
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">Live debug</span>
          <h2>Pipeline inspector</h2>
        </div>
        <span className="section-note">{symbol}</span>
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
        <button type="button" onClick={() => void inspect(true, false)} disabled={busy}>
          {busy ? "Tracing…" : "Trace (bypass cache)"}
        </button>
      </div>

      <div className="seg console-seg" role="group" aria-label="Capability to inspect">
        {CAPABILITIES.map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={item === capability}
            onClick={() => setCapability(item)}
          >
            {item}
          </button>
        ))}
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

      {tab === "rest" && (
        <>
          {!result && busy && <div className="skeleton" style={{ height: 160 }} />}
          {result && <RestTrace result={result} />}
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

function RestTrace({ result }: { result: InspectResponse }) {
  const cacheHit = result.cache.state === "hit";
  return (
    <>
      <dl className="console-facts">
        <div>
          <dt>State</dt>
          <dd style={{ color: cacheHit ? "var(--series-1)" : "var(--status-good)" }}>
            <span aria-hidden>{cacheHit ? "◆" : "↓"}</span>{" "}
            {cacheHit ? "cache hit (in-process)" : "cache miss — fetched upstream"}
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
          <dd>{cacheHit ? `${fmt(result.cache.ageMs / 1000, 1)}s` : "0s — freshly fetched"}</dd>
        </div>
        <div>
          <dt>Round trip</dt>
          <dd>{result.totalMs}ms</dd>
        </div>
      </dl>

      <p className="console-key">
        <span className="muted">key</span> <code>{result.cache.key}</code>
      </p>

      <p className="console-subhead">Lineage</p>
      <ol className="console-lineage">
        {result.lineage.map((stage) => (
          <li key={stage.stage}>
            <strong>{stage.stage}</strong>
            <small className="console-wrap">{stage.detail}</small>
          </li>
        ))}
      </ol>

      {result.attempts.length > 0 && (
        <>
          <p className="console-subhead">
            Skipped before the answer
            <small className="muted"> — every provider ranked above the one that served it.</small>
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
            <strong>No provider could answer.</strong> {result.error}
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
                <span style={{ color: call.ok ? "var(--status-good)" : "var(--status-critical)" }}>
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
                {item.publishedAt && ` · ${new Date(item.publishedAt).toLocaleString()}`}
                {/* null sentiment = not scored; only a real score renders */}
                {item.sentiment != null
                  && ` · sentiment ${item.sentiment >= 0 ? "+" : ""}${fmt(item.sentiment, 2)}`}
              </small>
            </li>
          ))}
          {result.data.length === 0 && (
            <li className="muted">The capability answered, with no stories for this symbol.</li>
          )}
        </ul>
      )}
      <details open={result.capability !== "news"}>
        <summary>{result.capability} after coercion</summary>
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
        Binance and Bybit sockets, which carry the pairs listed on the Execution tab.
      </p>
    );
  }
  if (!snapshot) {
    return <div className="skeleton" style={{ height: 140 }} />;
  }

  return (
    <>
      <p className="console-note">
        These frames arrive in the browser, not on the server — a serverless function cannot hold a
        subscription open. They are captured client-side and never appear in the server trace.
      </p>
      {snapshot.venues.map((venue) => (
        <div className="console-socket" key={venue.venue}>
          <div className="console-socket__head">
            <strong>{venue.venue}</strong>
            <span
              style={{
                color:
                  venue.status === "live"
                    ? "var(--status-good)"
                    : venue.status === "stale"
                      ? "var(--status-warning)"
                      : venue.status === "error"
                        ? "var(--status-critical)"
                        : "var(--text-muted)",
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
                  <span className="muted"> · {new Date(venue.lastFrameAt).toLocaleTimeString()}</span>
                )}
              </summary>
              <JsonTree value={venue.lastFrame} initialDepth={2} />
            </details>
          ) : (
            <p className="muted console-empty">No frame received yet.</p>
          )}
        </div>
      ))}
    </>
  );
}
