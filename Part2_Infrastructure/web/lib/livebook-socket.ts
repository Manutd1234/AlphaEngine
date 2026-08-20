"use client";

/**
 * One supervised venue socket: handshake, ladder, gap detection, backoff.
 *
 * Split out of `lib/livebook.ts` when that file passed 560 lines. The seam is
 * per-venue versus cross-venue: everything here is about keeping ONE exchange's
 * book correct, and everything left in `./livebook` is about merging the books
 * and answering questions across them.
 *
 * Feed choice mirrors the Python gateway:
 *  - **Binance** uses `@depth20@100ms`, a self-contained top-20 snapshot every
 *    100ms. The diff stream needs REST-snapshot reconciliation and silently
 *    corrupts the book if one message is dropped; the partial stream self-heals.
 *  - **Bybit** is sequence-tagged, so it is consumed as snapshot + delta. `u`
 *    increments by exactly 1 per delta; any other step is a gap and forces a
 *    resubscribe rather than trusting a book with holes.
 *
 * The `LiveVenueState` import is type-only, so the edge back to `./livebook` is
 * erased at compile time and the two modules share no runtime cycle.
 */

import { type SocketHandle, sockets } from "./socket-registry";
import {
  type Level,
  type VenueBook,
  type VenueName,
  bandImbalance,
  depthWithinBps,
  spreadBps,
} from "./venues";

import type { LiveVenueState } from "./livebook";

export const STALE_AFTER_MS = 8_000;
const MAX_BACKOFF_MS = 20_000;

export function emptyBook(venue: VenueName, symbol: string): VenueBook {
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

/** One supervised socket with exponential backoff + jitter. */
export function connect(
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
    id: sockets.nextId(),
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
      sockets.remove(handle.id);
    },
  };

  // Registered once, here — not inside `open()`, which runs again on every
  // reconnect and would leak one entry per retry.
  sockets.add(handle);

  open();

  return handle;
}
