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

import { useEffect, useRef, useState } from "react";

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
};

/** One supervised socket with exponential backoff + jitter. */
function connect(
  venue: VenueName,
  symbol: string,
  handlers: Handlers,
): () => void {
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

  open();

  return () => {
    closed = true;
    if (retryTimer) clearTimeout(retryTimer);
    if (heartbeat) clearInterval(heartbeat);
    if (stableTimer) clearTimeout(stableTimer);
    ws?.close();
  };
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
        { venue: v, status: "connecting", book: emptyBook(v, symbol), updates: 0, lastUpdate: 0, reconnects: 0 },
      ]),
    );

    const stops = venues.map((venue) =>
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
      stops.forEach((stop) => stop());
    };
  }, [symbol, enabled, publishHz]);

  return snapshot;
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
