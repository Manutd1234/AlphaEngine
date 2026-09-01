/**
 * One payload per URL, shared by every pane that asks for it.
 *
 * The Kalshi engine's sections each open their own gateway read, and each read
 * is gated on the section being on screen — which is right for the exchange
 * (nothing is polled for a reader three tabs away) and wrong for the reader,
 * who met "Reading the exchange…" on every first visit to every section. The
 * live reads are the slow ones by design: `universe` and `certify` carry a
 * 28-second browser deadline because the gateway really does take seconds to
 * price a family. So the fix cannot be a faster read. It has to be an earlier
 * one.
 *
 * Two mechanisms, both here:
 *
 * **Dedupe.** A URL already in flight is joined, never re-requested. Three
 * panes shared `universe` before this and each held its own `inFlight` latch,
 * so opening the tab could put three identical live reads on the exchange's
 * token bucket at once.
 *
 * **Warm.** `warm(url)` starts a read nobody is waiting for yet — from a
 * pointer crossing a rail tab, or from the tab's own idle sweep. When the
 * reader arrives, `peek(url)` hands the pane a payload instead of a spinner.
 *
 * The staleness bound is what keeps that honest. A warmed payload paints only
 * while it is younger than `CACHE_MAX_AGE_MS`; past that a cold section shows
 * its loading line again rather than a figure from a different market. The
 * poll behind it is `immediate`, so a warmed payload is replaced by a live one
 * within a tick either way — the cache decides what is on screen for that one
 * second, not what the section believes.
 *
 * Module-level on purpose: it must outlive a pane unmounting, which is the
 * whole point. It is never persisted, so a reload starts cold.
 */

/** One answered read, as the panes consume it. */
export interface CoherenceCached<T> {
  data: T | null;
  error: string | null;
  updatedAt: Date | null;
  transport?: import("./transport-state").CoherenceTransportMeta;
}

/**
 * Five polls' worth. Long enough that a rail warmed on hover is still warm
 * when a reader finishes reading the section they were on; short enough that
 * nothing from a previous sitting is ever the first thing drawn.
 */
export const CACHE_MAX_AGE_MS = 100_000;

export type CoherenceAnswer<T> = {
  data: T | null;
  error: string | null;
  transport?: import("./transport-state").CoherenceTransportMeta;
  /** Failures normally retain last-good data; an authorization loss must not. */
  discardPrevious?: boolean;
};
export type CoherenceFetcher<T> = (url: string, signal: AbortSignal) => Promise<CoherenceAnswer<T>>;

interface Entry {
  data: unknown;
  error: string | null;
  updatedAt: Date;
  transport?: import("./transport-state").CoherenceTransportMeta;
}

const answered = new Map<string, Entry>();
interface PendingEntry {
  controller: AbortController;
  promise: Promise<CoherenceAnswer<unknown>>;
  subscribers: number;
  settled: boolean;
}

const pending = new Map<string, PendingEntry>();

/** The last answer for this URL, if one landed recently enough to still draw. */
export function peek<T>(url: string): CoherenceCached<T> | null {
  const entry = answered.get(url);
  if (!entry) return null;
  if (Date.now() - entry.updatedAt.getTime() > CACHE_MAX_AGE_MS) return null;
  return {
    data: entry.data as T,
    error: entry.error,
    updatedAt: entry.updatedAt,
    transport: entry.transport,
  };
}

/**
 * Reads a URL, joining a read already in flight for it.
 *
 * A failure is remembered ONLY when there is nothing better to remember: a
 * good payload from forty seconds ago plus the failure beside it is what the
 * panes want, and overwriting the payload with the error would throw away the
 * half a reader can still use.
 */
function cancelledRead(): Error {
  return Object.assign(new Error("coherence read cancelled"), { name: "AbortError" });
}

function subscribe<T>(entry: PendingEntry, signal?: AbortSignal): Promise<CoherenceAnswer<T>> {
  entry.subscribers += 1;
  return new Promise((resolve, reject) => {
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      signal?.removeEventListener("abort", onAbort);
      entry.subscribers -= 1;
      if (!entry.settled && entry.subscribers === 0) entry.controller.abort();
    };
    const onAbort = () => {
      release();
      reject(cancelledRead());
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    entry.promise.then(
      (answer) => { release(); resolve(answer as CoherenceAnswer<T>); },
      (error) => { release(); reject(error); },
    );
  });
}

export function read<T>(url: string, fetcher: CoherenceFetcher<T>, signal?: AbortSignal): Promise<CoherenceAnswer<T>> {
  const existing = pending.get(url);
  if (existing) return subscribe<T>(existing, signal);
  const controller = new AbortController();
  let entry!: PendingEntry;
  const promise = Promise.resolve()
    .then(() => fetcher(url, controller.signal))
    .then((answer) => {
      // Some fetch boundaries deliberately resolve an AbortError into typed
      // transport state. Once every subscriber has left, that state belongs to
      // teardown—not to the next reader—so never let it replace the last answer.
      if (controller.signal.aborted) throw cancelledRead();
      const previous = answer.discardPrevious ? undefined : answered.get(url);
      const effectiveData = answer.data ?? previous?.data ?? null;
      answered.set(url, {
        data: effectiveData,
        error: answer.error,
        updatedAt: answer.data !== null ? new Date() : previous?.updatedAt ?? new Date(),
        transport: answer.transport ?? previous?.transport,
      });
      // The cache and the caller must receive the same last-known payload.
      // Otherwise a pane mounted while a warmer was completing can hold null
      // even though the exact URL is already drawable in this map.
      return effectiveData === answer.data ? answer : { ...answer, data: effectiveData };
    })
    .finally(() => {
      entry.settled = true;
      if (pending.get(url) === entry) pending.delete(url);
    });
  entry = {
    controller,
    promise: promise as Promise<CoherenceAnswer<unknown>>,
    subscribers: 0,
    settled: false,
  };
  pending.set(url, entry);
  return subscribe<T>(entry, signal);
}

/**
 * Starts a read nobody is waiting for, or joins one already running.
 *
 * A recent answer returns immediately. An in-flight URL is awaited without
 * starting a second request, which is what lets the section warmer be truly
 * sequential. A rejection is swallowed because a warm has no reader to report
 * to — the pane that arrives later runs its own read and reports that one.
 */
export async function warm<T>(url: string, fetcher: CoherenceFetcher<T>, signal?: AbortSignal): Promise<void> {
  if (peek(url)) return;
  await read(url, fetcher, signal).catch(() => {
    // A warm is a hint. The section's own poll is what reports a failure.
  });
}

/** Testing seam: drops everything, so one suite cannot warm another's reads. */
export function resetCoherenceCache(): void {
  answered.clear();
  for (const entry of pending.values()) entry.controller.abort();
  pending.clear();
}
