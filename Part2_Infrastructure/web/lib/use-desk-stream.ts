"use client";

/**
 * The gateway's risk stream, as a change signal — one connection for the page.
 *
 * The desk's book, equity, drawdown and kill-switch state reached the browser
 * by polling at 4s, 5s and 15s against a book the gateway re-marks every
 * second, so the worst case was roughly sixteen seconds. **This is the
 * millisecond plane** — the network and the poll cadence — and nothing here
 * says anything about the microsecond decision or the nanosecond core; those
 * are measured elsewhere and must never be quoted under a label from this
 * file.
 *
 * **A signal, not a replacement payload.** The stream carries `RiskState`;
 * the panels poll `/api/gateway/portfolio`, which is a different and larger
 * shape. Rebuilding them around the stream's shape would mean two sources of
 * the same numbers that can disagree — the exact failure the reconciliation
 * tests exist to prevent. So the stream is used for what it is uniquely good
 * at: saying WHEN something changed. The poll still fetches the shape the UI
 * needs, and now fetches it because something moved rather than because a
 * timer expired.
 *
 * **The state arrives in-band.** An earlier version of this hook was deleted
 * because it could not reach its own unavailable state: `EventSource` exposes
 * neither status code nor body, so the proxy's 503 was invisible and the panel
 * read "connecting" forever on the deployment where no gateway is the normal
 * condition. The proxy answers 200 and says what it found in a `desk-state`
 * frame, which a client that cannot read status codes can still read.
 *
 * **One EventSource, refcounted, for however many consumers.** There are two
 * now (`useBook` and the execution cockpit) and the workspace keeps its panels
 * mounted behind `hidden`, so both are live at once. A connection per consumer
 * would open a second proxy route holding a second upstream gateway stream,
 * and browsers cap concurrent connections per origin — the polls underneath
 * would be the ones starved. The store below is the whole page's copy.
 *
 * **This module owns reconnection; `EventSource` does not.** Left alone it
 * retries roughly every three seconds, forever, with no backoff and no idea
 * whether anyone is looking at the tab — a poll wearing a push's clothes, and
 * the shape of the defect that once produced 1,542 requests in ten seconds
 * from one idle guest tab. So every error closes the connection and the
 * reconnect is driven by `PollingController`, which already gates on
 * `document.hidden`, backs off geometrically to a ceiling, revalidates when
 * the reader comes back and stops cleanly. Reusing it is also the only way the
 * curve is not implemented twice.
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

import type { RiskState } from "@/lib/gateway-contract.generated";
import { PollingController } from "@/lib/polling";

export type DeskStreamState = "connecting" | "live" | "unavailable";

/** How the value on screen last arrived. Two different freshness guarantees. */
export type Transport = "live-pushed" | "polled";

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

const CONNECTING: DeskStream = { state: "connecting", reason: null, seq: 0, risk: null };

/**
 * What a consumer that switched the stream off reads.
 *
 * Deliberately not `CONNECTING`: a sandbox book is not waiting for a stream,
 * and a surface that labelled it "connecting" would be describing a connection
 * nobody asked for. `polled` is the honest transport for it.
 */
const IDLE: DeskStream = { state: "unavailable", reason: "not_subscribed", seq: 0, risk: null };

const STREAM_URL = "/api/stream/desk";

/**
 * While the stream is up this tick costs nothing — it returns on the first
 * line of `connect`. It exists so a connection that died is noticed within a
 * few seconds rather than at the next poll.
 */
const RECONNECT_TICK_MS = 5_000;

/**
 * The first retry, on the gateway probe's reasoning rather than the tick's: a
 * gateway that has just come back has to be noticed in seconds, whatever the
 * healthy cadence happens to be.
 */
const FIRST_RETRY_MS = 2_500;

/**
 * A minute, not the five an append-only ledger gets. A stream backed off
 * further has stopped being a push and nothing on screen would say so — the
 * transport label would still read "polled", which is true, but the desk would
 * never find its way back to "live-pushed".
 */
const MAX_BACKOFF_MS = 60_000;

/**
 * How long the **handshake** may take. The stream itself is never deadlined.
 *
 * The proxy holds an upstream fetch open for the life of the stream, cancelled
 * by the browser disconnecting rather than by a timer — a deadline on that
 * fetch would kill a healthy connection the moment it fired. But a gateway
 * that accepts the connection and then says nothing leaves the proxy waiting
 * on headers, so no `desk-state` frame is ever emitted, and without this the
 * `connect` promise never settles: the reconnect loop sees a tick still in
 * flight and never runs again. The stream would be permanently dead with
 * nothing on screen saying so.
 *
 * Eight seconds, the gateway's own request budget: once it has given up there
 * is nothing left to wait for. Deliberately generous against the 2.5s the
 * probe helper uses — this is one connection for the page, not a request per
 * panel, and a slow-but-real stream is worth more than a fast retry.
 */
const HANDSHAKE_DEADLINE_MS = 8_000;

// ---- the one connection, and the store in front of it --------------------- //

let snapshot: DeskStream = CONNECTING;
let source: EventSource | null = null;
let loop: PollingController | null = null;
let subscribers = 0;
const listeners = new Set<() => void>();

function publish(next: DeskStream): void {
  snapshot = next;
  // Copied: a listener that unsubscribes in response would otherwise mutate
  // the set being iterated.
  for (const listener of [...listeners]) listener();
}

/**
 * Open the stream, or resolve immediately if it is already open.
 *
 * Resolves when the proxy has said it found a gateway; rejects when it has
 * said it did not, or when the connection could not be made. The controller
 * reads that verdict as its backoff — which is why the failure path must
 * reject rather than resolve quietly.
 */
function connect(): Promise<void> {
  if (source) return Promise.resolve();
  if (typeof EventSource === "undefined") return Promise.reject(new Error("no_eventsource"));

  return new Promise<void>((resolve, reject) => {
    const es = new EventSource(STREAM_URL);
    source = es;
    let settled = false;
    /** Cleared by the first frame either way. See HANDSHAKE_DEADLINE_MS. */
    let handshake: ReturnType<typeof setTimeout>;

    /** Tear the connection down and let the controller decide when to retry. */
    const fail = (reason: string) => {
      clearTimeout(handshake);
      es.close();
      // Only the live connection may move the shared state. A late handler on
      // a connection that has already been superseded — or released by the
      // last consumer unmounting — would otherwise leave the store reading
      // "unavailable" for whoever subscribes next, which is a stale answer
      // arrived at by a dead code path. The promise is still settled below, so
      // nothing is left hanging either way.
      if (source !== es) {
        if (!settled) { settled = true; reject(new Error(reason)); }
        return;
      }
      source = null;
      publish({ ...snapshot, state: "unavailable", reason });
      /**
       * "No gateway in this deployment" cannot change without a redeploy, so
       * retrying it on any curve is spending requests on a fact. The execution
       * cockpit stops its own poll for exactly this reason; this stops too,
       * and the polls underneath carry the desk as they already did.
       */
      if (reason === "gateway_not_configured") loop?.stop();
      if (settled) return;
      settled = true;
      reject(new Error(reason));
    };

    const up = (next: DeskStream) => {
      clearTimeout(handshake);
      // Same rule as `fail`: a superseded connection may not move the store.
      if (source === es) publish(next);
      if (settled) return;
      settled = true;
      resolve();
    };

    es.addEventListener("desk-state", (event) => {
      let body: { state?: string; reason?: string };
      try {
        body = JSON.parse((event as MessageEvent).data);
      } catch {
        fail("unreadable_state_frame");
        return;
      }
      if (body.state === "ok") up({ ...snapshot, state: "live", reason: null });
      else fail(body.reason ?? "gateway_unavailable");
    });

    es.addEventListener("risk", (event) => {
      const message = event as MessageEvent;
      try {
        const risk = JSON.parse(message.data) as RiskState;
        // `lastEventId` is the gateway's `id:` line. Falling back to the seq
        // already held keeps it monotonic rather than resetting it to zero,
        // which a consumer reads as "nothing has arrived yet".
        up({ state: "live", reason: null, seq: Number(message.lastEventId) || snapshot.seq, risk });
      } catch {
        // A frame that will not parse is not a reason to tear the stream down;
        // the next one usually parses, and the poll is still underneath.
      }
    });

    // Closed rather than left to EventSource's own retry — see the header.
    es.onerror = () => fail(settled ? "stream_dropped" : "stream_unreachable");

    // Started last, so every handler that can clear it already exists.
    handshake = setTimeout(() => fail("stream_handshake_timeout"), HANDSHAKE_DEADLINE_MS);
  });
}

/** Register a listener, opening the shared connection for the first one. */
function join(listener: () => void): () => void {
  listeners.add(listener);
  subscribers += 1;
  if (subscribers === 1) {
    loop = new PollingController({
      tick: connect,
      intervalMs: RECONNECT_TICK_MS,
      firstRetryMs: FIRST_RETRY_MS,
      maxBackoffMs: MAX_BACKOFF_MS,
      // The first attempt has to count towards the backoff. Connecting outside
      // the loop would make the attempt after a failure wait the healthy tick
      // rather than the retry floor.
      immediate: true,
    });
    loop.start();
  }
  return () => {
    listeners.delete(listener);
    subscribers -= 1;
    if (subscribers > 0) return;
    // Last consumer gone: stop cleanly. Not left running for a remount — a
    // stream nobody is reading is the gateway generating state for nobody.
    loop?.stop();
    loop = null;
    source?.close();
    source = null;
    snapshot = CONNECTING;
  };
}

const readShared = () => snapshot;
const readIdle = () => IDLE;

/**
 * Subscribe to the shared stream.
 *
 * `enabled` is a real switch, not a hint: a consumer that passes false neither
 * holds the connection open nor reads its state.
 */
export function useDeskStream(enabled = true): DeskStream {
  const subscribe = useCallback(
    (listener: () => void) => (enabled ? join(listener) : () => {}),
    [enabled],
  );
  // The server pass has no stream and must not claim one, so it renders IDLE
  // and hydration matches.
  return useSyncExternalStore(subscribe, enabled ? readShared : readIdle, readIdle);
}

/**
 * Refetch whenever the gateway says the risk state moved.
 *
 * Written once because both consumers need exactly this and a second copy
 * would be a second place for the seq bookkeeping to go wrong. `refresh` is
 * read through a ref so an inline arrow at the call site does not re-fire the
 * effect on every render — the trigger is the sequence number moving, and
 * nothing else.
 *
 * Returns the stream so the caller can say which transport is live.
 */
export function useStreamedRefresh(
  refresh: () => void | Promise<unknown>,
  enabled = true,
): DeskStream {
  const stream = useDeskStream(enabled);
  const seen = useRef(0);
  const latest = useRef(refresh);
  latest.current = refresh;

  useEffect(() => {
    // seq 0 is "nothing has arrived yet", not a change.
    if (!enabled || stream.state !== "live" || !stream.seq) return;
    if (stream.seq === seen.current) return;
    seen.current = stream.seq;
    void latest.current();
  }, [enabled, stream.state, stream.seq]);

  return stream;
}

/**
 * The word a surface uses for how its numbers arrived.
 *
 * One function because two surfaces say it and they must say the same thing.
 * "Pushed" and "polled" are different freshness guarantees — about a second
 * against up to fifteen — and a desk that implies the better one while
 * delivering the worse one is this codebase's central defect in miniature.
 */
export function transportLabel(state: DeskStreamState): Transport {
  return state === "live" ? "live-pushed" : "polled";
}
