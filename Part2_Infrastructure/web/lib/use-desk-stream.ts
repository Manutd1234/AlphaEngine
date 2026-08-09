"use client";

/**
 * The desk's risk state, pushed as it changes.
 *
 * **This does not replace the poll, and that is deliberate.** `useBook` stays
 * the source of record. A stream is allowed to drop silently while it
 * reconnects, so anything that must be *complete* cannot be sourced from one —
 * the same rule `use-desk-tape.ts` states for the realtime decision tape. What
 * this removes is the sampling delay: the poll cadence was 4–15s against a book
 * the gateway re-marks every second, so most requests returned a number the
 * client already had and the ones that mattered arrived late.
 *
 * **`unavailable` is a state, never a frozen number.** A panel showing the last
 * value it received, with no indication the feed died, is the specific failure
 * this whole file exists to avoid: stale equity presented as live equity. When
 * the stream drops, the caller is told, and the poll underneath keeps the
 * numbers honest.
 *
 * **Sequence gaps are reported, not smoothed over.** Every event carries a
 * monotonic `seq`. If a reconnect resumes with a jump, `missed` says so — a UI
 * that cannot tell "nothing happened" from "I lost something" will eventually
 * show a gap as calm.
 */

import { useEffect, useRef, useState } from "react";

export type DeskStreamState =
  /** No gateway configured in this deployment. Not a fault. */
  | "unconfigured"
  /** Connecting, or reconnecting after a drop. */
  | "connecting"
  /** Subscribed; updates arrive as the desk changes. */
  | "live"
  /** The stream errored or was refused. Updates are being missed right now. */
  | "unavailable";

export interface DeskStreamSnapshot<T> {
  state: DeskStreamState;
  /** The most recent payload, or null before the first arrives. */
  data: T | null;
  /** When that payload arrived, for a freshness stamp. */
  at: Date | null;
  /** Sequence of the last event seen. */
  seq: number;
  /** True when a reconnect resumed past the expected next sequence. */
  missed: boolean;
}

/**
 * Browsers cap an origin at ~6 concurrent HTTP/1.1 connections, and a held-open
 * EventSource occupies one for as long as the tab lives. One stream per app,
 * shared by every panel, rather than one per component.
 */
export function useDeskStream<T = unknown>(enabled = true): DeskStreamSnapshot<T> {
  const [snapshot, setSnapshot] = useState<DeskStreamSnapshot<T>>({
    state: "connecting",
    data: null,
    at: null,
    seq: 0,
    missed: false,
  });
  const expectedSeq = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    // Guarded because EventSource does not exist during server rendering, and
    // this hook is imported by components that are.
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;

    const source = new EventSource("/api/stream/desk");

    const onRisk = (event: MessageEvent<string>) => {
      let parsed: T;
      try {
        parsed = JSON.parse(event.data) as T;
      } catch {
        // A malformed frame is a bug upstream, not a reason to tear down a
        // working connection — the next one is very likely fine.
        return;
      }
      const seq = Number(event.lastEventId || 0);
      // A jump means events were produced that this client will never receive.
      // Only ever true after the first event: the initial one legitimately
      // starts wherever the gateway's counter is.
      const missed = expectedSeq.current > 0 && seq > expectedSeq.current;
      expectedSeq.current = seq + 1;
      setSnapshot({ state: "live", data: parsed, at: new Date(), seq, missed });
    };

    const onOpen = () => {
      setSnapshot((current) => ({ ...current, state: "live" }));
    };

    const onError = () => {
      // EventSource reconnects on its own with its own backoff, so this does
      // not tear down. It reports the gap while it lasts and keeps whatever
      // data it had — clearing it would blank a panel that is about to recover.
      setSnapshot((current) => ({
        ...current,
        state: current.state === "live" ? "unavailable" : "connecting",
      }));
    };

    source.addEventListener("risk", onRisk as EventListener);
    source.addEventListener("open", onOpen);
    source.addEventListener("error", onError);

    return () => {
      source.removeEventListener("risk", onRisk as EventListener);
      source.removeEventListener("open", onOpen);
      source.removeEventListener("error", onError);
      source.close();
    };
  }, [enabled]);

  return snapshot;
}

/** One sentence naming what the reader is looking at. Mirrors `describeTape`. */
export function describeDeskStream(state: DeskStreamState, missed: boolean): string {
  switch (state) {
    case "unconfigured":
      return "Live updates are not configured in this deployment; the numbers below are polled.";
    case "connecting":
      return "Connecting to the live desk feed — the numbers below are polled until it opens.";
    case "unavailable":
      return "The live feed dropped. These numbers are polled and may lag by a few seconds.";
    case "live":
      return missed
        ? "Live. Some updates were missed during a reconnect — the polled values remain authoritative."
        : "Live — updates arrive as the desk changes.";
  }
}
