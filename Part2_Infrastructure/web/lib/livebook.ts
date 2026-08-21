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
 * Feed choice mirrors the Python gateway, and the argument for it now sits with
 * the code it justifies: `./livebook-socket` holds one supervised venue socket —
 * handshake, ladder, sequence-gap detection, backoff — lifted out when this file
 * passed 560 lines. What is left here is the cross-venue half: merge the books,
 * throttle the publish, and answer questions no single venue can (consolidated
 * mid, dislocation, smart-routed TCA).
 */

import { useEffect, useRef, useState } from "react";

import { type SocketHandle, sockets } from "./socket-registry";
import { THROTTLE_INTERVAL_MS } from "./use-throttled-value";
import {
  type Level,
  type Side,
  type SmartRouteOptions,
  type VenueBook,
  type VenueName,
  bandImbalance,
  consolidatedMid,
  depthWithinBps,
  findDislocation,
  passiveQuote,
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

// --------------------------------------------------------------------------
// Socket supervision
// --------------------------------------------------------------------------
//
// The per-venue half — handshake, ladder, sequence-gap detection, exponential
// backoff — is `./livebook-socket`, lifted out when this file passed 560 lines.
// `connect` is not re-exported: it is an implementation detail of `useLiveBook`
// and nothing outside these two modules has ever called it.

import { connect, emptyBook } from "./livebook-socket";
import { VenueLiveness } from "./venue-liveness";

// --------------------------------------------------------------------------
// Socket registry
// --------------------------------------------------------------------------
//
// The inventory of open sockets, its listener set, its id counter and its
// snapshot cache were four module-level bindings here; they are now
// `SocketRegistry` in `lib/socket-registry.ts`, which is the only thing that
// can update them and cannot update them separately. Re-exported so the
// systems console and `use-system-health.ts` keep importing them from the
// module that opens the sockets.

export { restartAllSockets, sockets, useSocketRegistry, useWireTap } from "./socket-registry";
export type { SocketHandle, SocketSummary } from "./socket-registry";

/**
 * The default publish cadence, expressed as the desk's shared throttle window.
 *
 * It was a bare `5`, i.e. a repaint every 200ms, and the metric tiles it feeds
 * — consolidated mid, spread, depth, imbalance — visibly twitched at that rate.
 * Derived from `THROTTLE_INTERVAL_MS` rather than tuned separately so the live
 * book and every value passed through `useThrottledValue` settle on one rhythm,
 * and so changing that rhythm is one edit rather than a hunt for literals.
 */
const PUBLISH_HZ = 1_000 / THROTTLE_INTERVAL_MS;

/**
 * Subscribe to every venue for one symbol and get a merged, throttled snapshot.
 *
 * Updates arrive far faster than a screen can usefully show them, so state is
 * published on a fixed interval rather than per message — otherwise React
 * re-renders ~60×/s and the tab heats up for no readable gain.
 *
 * The publish tick IS the throttle, and it is the leading-and-trailing kind:
 * whatever the ladders hold when it fires is what goes out, so a burst
 * coalesces to its latest value rather than queueing, and the final book after
 * a burst stops is published by the next tick rather than being lost. Nothing
 * is layered on top of it — a second buffer over this one would add a window
 * of latency to a live order book and buy no fewer renders.
 */
export function useLiveBook(symbol: string, enabled = true, publishHz = PUBLISH_HZ): LiveSnapshot | null {
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
    /*
     * One liveness machine per venue, rebuilt with the state map.
     *
     * The live/stale decision used to be an inline expression in the publish
     * tick below — see `lib/venue-liveness.ts` for the oscillation that
     * produced and why coming back is gated while going stale is not.
     */
    const liveness = new Map(venues.map((v) => [v, new VenueLiveness()]));
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
          liveness.get(venue)!.update(s.lastUpdate);
        },
        onStatus: (status, error) => {
          const s = state.current.get(venue)!;
          if (s.status !== "live" || status !== "connecting") s.status = status;
          s.error = error;
          liveness.get(venue)!.transport(status);
        },
        onReconnect: () => {
          state.current.get(venue)!.reconnects += 1;
        },
        onFrame: (frame) => {
          // Written to the ref, never to state. Binance alone sends 10 frames a
          // second per venue; a setState here reinstates exactly the render
          // storm the publish interval exists to prevent. The publish tick
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
          liveness.get(venue)!.restart();
        },
      }),
    );

    const publish = setInterval(() => {
      const now = Date.now();
      const venueStates = [...state.current.values()].map((s) => ({
        ...s,
        // Asked, not recomputed. The rule — and the "no ladder yet" guard that
        // stops a venue flashing stale between handshake and first book — lives
        // in `VenueLiveness`, with hysteresis this expression never had.
        status: liveness.get(s.venue)!.statusAt(now),
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
 * Client-side TCA off the streaming books — same maths as `/api/tca`.
 *
 * `opts` are what-if constraints (see `smartRoute`): they narrow this estimate
 * for analysis and route nothing. Omitted, this is the parity path.
 */
export function liveTca(
  snap: LiveSnapshot | null,
  side: Side,
  notional: number,
  opts?: SmartRouteOptions,
) {
  if (!snap) return null;
  const live = snap.venues.filter((v) => v.status === "live" && v.book.ok).map((v) => v.book);
  if (!live.length) return null;

  const mid = snap.consolidatedMid;
  // Excluded venues still get walked: the table marks them excluded rather
  // than dropping rows, so a toggle's effect stays visible.
  const perVenue = live.map((b) => walkBook(side === "BUY" ? b.asks : b.bids, side, notional, b.mid, b.venue));
  const included = opts?.venues ? live.filter((b) => opts.venues!.includes(b.venue)) : live;
  const { legs, vwap, filledNotional, cappedBy } = smartRoute(
    live,
    side,
    notional,
    opts ? { ...opts, mid: opts.mid ?? mid } : undefined,
  );
  const slippageBps =
    vwap && mid ? (side === "BUY" ? ((vwap - mid) / mid) * 1e4 : ((mid - vwap) / mid) * 1e4) : null;

  // A saving measured against a venue you excluded is not one you realised.
  // Widened to string: walkBook's estimates carry a plain venue label.
  const includedVenues = new Set<string>(included.map((b) => b.venue));
  const fillable = perVenue
    .filter((e) => e.fillable && e.vwap !== null)
    .filter((e) => includedVenues.has(e.venue));
  let savingUsd: number | null = null;
  if (fillable.length && vwap) {
    const worst = fillable.reduce((a, b) =>
      side === "BUY" ? (a.vwap! > b.vwap! ? a : b) : a.vwap! < b.vwap! ? a : b,
    );
    const diff = side === "BUY" ? worst.vwap! - vwap : vwap - worst.vwap!;
    savingUsd = (diff / worst.vwap!) * notional;
  }

  // Costs one comparison over books already in hand. Deliberately fed the
  // *unfiltered* venue list so a book that is present but stale is excluded by
  // the same `ok` rule the detector applies to the REST path, rather than by a
  // second rule here that could drift from it.
  const dislocation = findDislocation(
    snap.venues.filter((v) => v.status === "live").map((v) => v.book),
    snap.symbol,
  );

  return {
    perVenue,
    legs,
    vwap,
    slippageBps,
    savingUsd,
    mid,
    dislocation,
    requestedNotional: notional,
    filledNotional,
    cappedBy,
    excludedVenues: live
      .filter((b) => !includedVenues.has(b.venue))
      .map((b) => b.venue as string),
    /** The alternative to crossing: join the touch. Price if filled, no more. */
    passive: passiveQuote(included, side, mid),
  };
}
