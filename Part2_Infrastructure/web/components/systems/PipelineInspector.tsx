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
 *
 * The two renderers moved to `PipelineRestTrace` and `PipelineSocketTrace` when
 * this file passed the length ceiling. Every request, every piece of state and
 * both network gates — the applicability refusal and the `active && tab` guards
 * — stayed here; what left renders a payload and holds nothing.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import RestTrace from "@/components/systems/PipelineRestTrace";
import SocketTrace from "@/components/systems/PipelineSocketTrace";
import { type InspectResponse } from "@/components/systems/types";
import { useLiveBook } from "@/lib/livebook";
import { applicableAssets, inapplicableReason, isApplicable } from "@/lib/providers/capabilities";
import { marketCapabilitiesFor } from "@/lib/venues";
import { usePolling } from "@/lib/use-polling";

const CAPABILITIES = ["quote", "bars", "news", "fundamentals"] as const;
type Capability = (typeof CAPABILITIES)[number];

/** The equity the callout offers when a capability cannot answer for the desk symbol. */
const EQUITY_EXAMPLE = "AAPL";

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
  // The WebSocket tab explains the whole market path for an equity. Retain the
  // last successful quote inspection so selecting Bars and then opening the
  // socket tab does not erase real provider/freshness evidence.
  const [lastGoodQuote, setLastGoodQuote] = useState<InspectResponse | null>(null);
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
  const marketCapabilities = marketCapabilitiesFor(symbol);
  const asset = marketCapabilities.asset;
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
        const inspected = body as InspectResponse;
        setResult(inspected);
        if (inspected.ok && inspected.capability === "quote" && inspected.provenance) {
          setLastGoodQuote(inspected);
        }
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

  const socketSupported = marketCapabilities.directL2;
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
        <SocketTrace
          symbol={symbol}
          snapshot={snapshot}
          restQuote={lastGoodQuote?.symbol === symbol ? lastGoodQuote : null}
        />
      )}
    </div>
  );
}
