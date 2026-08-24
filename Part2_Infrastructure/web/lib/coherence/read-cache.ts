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
}

/**
 * Five polls' worth. Long enough that a rail warmed on hover is still warm
 * when a reader finishes reading the section they were on; short enough that
 * nothing from a previous sitting is ever the first thing drawn.
 */
export const CACHE_MAX_AGE_MS = 100_000;

type Answer<T> = { data: T | null; error: string | null };

interface Entry {
  data: unknown;
  error: string | null;
  updatedAt: Date;
}

const answered = new Map<string, Entry>();
const pending = new Map<string, Promise<Answer<unknown>>>();

/** The last answer for this URL, if one landed recently enough to still draw. */
export function peek<T>(url: string): CoherenceCached<T> | null {
  const entry = answered.get(url);
  if (!entry) return null;
  if (Date.now() - entry.updatedAt.getTime() > CACHE_MAX_AGE_MS) return null;
  return { data: entry.data as T, error: entry.error, updatedAt: entry.updatedAt };
}

/**
 * Reads a URL, joining a read already in flight for it.
 *
 * A failure is remembered ONLY when there is nothing better to remember: a
 * good payload from forty seconds ago plus the failure beside it is what the
 * panes want, and overwriting the payload with the error would throw away the
 * half a reader can still use.
 */
export function read<T>(url: string, fetcher: (url: string) => Promise<Answer<T>>): Promise<Answer<T>> {
  const existing = pending.get(url);
  if (existing) return existing as Promise<Answer<T>>;
  const promise = fetcher(url)
    .then((answer) => {
      const previous = answered.get(url);
      answered.set(url, {
        data: answer.data ?? previous?.data ?? null,
        error: answer.error,
        updatedAt: answer.data ? new Date() : previous?.updatedAt ?? new Date(),
      });
      return answer;
    })
    .finally(() => {
      pending.delete(url);
    });
  pending.set(url, promise as Promise<Answer<unknown>>);
  return promise;
}

/**
 * Starts a read nobody is waiting for, or does nothing.
 *
 * Nothing is the common case and it is the important one: a rail tab crossed
 * twice, or an idle sweep run on a tab that was already open, must not put a
 * second request on the exchange. A rejection is swallowed here because a warm
 * has no reader to report to — the pane that arrives later runs its own read
 * and reports that one.
 */
export function warm<T>(url: string, fetcher: (url: string) => Promise<Answer<T>>): void {
  if (pending.has(url) || peek(url)) return;
  void read(url, fetcher).catch(() => {
    // A warm is a hint. The section's own poll is what reports a failure.
  });
}

/** Testing seam: drops everything, so one suite cannot warm another's reads. */
export function resetCoherenceCache(): void {
  answered.clear();
  pending.clear();
}
