"use client";

/**
 * The WebSocket half of the pipeline inspector.
 *
 * Split out of `PipelineInspector` when that file passed the length ceiling.
 * These frames never reach the server — the browser subscribes to the exchanges
 * directly — so they are captured client-side and labelled as such. The
 * inspector still owns the subscription and opens it only while this tab is on
 * screen; this component reads the snapshot and renders it.
 */

import JsonTree from "@/components/systems/JsonTree";
import { type InspectResponse } from "@/components/systems/types";
import { fmt, priceDp } from "@/lib/format";
import { useLiveBook } from "@/lib/livebook";
import { marketCapabilitiesFor } from "@/lib/venues";

function absoluteTimestamp(value: string | null): string {
  if (!value) return "— not observed";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "— invalid timestamp";
  return new Date(parsed).toISOString().replace("T", " ").replace(".000Z", " UTC");
}

export default function SocketTrace({
  symbol,
  snapshot,
  restQuote,
}: {
  symbol: string;
  snapshot: ReturnType<typeof useLiveBook>;
  /** Last successful quote trace for this symbol, retained by the inspector. */
  restQuote: InspectResponse | null;
}) {
  const capabilities = marketCapabilitiesFor(symbol);

  if (!capabilities.directL2 && capabilities.asset === "equity") {
    const normalised = restQuote?.data && typeof restQuote.data === "object"
      ? restQuote.data as Record<string, unknown>
      : null;
    const rawPrice = Number(normalised?.price);
    const price = Number.isFinite(rawPrice) && rawPrice > 0 ? rawPrice : null;
    const currency = typeof normalised?.currency === "string" ? normalised.currency : "USD";
    const dataAsOf = typeof normalised?.asOf === "string" ? normalised.asOf : null;
    const observedAt = dataAsOf ?? restQuote?.provenance?.fetchedAt ?? null;
    const provider = restQuote?.provenance?.label ?? null;

    return (
      <>
        <p className="console-subhead">Market-path coverage for {symbol}</p>
        <dl className="console-facts" aria-label={`${symbol} transport capabilities`}>
          <div>
            <dt>REST quote</dt>
            <dd>
              {price === null
                ? capabilities.restQuote ? "Route supported — inspect in REST" : "Not supported"
                : `${currency} ${fmt(price, priceDp(price))}`}
            </dd>
          </div>
          <div>
            <dt>Provider</dt>
            <dd>{provider ?? "— run a REST quote trace"}</dd>
          </div>
          <div>
            <dt>Quote freshness</dt>
            <dd>
              {observedAt ? <time dateTime={observedAt}>{absoluteTimestamp(observedAt)}</time> : "— not observed"}
              {restQuote?.provenance
                ? `; ${restQuote.provenance.delayed ? "delayed/EOD tier" : "current tier"}`
                : ""}
            </dd>
          </div>
          <div>
            <dt>Paper order route</dt>
            <dd>{capabilities.paperMarketOrder ? "MARKET; server-verified quote" : "Not supported"}</dd>
          </div>
          <div className="console-facts__span">
            <dt>Direct WebSocket / L2</dt>
            <dd>Not provisioned for equities; no socket opened</dd>
          </div>
        </dl>
        <div className="banner context-change">
          <span aria-hidden>i</span>
          <div>
            <strong>No failed {symbol} socket is hidden here.</strong> Binance and Bybit carry the crypto books;
            this deployment has no licensed equity L2 adapter. Use the REST pipeline above for provider,
            cache and raw-payload evidence.
          </div>
        </div>
      </>
    );
  }

  if (!capabilities.directL2) {
    return (
      <p className="muted console-empty">
        {symbol} has no streaming venue coverage. The wire tap follows the browser&apos;s direct
        Binance and Bybit sockets.
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
                <span>
                  Last raw frame
                  {venue.lastFrameAt && (
                    <span className="muted"> at {new Date(venue.lastFrameAt).toLocaleTimeString()}</span>
                  )}
                </span>
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
          These frames arrive in the browser: a serverless function cannot hold a subscription
          open, so they never appear in the server trace.
        </p>
      </details>
    </>
  );
}
