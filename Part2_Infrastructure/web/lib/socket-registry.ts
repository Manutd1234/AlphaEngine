"use client";

/**
 * Every supervised WebSocket this tab currently owns.
 *
 * It exists so the systems console can answer "how many sockets are actually
 * open, to what, and for how long" and can force a clean re-handshake — neither
 * of which was possible when a `connect()` closure was the only owner.
 *
 * ── Why it is a class, and why it moved out of `livebook.ts` ────────────────
 * It was four module-level bindings sitting between the socket types and the
 * supervisor: a `Map`, a `Set` of listeners, a `let socketSeq`, and a
 * `let registrySnapshot` that a free `publishRegistry()` had to be remembered
 * at each of the three lifecycle sites. Three of those four are only correct
 * *together* — the snapshot is a cache of the map, and it is stale between the
 * `registry.set()` and the `publishRegistry()` on the next line. Nothing in the
 * old shape said so, and nothing stopped a fourth call site adding a socket and
 * forgetting to publish, which shows up as a console reporting one fewer socket
 * than the tab has open and no error anywhere.
 *
 * With an owner the map and its snapshot cannot be updated separately: `add`
 * and `remove` publish, and the snapshot is private. The counter goes with them
 * because it is what the map is keyed by.
 *
 * ── Keyed by id, not by venue+symbol ────────────────────────────────────────
 * React StrictMode runs every effect mount → cleanup → mount in development, so
 * two sockets for the same venue and symbol exist briefly on every mount; a
 * composite key would have the second registration overwrite the first, and the
 * first's cleanup would then delete the *second's* entry.
 */

import { useCallback, useSyncExternalStore } from "react";

import { type VenueName } from "./venues";

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

/** Stable across reads, which is what SSR and an empty registry both need. */
const EMPTY_REGISTRY: SocketSummary[] = [];

export class SocketRegistry {
  private readonly handles = new Map<number, SocketHandle>();
  private readonly listeners = new Set<() => void>();
  private seq = 0;

  /**
   * Recomputed only on lifecycle changes, never per frame.
   *
   * `useSyncExternalStore` requires a referentially stable snapshot between
   * notifications — returning a fresh array on every read is an infinite render
   * loop. Frame counters deliberately do not live here: they change ten times a
   * second per venue and already reach the UI through the hook's throttled
   * publish tick, which runs on the shared `THROTTLE_INTERVAL_MS` window.
   */
  private snapshot: SocketSummary[] = EMPTY_REGISTRY;

  /** The next socket id. Handed out before `add`, because the handle carries it. */
  nextId(): number {
    return ++this.seq;
  }

  add(handle: SocketHandle): void {
    this.handles.set(handle.id, handle);
    this.publish();
  }

  remove(id: number): void {
    this.handles.delete(id);
    this.publish();
  }

  /** The referentially stable snapshot. Never the live map. */
  read(): SocketSummary[] {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Force every live socket to drop and re-handshake. Returns how many cycled.
   *
   * Not implemented as `ws.close()` from outside: that path runs through the
   * supervisor's `retry()`, which makes the operator wait out the current
   * backoff (up to 20s + jitter) and increments the failure counter — so a
   * deliberate action would read on screen as an outage.
   */
  restartAll(): number {
    const live = [...this.handles.values()];
    for (const handle of live) handle.restart();
    return live.length;
  }

  size(): number {
    return this.handles.size;
  }

  private publish(): void {
    this.snapshot = this.handles.size === 0
      ? EMPTY_REGISTRY
      : [...this.handles.values()].map(({ id, venue, symbol, openedAt }) => ({
        id, venue, symbol, openedAt,
      }));
    for (const listener of this.listeners) listener();
  }
}

/** One registry per tab. `livebook.ts` is the only writer. */
export const sockets = new SocketRegistry();

/** Live socket inventory for this tab. Safe during SSR — it reports none. */
export function useSocketRegistry(): SocketSummary[] {
  return useSyncExternalStore(
    (listener) => sockets.subscribe(listener),
    () => sockets.read(),
    () => EMPTY_REGISTRY,
  );
}

/** Force every live socket to drop and re-handshake. Returns how many cycled. */
export function restartAllSockets(): number {
  return sockets.restartAll();
}

/**
 * Socket inventory plus the force-reconnect control, for the systems console.
 *
 * Read-only over the registry: it does not open anything of its own, so a panel
 * that renders this cannot change the socket count by being on screen. The
 * reconnect it exposes cycles whatever `useLiveBook` has already opened.
 */
export function useWireTap(): { sockets: SocketSummary[]; reconnectAll: () => number } {
  const inventory = useSocketRegistry();
  const reconnectAll = useCallback(() => restartAllSockets(), []);
  return { sockets: inventory, reconnectAll };
}
