"use client";

/**
 * What the desk has watched happen, kept in the browser between polls.
 *
 * "we need innovative diagrams and interactive live data"
 *
 * EVERY FIGURE ON THIS TAB DRAWS ONE MOMENT. The basket total, the book, the
 * implied mass, the fee share — each is redrawn from scratch every twenty
 * seconds, and the previous answer is thrown away. So a reader watching the
 * desk sees numbers change and has no way to see them MOVE: whether the basket
 * has been over a dollar all afternoon or crossed a minute ago is the question
 * the tab raises on every section and answers on none.
 *
 * The gateway records a tape (`/index`, `/replay`, `book_snapshots`) and the
 * Proofs tab draws from it. This is the other half and it is deliberately
 * smaller: what THIS BROWSER has seen since the reader opened the tab. It costs
 * no read, no route and no storage — the polls are already arriving.
 *
 * WHAT IT IS NOT, and the caption on every figure built from it says so: it is
 * not history. It starts when the tab opens, it is lost on reload, and a
 * reader who has been here four minutes has twelve points. Presenting that as
 * "the last hour" would be the worst kind of chart — one whose x-axis means
 * something different from what it appears to mean.
 *
 * MODULE LEVEL, NOT COMPONENT STATE, and that is the whole reason this is a
 * module rather than a `useState` in each pane. Six of the eight sections stay
 * mounted behind `hidden`, but the two that unmount, and every section whose
 * subject changes, would otherwise throw their series away — so a reader who
 * looked at Books and came back would find the tape restarted, which reads as a
 * bug in the desk rather than as a property of component lifetime.
 *
 * ONE SERIES PER KEY, and the key carries the SUBJECT. `books:KXBTCD-…:mid` and
 * `books:KXETH-…:mid` are different series; welding them into one would draw a
 * step between two unrelated markets and call it a move. Callers build the key
 * from whatever they are a question about, which is why it is a string here
 * rather than a typed union — the sections do not agree on what a subject is.
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";

/** One reading, at the moment the poll that carried it landed. */
export interface LivePoint {
  /** Milliseconds since the epoch, from the browser's own clock. */
  at: number;
  /**
   * The reading, or null where this poll could not produce one.
   *
   * A null is APPENDED rather than skipped. A read that failed, or a family
   * that stopped being quoted, is a hole in the record and the figures draw it
   * as one — `linePath` breaks at nulls rather than bridging them, which is the
   * whole argument `GappedSparkline` was written for.
   */
  value: number | null;
}

/**
 * How many readings a series keeps.
 *
 * 240 at the tab's twenty-second poll is about eighty minutes, which is longer
 * than anyone watches one section and short enough that the array never
 * matters: 240 points across a dozen keys is a few thousand numbers. The cap is
 * a ring — the oldest reading falls off the front — so a desk left open
 * overnight uses the same memory as one opened a minute ago.
 */
export const LIVE_SERIES_CAP = 240;

const series = new Map<string, LivePoint[]>();

/**
 * Subscribers and versions PER KEY, not per store.
 *
 * One counter for the whole store was the first shape, and it was wrong in a
 * way nothing failed on: every append re-rendered every mounted tape. A visited
 * panel stays mounted behind `hidden`, so a poll on Books woke the tapes on
 * Universe, Lattice, Stake, Fees, Settlement, Makers and Shell as well — seven
 * renders to paint one line. At five tapes it was a rounding error; at eight,
 * on a tab whose sections all poll, it is a poll's worth of wasted work on
 * every poll.
 *
 * The key is the subject the caller keyed on, so a reader watching one family
 * is woken by that family and by nothing else.
 */
const listeners = new Map<string, Set<() => void>>();
const versions = new Map<string, number>();

/**
 * The version each subscriber reads, keyed by series.
 *
 * `useSyncExternalStore` compares snapshots by `Object.is`, so returning the
 * array itself would need its identity to change on every append — and
 * returning a fresh array on every read would re-render infinitely. A number
 * that increments on append is the snapshot; the reading hook takes the array
 * separately. This is the shape the React docs call for and the one people get
 * wrong.
 */
function emit(key: string): void {
  versions.set(key, (versions.get(key) ?? 0) + 1);
  for (const listener of listeners.get(key) ?? []) listener();
}

/**
 * Records one reading against a key, if it is new.
 *
 * IDEMPOTENT ON `at`, and that is load-bearing rather than a nicety. Every
 * section re-renders on things that are not polls — a view switch, a picker, a
 * parent's clock ticking — and an append that ran on render would add a point
 * per render and draw a flat line at whatever the current value is, dense
 * enough to look like a measurement. So the caller passes the poll's OWN
 * timestamp (`updatedAt` from `useCoherenceRead`, which changes only when a
 * poll answers) and a repeat is dropped here rather than guarded at each of the
 * six call sites.
 */
export function recordLive(key: string, at: number | null | undefined, value: number | null): void {
  if (at == null || !Number.isFinite(at)) return;
  const existing = series.get(key);
  if (existing?.length && existing[existing.length - 1].at >= at) return;
  const next = existing ? existing.slice() : [];
  next.push({ at, value });
  if (next.length > LIVE_SERIES_CAP) next.splice(0, next.length - LIVE_SERIES_CAP);
  series.set(key, next);
  emit(key);
}

/** The readings held for a key, oldest first. Empty until a poll has landed. */
export function readLive(key: string): readonly LivePoint[] {
  return series.get(key) ?? [];
}

function subscribeTo(key: string) {
  return (listener: () => void): () => void => {
    let set = listeners.get(key);
    if (!set) {
      set = new Set();
      listeners.set(key, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      // The map is the store's only unbounded structure, so an emptied set is
      // dropped rather than left as a key nobody reads.
      if (!set.size) listeners.delete(key);
    };
  };
}

/**
 * Records this poll's reading after commit and returns everything seen so far.
 *
 * The store has existing subscribers after the first render. Publishing a new
 * point during a later render synchronously wakes those subscribers, which is
 * a cross-render state update even when the timestamp guard makes the write
 * idempotent. Commit first, then publish: `useSyncExternalStore` observes the
 * new version and schedules the one follow-up render that draws the point.
 */
export function useLiveSeries(key: string, at: Date | null, value: number | null): readonly LivePoint[] {
  const atMs = at?.getTime() ?? null;
  // Stable per key, or `useSyncExternalStore` resubscribes on every render and
  // trades one wasted render for another.
  const subscribe = useCallback(subscribeTo(key), [key]);
  const snapshot = useCallback(() => versions.get(key) ?? 0, [key]);
  useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    recordLive(key, atMs, value);
  }, [atMs, key, value]);
  return readLive(key);
}

/** Testing seam: drops every series, so one suite cannot see another's. */
export function resetLiveSeries(): void {
  series.clear();
  versions.clear();
}
