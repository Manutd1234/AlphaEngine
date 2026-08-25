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

import { useSyncExternalStore } from "react";

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
const listeners = new Set<() => void>();

/**
 * The version counter every subscriber reads.
 *
 * `useSyncExternalStore` compares snapshots by `Object.is`, so returning the
 * array itself would need the array's identity to change on every append — and
 * returning a fresh array on every read would make the store re-render
 * infinitely. A number that increments on append is the snapshot; the reading
 * hook then takes the array separately. This is the shape the React docs call
 * for and the one people get wrong.
 */
let version = 0;

function emit(): void {
  version += 1;
  for (const listener of listeners) listener();
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
  emit();
}

/** The readings held for a key, oldest first. Empty until a poll has landed. */
export function readLive(key: string): readonly LivePoint[] {
  return series.get(key) ?? [];
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const snapshot = () => version;

/**
 * Records this poll's reading and returns everything seen so far.
 *
 * Recording HERE rather than in an effect is deliberate and safe, because the
 * idempotence above makes it a no-op on every render that is not a new poll.
 * An effect would be the conventional shape and would cost a second commit per
 * poll for no gain — and, on the two sections that unmount, would drop the
 * reading the render already had in hand.
 */
export function useLiveSeries(key: string, at: Date | null, value: number | null): readonly LivePoint[] {
  recordLive(key, at?.getTime(), value);
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return readLive(key);
}

/** Testing seam: drops every series, so one suite cannot see another's. */
export function resetLiveSeries(): void {
  series.clear();
  version = 0;
}
