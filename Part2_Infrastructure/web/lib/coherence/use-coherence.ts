"use client";

/**
 * The tab's reads, on one polling discipline.
 *
 * Every fetch here goes through `usePolling` rather than a bare
 * `useEffect` + `setInterval`: `lib/polling.ts` records the four things fourteen
 * hand-rolled loops each got wrong, and a panel that polls an exchange is not
 * the place to relearn them.
 *
 * Polling is gated on `active` — the tab stays mounted behind `hidden` once
 * visited, so an ungated loop would keep reading Kalshi for a reader who is
 * three tabs away. It is gated on `enabled` too, so a panel that has no
 * watchlist asks for nothing rather than asking and being told nothing.
 *
 * Every read goes through `read-cache.ts`, which is where the answer for a URL
 * lives now rather than in the hook that asked for it. That is what lets a
 * section paint on arrival instead of on its first answer — see that file for
 * why a slow read could not simply be made faster.
 */

import { useCallback, useRef, useState } from "react";

import { usePolling } from "@/lib/use-polling";
import { peek, read, warm } from "./read-cache";
import type { CoherenceLoad } from "./types";

/** Slow by choice. The exchange publishes no budget for keyless traffic, and
 *  the questions this tab asks are about seconds, not milliseconds. */
export const COHERENCE_POLL_MS = 20_000;

/**
 * Past this, the browser has waited longer than the gateway's own budget.
 *
 * Per read, because the reads are not alike. Anything served from the recorded
 * tape answers in milliseconds; `universe` and `certify` read the live exchange
 * and take seconds. One deadline for both meant the browser gave up on the slow
 * ones while the gateway was still doing exactly what it was asked to.
 */
const DEADLINE_MS = 9_000;
const LIVE_READ_DEADLINE_MS = 28_000;

function deadlineFor(url: string): number {
  return /\/(universe|certify)/.test(url) ? LIVE_READ_DEADLINE_MS : DEADLINE_MS;
}

async function readJson<T>(url: string): Promise<{ data: T | null; error: string | null }> {
  const controller = new AbortController();
  const deadline = deadlineFor(url);
  const timer = setTimeout(() => controller.abort(), deadline);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    const payload = (await response.json().catch(() => null)) as (T & { detail?: string; error?: string }) | null;
    if (!response.ok) {
      const detail = payload?.detail ?? payload?.error ?? `the gateway answered ${response.status}`;
      return { data: null, error: String(detail) };
    }
    return { data: payload as T, error: null };
  } catch (error) {
    // The abort and a dead network read the same to a user and differently to
    // an operator, so they are told apart here rather than merged into "failed".
    const aborted = error instanceof DOMException && error.name === "AbortError";
    return {
      data: null,
      error: aborted ? `no answer within ${deadline / 1000}s` : "the desk could not reach its own gateway",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Starts the read for a URL before anyone is looking at it.
 *
 * Exported for the two consoles' rail-intent handlers and their idle sweeps.
 * It is a hint: it reports nothing, it refuses to duplicate a read already in
 * flight, and it declines entirely when a recent answer is already held.
 */
export function warmCoherenceRead(url: string): void {
  warm(url, readJson);
}

/**
 * One polled gateway read.
 *
 * Keeps the last good payload while a later poll fails, and reports the failure
 * beside it rather than instead of it: a book from forty seconds ago plus "the
 * gateway is unreachable" is more useful than an empty panel, so long as the
 * staleness is on screen — which is what the freshness stamp is for.
 *
 * That carry-over is scoped to ONE url. A stale answer to the question being
 * asked is useful; a fresh-looking answer to a question that is no longer being
 * asked is a lie, and the two are one line apart. See the reseed below.
 */
/**
 * Fields that change on every read by construction and draw nothing.
 *
 * `observed_age_s` is how old the venue read behind the answer was when the
 * gateway composed it, so it moves on every response whether or not anything
 * drawable did. It is excluded from the fingerprint for that reason — and it is
 * NOT ignored: `observedAt` below turns it into the timestamp the freshness
 * stamp shows, which is the whole point of the field.
 */
const FRESHNESS_ONLY = new Set(["observed_age_s"]);

/**
 * When the venue was actually read for this payload, or null if it does not say.
 *
 * WHY THIS EXISTS. `updatedAt` used to be `new Date()` at the moment the
 * response landed, which was true while every read went to the exchange on the
 * request. Once the gateway started precomputing answers it stopped being true:
 * a snapshot taken forty seconds ago arrives in two milliseconds and would have
 * been stamped "0s ago". Faster, and lying about it.
 *
 * DERIVED FROM AN AGE, NOT A TIMESTAMP. The gateway sends how old the reading
 * was when it answered, computed against its own clock, and this subtracts that
 * from ours. An absolute timestamp would have to be compared across two
 * machines, and a desk a few seconds ahead of the gateway would render a
 * reading "in the future" — worse than no stamp.
 */
function observedAt(data: unknown): Date | null {
  const age = (data as { observed_age_s?: unknown } | null)?.observed_age_s;
  if (typeof age !== "number" || !Number.isFinite(age)) return null;
  return new Date(Date.now() - age * 1000);
}

/**
 * A string that changes when anything DRAWABLE changes, and not otherwise.
 *
 * MEASURED BEFORE IT WAS WRITTEN, AND THE FIRST NUMBER WAS WRONG. Three
 * consecutive absorption polls twenty seconds apart come back 404,325 bytes
 * each and byte-identical apart from `observed_at`, and the desk re-rendered
 * every mounted section for all three. The first estimate of what that cost —
 * about 14ms a poll — did not survive a control: it was ambient desk activity,
 * most of it the freshness clock ticking once a second, which happens whether
 * this hook polls or not.
 *
 * The honest figure, taken back to back in one session on the same section with
 * only this check toggled, is **about 1.9ms of script per poll**, with layout
 * and style recalculation unchanged. React's reconciler writes nothing to the
 * DOM when the output matches — verified: zero mutations in every section
 * subtree across a poll, with the check on AND off — so what is saved is the
 * reconciliation, not paint.
 *
 * Against that, this costs 1ms at full speed and 3ms under a 4x CPU throttle,
 * so the win is small and real rather than large: roughly a millisecond a poll
 * unthrottled, more on a slow machine where the render it skips costs more and
 * the string it builds does not. It is kept because a stable identity is worth
 * having for its own sake — every future memo on this data depends on it.
 */
function readingOf(data: unknown): string {
  return JSON.stringify(data, (key, value) => (FRESHNESS_ONLY.has(key) ? undefined : value)) ?? "";
}

export function useCoherenceRead<T>(url: string, enabled: boolean, pollMs = COHERENCE_POLL_MS): CoherenceLoad<T> & {
  refresh: () => void;
} {
  // Seeded from whatever the cache already holds for this URL, so a section
  // warmed on hover opens on its figures rather than on "Reading…". `useState`
  // takes the initialiser lazily, so this runs on mount and not on every
  // render; a URL nobody has warmed seeds exactly as it did before.
  const seed = (): CoherenceLoad<T> => {
    const cached = peek<T>(url);
    return {
      data: cached?.data ?? null,
      error: null,
      loading: enabled && !cached,
      updatedAt: cached?.updatedAt ?? null,
    };
  };
  const [state, setState] = useState<CoherenceLoad<T>>(seed);

  // RESEEDED WHEN THE URL CHANGES, and this is a defect fix rather than a
  // refinement. `useState`'s initialiser runs on mount only, and `tick` below
  // keeps the last good payload when a poll answers with nothing — which is
  // right for a FAILED POLL OF THE SAME QUESTION and wrong for a different
  // question. Together they meant that choosing a new family left the previous
  // family's certificate on screen, under the new family's name, for as long as
  // the twenty-eight second live read took: the verdict, the chips and the
  // fixed-width proof all described a market the reader was no longer looking
  // at, and nothing on the page said so.
  //
  // Rendering during render rather than in an effect is deliberate: an effect
  // would paint one frame of the old answer under the new heading first, which
  // is a smaller version of the same lie.
  // The last payload that changed anything drawable. Compared OUTSIDE the state
  // updater and written there too: an updater must be pure, and React may call
  // it twice — a ref written inside would make the second call see its own
  // first, report "unchanged", and drop a genuinely new read.
  const lastReading = useRef<string | null>(null);

  const [seededFor, setSeededFor] = useState(url);
  if (seededFor !== url) {
    setSeededFor(url);
    // A different URL's fingerprint must not be compared against this one's.
    lastReading.current = null;
    setState(seed());
  }

  // The in-flight latch moved to the cache, where it is shared. Three panes
  // read `universe` and each held its own, so a tab switch could put three
  // identical live reads on the exchange's token bucket at once.
  const tick = useCallback(async () => {
    const { data, error } = await read<T>(url, readJson);
    if (!data) {
      setState((previous) => ({ ...previous, error, loading: false }));
      return;
    }
    const reading = readingOf(data);
    const unchanged = reading === lastReading.current;
    lastReading.current = reading;
    setState((previous) => ({
      // IDENTITY KEPT WHEN NOTHING DRAWABLE CHANGED, so a memoised section can
      // bail out. `updatedAt` still advances — the freshness stamp is a clock
      // and has to tick — so this component still re-renders every poll; what
      // stops is the seven section subtrees below it.
      data: unchanged && previous.data ? previous.data : data,
      error,
      loading: false,
      // The BOOK's age when the payload says, this machine's clock when it does
      // not. A read that went to the exchange on this request carries no age
      // and is as fresh as the request, so `new Date()` is the truth there.
      updatedAt: observedAt(data) ?? new Date(),
    }));
  }, [url]);

  // `immediate` is not a nicety here, it is the difference between a working
  // panel and a dead one. Without it `PollingController` waits a full interval
  // before its first tick, so every pane on this tab sat on "Reading…" for
  // twenty seconds — and a reader clicking between sections faster than that
  // never saw data at all. It read as a broken tab, which is what it was.
  usePolling({ tick, enabled, intervalMs: pollMs, revalidateOnVisible: true, immediate: true });

  return { ...state, refresh: () => void tick() };
}
