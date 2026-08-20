"use client";

/**
 * The gateway's risk stream, as a change signal.
 *
 * The desk's equity, drawdown and kill-switch state reach the browser by
 * polling at 4s, 5s and 15s against a book the gateway re-marks every second.
 * `docs/LATENCY_BUDGET.md` measured the resulting worst case at roughly 16
 * seconds and recorded that the fix was ordered: split the recompute first
 * (done, the 1s tick), then the transport. This is the transport.
 *
 * **A signal, not a replacement payload.** The stream carries `RiskState`;
 * `useBook` polls `/api/gateway/portfolio`, which is a different and larger
 * shape. Rebuilding the panels around the stream's shape would mean two
 * sources of the same numbers that can disagree — the exact failure the
 * reconciliation tests exist to prevent. So the stream is used for what it is
 * uniquely good at: saying WHEN something changed. The poll still fetches the
 * shape the UI needs, and now fetches it because something moved rather than
 * because a timer expired.
 *
 * **The state arrives in-band.** The earlier version of this hook was deleted
 * because it could not reach its own `unconfigured` state: `EventSource`
 * exposes neither status code nor body, so the proxy's 503 was invisible and
 * the panel would have read "connecting" forever on the deployment where no
 * gateway is the normal condition. The proxy answers 200 and says what it
 * found in a `desk-state` frame, which a client that cannot read status codes
 * can still read.
 */

import { useEffect, useRef, useState } from "react";

import type { RiskState } from "@/lib/gateway-contract.generated";

export type DeskStreamState = "connecting" | "live" | "unavailable";

export interface DeskStream {
  state: DeskStreamState;
  /** Why the stream is unavailable, when it is. Never invented. */
  reason: string | null;
  /**
   * Monotonic counter from the gateway, incremented only when the risk state
   * actually changed. A consumer watching this refetches on change rather than
   * on a timer; an idle desk moves it not at all.
   */
  seq: number;
  /** The most recent risk state, when one has arrived. Null is not zero. */
  risk: RiskState | null;
}

const INITIAL: DeskStream = { state: "connecting", reason: null, seq: 0, risk: null };

export function useDeskStream(enabled = true): DeskStream {
  const [stream, setStream] = useState<DeskStream>(INITIAL);
  /** The live EventSource, so a closed one is never reopened by a re-render. */
  const source = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") return;

    const es = new EventSource("/api/stream/desk");
    source.current = es;

    es.addEventListener("desk-state", (event) => {
      try {
        const body = JSON.parse((event as MessageEvent).data) as { state?: string; reason?: string };
        if (body.state === "ok") {
          setStream((prev) => ({ ...prev, state: "live", reason: null }));
          return;
        }
        setStream((prev) => ({ ...prev, state: "unavailable", reason: body.reason ?? null }));
        // Close rather than let EventSource reconnect every ~3s against a
        // deployment that has told us plainly there is nothing to stream. The
        // caller falls back to polling, which is what it was already doing.
        es.close();
      } catch {
        setStream((prev) => ({ ...prev, state: "unavailable", reason: "unreadable_state_frame" }));
        es.close();
      }
    });

    es.addEventListener("risk", (event) => {
      const message = event as MessageEvent;
      try {
        const risk = JSON.parse(message.data) as RiskState;
        const seq = Number(message.lastEventId) || 0;
        setStream((prev) => ({ state: "live", reason: null, seq, risk }));
      } catch {
        // A frame that will not parse is not a reason to tear the stream down;
        // the next one usually parses, and the poll is still underneath.
      }
    });

    es.onerror = () => {
      // EventSource reconnects on its own, and its `readyState` is the only
      // thing it tells us. CLOSED means it has given up.
      if (es.readyState === EventSource.CLOSED) {
        setStream((prev) => ({ ...prev, state: "unavailable", reason: "stream_closed" }));
      }
    };

    return () => {
      es.close();
      source.current = null;
      setStream(INITIAL);
    };
  }, [enabled]);

  return stream;
}
