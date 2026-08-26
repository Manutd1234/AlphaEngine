"use client";

/**
 * A poll's arrival is one frame, not one repaint per value.
 *
 * Eight sections carry a live tape and every one repaints the instant its own
 * poll lands. The polls are not synchronised — each section asks on its own
 * cadence, warmed from a different hover — so a desk with several sections
 * mounted repaints in a scatter, one cut per section, and a number that goes
 * from 1.06 to 1.04 does so as a cut rather than a move.
 *
 * This coalesces arrivals into one commit per window and hands the settled
 * value on. It adds NO ticker of its own: `NumberTicker` already counts to a
 * new value over `--dur-reveal`, reserves its width in tabular figures so the
 * count cannot reflow its neighbours, chases a value that arrives mid-count
 * from the glyphs on screen, and honours `prefers-reduced-motion` itself. The
 * window is the only thing missing, and it is the only thing here.
 *
 * ONE SCHEDULER FOR THE DESK. A `setTimeout` inside each hook would be N
 * timers firing independently — the scatter again with a delay on it. The
 * pending set and the timer are module-level, so every value that arrives
 * inside one window is committed in the same frame, which is the shape
 * `use-live-series.ts` uses for its store and for the same reason.
 *
 * NULL STAYS NULL. A null arriving mid-window is a reading — "this poll could
 * not produce one" — and replacing it with the previous number would be the
 * `?? 0` defect wearing a delay. It is buffered like any other value and
 * handed on as null.
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";

/**
 * The window, and why it is this number.
 *
 * Long enough that two polls landing within a few frames of each other — the
 * common case when a hover warmed one and the timer fired another — commit
 * together. Short enough that a reader who is watching a single number sees
 * it move within the time a glance takes, well under `NumberTicker`'s own
 * 420ms count. Above about half a second the buffer starts to read as lag
 * rather than as smoothing; below about 100ms it stops batching anything.
 */
export const BUFFER_MS = 300;

/** What each subscriber last committed, and what has arrived since. */
interface Slot {
  committed: number | null;
  incoming: number | null;
  version: number;
}

const slots = new Map<string, Slot>();
const listeners = new Map<string, Set<() => void>>();
const pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

/** Commit every pending slot in one pass, then wake exactly their listeners. */
function flush(): void {
  timer = null;
  const woken = [...pending];
  pending.clear();
  for (const key of woken) {
    const slot = slots.get(key);
    if (!slot) continue;
    slot.committed = slot.incoming;
    slot.version += 1;
  }
  for (const key of woken) for (const listener of listeners.get(key) ?? []) listener();
}

/** Start the window if none is running; an arrival inside it simply joins. */
function schedule(): void {
  if (timer !== null) return;
  timer = setTimeout(flush, BUFFER_MS);
}

/** Records an arrival. Idempotent on an unchanged value, so a re-render costs nothing. */
export function offerBuffered(key: string, value: number | null): void {
  let slot = slots.get(key);
  if (!slot) {
    // The FIRST value commits at once. A tape that opened on a blank and
    // then filled in 300ms later would read as a load, not a move.
    slot = { committed: value, incoming: value, version: 0 };
    slots.set(key, slot);
    return;
  }
  if (Object.is(slot.incoming, value)) return;
  slot.incoming = value;
  pending.add(key);
  schedule();
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
      if (!set.size) listeners.delete(key);
    };
  };
}

/**
 * The value as of the last committed window, for a series keyed like the tape.
 *
 * Offered during render rather than in an effect, for the reason
 * `useLiveSeries` records: the offer is idempotent on an unchanged value, so a
 * render that is not a new poll is a no-op, and an effect would spend a second
 * commit per poll to reach the same place.
 */
export function useBufferedValue(key: string, value: number | null): number | null {
  offerBuffered(key, value);
  const subscribe = useCallback(subscribeTo(key), [key]);
  const snapshot = useCallback(() => slots.get(key)?.version ?? 0, [key]);
  useSyncExternalStore(subscribe, snapshot, snapshot);
  // NOT `?? value`. A committed null is a reading — "this window's poll could
  // not produce one" — and `??` would replace it with whatever arrived since,
  // which is the `?? 0` defect wearing a delay. The guard caught exactly this
  // line on the first run. A slot missing between renders (reset in a test)
  // reads as its own incoming value, never as a neighbour's.
  const slot = slots.get(key);
  return slot === undefined ? value : slot.committed;
}

/** Testing seam. */
export function resetBuffered(): void {
  slots.clear();
  pending.clear();
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

/** Keeps the effect import honest for callers that flush on unmount. */
export function useFlushOnUnmount(): void {
  useEffect(() => () => { if (timer !== null && pending.size === 0) { clearTimeout(timer); timer = null; } }, []);
}
