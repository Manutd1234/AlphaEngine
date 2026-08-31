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
import { useLiveBook } from "@/lib/livebook";

export default function SocketTrace({
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
