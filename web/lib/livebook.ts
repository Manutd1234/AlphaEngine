"use client";

/**
 * Streaming L2 order books, straight from the exchanges to the browser.
 * =====================================================================
 *
 * A serverless function cannot hold a WebSocket subscription open between
 * invocations, so the tick-by-tick feed does not go through the API at all — the
 * browser connects directly to Binance's and Bybit's public streams. No backend,
 * no API key, no CORS (the WebSocket handshake is not subject to it), and the
 * data arrives with one hop of latency instead of two.
 *
 * The REST routes (`/api/depth`, `/api/tca`) remain for snapshots, for callers
 * that are not a browser, and as the fallback when a socket cannot be opened.
 *
 * Feed choice mirrors the Python gateway:
 *  - **Binance** uses `@depth20@100ms`, a self-contained top-20 snapshot every
 *    100ms. The diff stream needs REST-snapshot reconciliation and silently
 *    corrupts the book if one message is dropped; the partial stream self-heals.
 *  - **Bybit** is sequence-tagged, so it is consumed as snapshot + delta. `u`
 *    increments by exactly 1 per delta; any other step is a gap and forces a
 *    resubscribe rather than trusting a book with holes.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  type Level,
  type Side,
  type VenueBook,
  type VenueName,
  bandImbalance,
  consolidatedMid,
  depthWithinBps,
  smartRoute,
  spreadBps,
  walkBook,
} from "./venues";

export interface LiveVenueState {
  venue: VenueName;
  status: "connecting" | "live" | "stale" | "error";
  book: VenueBook;
  updates: number;
  lastUpdate: number;
  reconnects: number;
  error?: string;
  /**
   * Raw frames received, including the ones that never become a book —
   * subscribe acknowledgements, pongs, and topics we filter out.
   *
   * Distinct from `updates` on purpose: a socket whose `frames` climbs while
   * `updates` sits still is subscribed to the wrong thing, and one number
   * cannot say that.
   */
  frames: number;
  /** The last parsed frame, exactly as the venue sent it. Treat as read-only. */
  lastFrame?: unknown;
  lastFrameAt?: number;
  /** Operator-forced re-handshakes, kept apart from failure-driven reconnects. */
  restarts: number;
}

export interface LiveSnapshot {
  symbol: string;
  venues: LiveVenueState[];
  merged: { bids: Level[]; asks: Level[] };
  consolidatedMid: number | null;
  spreadBps: number | null;
  depthUsdBid: number;
  depthUsdAsk: number;
  imbalance: number | null;
}

const STALE_AFTER_MS = 8_000;
const MAX_BACKOFF_MS = 20_000;

function emptyBook(venue: VenueName, symbol: string): VenueBook {
  return {
    venue,
    symbol,
    ok: false,
    latencyMs: 0,
    bids: [],
    asks: [],
    bestBid: null,
    bestAsk: null,
    mid: null,
    spreadBps: null,
    depthUsdBid: 0,
    depthUsdAsk: 0,
    imbalance: null,
  };
}

/** price -> size ladder, so deltas can remove a level by setting size 0. */
class Ladder {
  bids = new Map<number, number>();
  asks = new Map<number, number>();

  snapshot(bids: Level[], asks: Level[]) {
    this.bids = new Map(bids.filter(([, q]) => q > 0));
    this.asks = new Map(asks.filter(([, q]) => q > 0));
  }

  delta(bids: Level[], asks: Level[]) {
    for (const [p, q] of bids) q > 0 ? this.bids.set(p, q) : this.bids.delete(p);
    for (const [p, q] of asks) q > 0 ? this.asks.set(p, q) : this.asks.delete(p);
  }

  toBook(venue: VenueName, symbol: string, latencyMs: number): VenueBook {
    const bids = [...this.bids.entries()].sort((a, b) => b[0] - a[0]) as Level[];
    const asks = [...this.asks.entries()].sort((a, b) => a[0] - b[0]) as Level[];
    const bestBid = bids[0]?.[0] ?? null;
    const bestAsk = asks[0]?.[0] ?? null;
    const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : null;
    const db = depthWithinBps(bids, mid, "bid");
    const da = depthWithinBps(asks, mid, "ask");
    return {
      venue,
      symbol,
      ok: bids.length > 0 && asks.length > 0,
      latencyMs,
      bids,
      asks,
      bestBid,
      bestAsk,
      mid,
      spreadBps: spreadBps(bestBid, bestAsk),
      depthUsdBid: db,
      depthUsdAsk: da,
      imbalance: bandImbalance(bids, asks, mid),
    };
  }
}

type Handlers = {
  onBook: (book: VenueBook) => void;
  onStatus: (status: LiveVenueState["status"], error?: string) => void;
  onReconnect: () => void;
  /** Every parsed frame, before any venue-specific filtering. */
  onFrame?: (frame: unknown) => void;
  /** An operator-forced re-handshake, distinct from a failure reconnect. */
  onRestart?: () => void;
};

// --------------------------------------------------------------------------
// Socket registry
// --------------------------------------------------------------------------

/**
 * Every supervised socket this tab currently owns.
 *
 * It exists so the systems console can answer "how many sockets are actually
 * open, to what, and for how long" and can force a clean re-handshake — neither
 * of which was possible when a `connect()` closure was the only owner.
 *
 * Keyed by a unique incrementing id rather than by `venue:symbol`. React
 * StrictMode runs every effect mount → cleanup → mount in development, so two
 * sockets for the same venue and symbol exist briefly on every mount; a
 * composite key would have the second registration overwrite the first, and the
 * first's cleanup would then delete the *second's* entry.
 */
export interface SocketHandle {
  id: number;
  venue: VenueName;
  symbol: string;
  openedAt: number;
  restart(): void;
  stop(): void;
}

export interface SocketSummary {
  id: number;
  venue: VenueName;
  symbol: string;
  openedAt: number;
}

const registry = new Map<number, SocketHandle>();
const registryListeners = new Set<() => void>();
let socketSeq = 0;

/**
 * Recomputed only on lifecycle changes, never per frame.
 *
 * `useSyncExternalStore` requires a referentially stable snapshot between
 * notifications — returning a fresh array on every read is an infinite render
 * loop. Frame counters deliberately do not live here: they change ten times a
 * second per venue and already reach the UI through the hook's throttled 5 Hz
 * publish.
 */
let registrySnapshot: SocketSummary[] = [];

function publishRegistry(): void {
  registrySnapshot = [...registry.values()].map(({ id, venue, symbol, openedAt }) => ({
    id, venue, symbol, openedAt,
  }));
  for (const listener of registryListeners) listener();
}

const EMPTY_REGISTRY: SocketSummary[] = [];

/** Live socket inventory for this tab. Safe during SSR — it reports none. */
export function useSocketRegistry(): SocketSummary[] {
  return useSyncExternalStore(
    (listener) => {
      registryListeners.add(listener);
      return () => registryListeners.delete(listener);
    },
    () => registrySnapshot,
    () => EMPTY_REGISTRY,
  );
}

/**
 * Force every live socket to drop and re-handshake. Returns how many were cycled.
 *
 * Not implemented as `ws.close()` from outside: that path runs through `retry()`,
 * which makes the operator wait out the current backoff (up to 20s + jitter) and
 * increments the failure counter — so a deliberate action would read on screen
 * as an outage.
 */
export function restartAllSockets(): number {
  const handles = [...registry.values()];
  for (const handle of handles) handle.restart();
  return handles.length;
}

/** One supervised socket with exponential backoff + jitter. */
function connect(
  venue: VenueName,
  symbol: string,
  handlers: Handlers,
): SocketHandle {
  let ws: WebSocket | null = null;
  let closed = false;
  let backoff = 1000;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let stableTimer: ReturnType<typeof setTimeout> | null = null;
  const ladder = new Ladder();
  let seq = 0;

  const open = () => {
    if (closed) return;
    handlers.onStatus("connecting");

    const url =
      venue === "BINANCE"
        ? `wss://stream.binance.com:9443/stream?streams=${symbol.toLowerCase()}@depth20@100ms`
        : "wss://stream.bybit.com/v5/public/spot";

    try {
      ws = new WebSocket(url);
    } catch (err) {
      return retry((err as Error).message);
    }

    ws.onopen = () => {
      // Reset the backoff only once the socket has PROVEN stable. Resetting on
      // handshake alone defeats the ceiling on an accept-then-drop path: a proxy
      // or a flapping venue completes the upgrade, drops, and every retry starts
      // from 1s again — measured 54 reconnects in 60s instead of backing off.
      stableTimer = setTimeout(() => {
        backoff = 1000;
      }, 10_000);
      handlers.onStatus("live");
      if (venue === "BYBIT") {
        ws?.send(JSON.stringify({ op: "subscribe", args: [`orderbook.50.${symbol.toUpperCase()}`] }));
        // Bybit expects an application-level ping inside 30s.
        heartbeat = setInterval(() => ws?.send(JSON.stringify({ op: "ping" })), 20_000);
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        // Captured here, above every venue branch, because three early returns
        // sit below: the Binance `!d?.bids` guard, the Binance return after
        // onBook, and the Bybit topic filter. Capturing after any of them hides
        // the subscribe acknowledgement and the pong — which are precisely the
        // frames worth reading when a handshake is the thing that is wrong.
        handlers.onFrame?.(msg);

        if (venue === "BINANCE") {
          const d = msg.data ?? msg;
          if (!d?.bids) return;
          ladder.snapshot(
            d.bids.map(([p, q]: [string, string]) => [Number(p), Number(q)] as Level),
            d.asks.map(([p, q]: [string, string]) => [Number(p), Number(q)] as Level),
          );
          handlers.onBook(ladder.toBook(venue, symbol, 0));
          return;
        }

        if (!String(msg.topic ?? "").startsWith("orderbook.")) return;
        const data = msg.data ?? {};
        const bids: Level[] = (data.b ?? []).map(([p, q]: [string, string]) => [Number(p), Number(q)]);
        const asks: Level[] = (data.a ?? []).map(([p, q]: [string, string]) => [Number(p), Number(q)]);
        const u = Number(data.u ?? 0);

        if (msg.type === "snapshot") {
          ladder.snapshot(bids, asks);
        } else {
          // A sequence gap means the local book can no longer be trusted.
          //
          // Bybit increments `u` by exactly 1 per delta, so the check must be
          // `u !== seq + 1`. Testing `u < seq` only catches a *backward* jump,
          // which ordered TCP delivery makes impossible — it never fired once in
          // ~10k live messages, while a genuine forward gap fell straight through
          // to apply(). Deltas are the only source of level removals, so one
          // dropped frame leaves a permanently crossed book: a stale bid sits
          // above the real ask and the UI reports it as a cross-venue arbitrage.
          if (seq && u && u !== seq + 1) {
            ws?.close(); // force a fresh snapshot rather than trust a holed book
            return;
          }
          ladder.delta(bids, asks);
        }
        seq = u || seq;
        const latency = msg.ts ? Math.max(0, Date.now() - Number(msg.ts)) : 0;
        handlers.onBook(ladder.toBook(venue, symbol, latency));
      } catch {
        /* a malformed frame must not kill the socket */
      }
    };

    ws.onerror = () => handlers.onStatus("error", "socket error");
    ws.onclose = () => retry();
  };

  const retry = (error?: string) => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    if (stableTimer) clearTimeout(stableTimer);
    stableTimer = null;
    if (closed) return;
    handlers.onStatus("error", error);
    handlers.onReconnect();
    const wait = backoff + Math.random() * backoff * 0.3;
    retryTimer = setTimeout(open, wait);
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  };

  /**
   * Operator-forced reconnect. Every line here fixes something a naive
   * `ws.close(); open();` gets wrong:
   *
   *  - `retry()` clears the heartbeat and the stability timer but **never**
   *    `retryTimer`, because it assumes it is only ever called from a socket
   *    event. Leaving a pending retry and calling `open()` gives you two live
   *    sockets on one venue, both writing into one ladder.
   *  - Detaching the handlers before `close()` stops the dying socket's
   *    `onclose` from scheduling a *third*.
   *  - `backoff` resets: a reconnect someone asked for is not evidence of
   *    instability, and inheriting a 16s backoff would punish them for it.
   *  - `seq = 0`: Bybit's gap check is `u !== seq + 1`. Carrying the old
   *    session's sequence into a new one fails on the first delta and closes the
   *    socket, which looks exactly like a venue outage in a reconnect loop.
   *  - The ladder is emptied because republishing the pre-restart book would be
   *    a stale price wearing a fresh timestamp. The venue drops out of the
   *    merged book until its next snapshot; that gap is honest.
   */
  const restart = () => {
    if (closed) return;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
    if (stableTimer) { clearTimeout(stableTimer); stableTimer = null; }
    backoff = 1000;
    seq = 0;
    ladder.snapshot([], []);
    const dying = ws;
    ws = null;
    if (dying) {
      dying.onclose = null;
      dying.onerror = null;
      dying.onmessage = null;
      dying.onopen = null;
      dying.close();
    }
    handlers.onRestart?.();
    open();
  };

  const handle: SocketHandle = {
    id: ++socketSeq,
    venue,
    symbol,
    openedAt: Date.now(),
    restart,
    stop: () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (heartbeat) clearInterval(heartbeat);
      if (stableTimer) clearTimeout(stableTimer);
      // Detached before closing, exactly as `restart()` does. `close()` is
      // asynchronous: frames already queued still fire `onmessage` afterwards,
      // and those handlers close over the *previous* effect's state map. On a
      // symbol change that means the dying BTC socket writes a BTC book into the
      // new ADA state — or, once React has replaced the map, throws on the
      // non-null assertion in `state.current.get(venue)!`.
      const dying = ws;
      ws = null;
      if (dying) {
        dying.onclose = null;
        dying.onerror = null;
        dying.onmessage = null;
        dying.onopen = null;
        dying.close();
      }
      registry.delete(handle.id);
      publishRegistry();
    },
  };

  // Registered once, here — not inside `open()`, which runs again on every
  // reconnect and would leak one entry per retry.
  registry.set(handle.id, handle);
  publishRegistry();

  open();

  return handle;
}

/**
 * Subscribe to every venue for one symbol and get a merged, throttled snapshot.
 *
 * Updates arrive far faster than a screen can usefully show them, so state is
 * published on a fixed interval rather than per message — otherwise React
 * re-renders ~60×/s and the tab heats up for no readable gain.
 */
export function useLiveBook(symbol: string, enabled = true, publishHz = 5): LiveSnapshot | null {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const state = useRef<Map<VenueName, LiveVenueState>>(new Map());

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      setSnapshot(null);
      state.current.clear();
      return;
    }

    // Drop the previous instrument's book at once. The publish interval is the
    // only writer, so without this the old symbol's prices stay painted under
    // the new symbol's label for a full tick — BTC prices under an ADA button.
    setSnapshot(null);

    const venues: VenueName[] = ["BINANCE", "BYBIT"];
    state.current = new Map(
      venues.map((v) => [
        v,
        {
          venue: v,
          status: "connecting",
          book: emptyBook(v, symbol),
          updates: 0,
          lastUpdate: 0,
          reconnects: 0,
          frames: 0,
          restarts: 0,
        },
      ]),
    );

    const handles = venues.map((venue) =>
      connect(venue, symbol, {
        onBook: (book) => {
          const s = state.current.get(venue)!;
          s.book = book;
          s.updates += 1;
          s.lastUpdate = Date.now();
          s.status = "live";
        },
        onStatus: (status, error) => {
          const s = state.current.get(venue)!;
          if (s.status !== "live" || status !== "connecting") s.status = status;
          s.error = error;
        },
        onReconnect: () => {
          state.current.get(venue)!.reconnects += 1;
        },
        onFrame: (frame) => {
          // Written to the ref, never to state. Binance alone sends 10 frames a
          // second per venue; a setState here reinstates exactly the render
          // storm the 5 Hz publish interval exists to prevent. The publish tick
          // already spreads this object, so it reaches consumers for free.
          const s = state.current.get(venue)!;
          s.frames += 1;
          s.lastFrame = frame;
          s.lastFrameAt = Date.now();
        },
        onRestart: () => {
          const s = state.current.get(venue)!;
          s.restarts += 1;
          // Set directly rather than through `onStatus`, which refuses to
          // downgrade a live venue to "connecting" — correct for a silent
          // reconnect, wrong for one an operator just asked for and is watching.
          s.status = "connecting";
          s.error = undefined;
        },
      }),
    );

    const publish = setInterval(() => {
      const now = Date.now();
      const venueStates = [...state.current.values()].map((s) => ({
        ...s,
        // `lastUpdate` seeds at 0, and "live" is set on handshake — so without
        // the `updates > 0` guard every venue flashes amber "stale" between the
        // handshake and its first frame, when there is no book to be stale.
        status:
          s.status === "live" && s.updates > 0 && now - s.lastUpdate > STALE_AFTER_MS
            ? ("stale" as const)
            : s.status,
      }));

      // Only books that are both connected and fresh may price an order.
      const live = venueStates.filter((s) => s.status === "live" && s.book.ok).map((s) => s.book);

      const mergeSide = (side: "bids" | "asks"): Level[] => {
        const acc = new Map<number, number>();
        for (const b of live) for (const [p, q] of b[side]) acc.set(p, (acc.get(p) ?? 0) + q);
        const rows = [...acc.entries()] as Level[];
        rows.sort((a, z) => (side === "bids" ? z[0] - a[0] : a[0] - z[0]));
        return rows;
      };

      const bids = mergeSide("bids");
      const asks = mergeSide("asks");
      const mid = consolidatedMid(live);
      const db = depthWithinBps(bids, mid, "bid");
      const da = depthWithinBps(asks, mid, "ask");

      setSnapshot({
        symbol,
        venues: venueStates,
        merged: { bids, asks },
        consolidatedMid: mid,
        spreadBps: spreadBps(bids[0]?.[0] ?? null, asks[0]?.[0] ?? null),
        depthUsdBid: db,
        depthUsdAsk: da,
        imbalance: bandImbalance(bids, asks, mid),
      });
    }, 1000 / publishHz);

    return () => {
      clearInterval(publish);
      handles.forEach((handle) => handle.stop());
    };
  }, [symbol, enabled, publishHz]);

  return snapshot;
}

/**
 * Socket inventory plus the force-reconnect control, for the systems console.
 *
 * Read-only over the registry: it does not open anything of its own, so a panel
 * that renders this cannot change the socket count by being on screen. The
 * reconnect it exposes cycles whatever `useLiveBook` has already opened.
 */
export function useWireTap(): { sockets: SocketSummary[]; reconnectAll: () => number } {
  const sockets = useSocketRegistry();
  const reconnectAll = useCallback(() => restartAllSockets(), []);
  return { sockets, reconnectAll };
}

/** Client-side TCA off the streaming books — same maths as `/api/tca`. */
export function liveTca(snap: LiveSnapshot | null, side: Side, notional: number) {
  if (!snap) return null;
  const live = snap.venues.filter((v) => v.status === "live" && v.book.ok).map((v) => v.book);
  if (!live.length) return null;

  const mid = snap.consolidatedMid;
  const perVenue = live.map((b) => walkBook(side === "BUY" ? b.asks : b.bids, side, notional, b.mid, b.venue));
  const { legs, vwap } = smartRoute(live, side, notional);
  const slippageBps =
    vwap && mid ? (side === "BUY" ? ((vwap - mid) / mid) * 1e4 : ((mid - vwap) / mid) * 1e4) : null;

  const fillable = perVenue.filter((e) => e.fillable && e.vwap !== null);
  let savingUsd: number | null = null;
  if (fillable.length && vwap) {
    const worst = fillable.reduce((a, b) =>
      side === "BUY" ? (a.vwap! > b.vwap! ? a : b) : a.vwap! < b.vwap! ? a : b,
    );
    const diff = side === "BUY" ? worst.vwap! - vwap : vwap - worst.vwap!;
    savingUsd = (diff / worst.vwap!) * notional;
  }

  return { perVenue, legs, vwap, slippageBps, savingUsd, mid };
}
