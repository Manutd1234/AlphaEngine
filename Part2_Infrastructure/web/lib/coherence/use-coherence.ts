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
 */

import { useCallback, useRef, useState } from "react";

import { usePolling } from "@/lib/use-polling";
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
 * One polled gateway read.
 *
 * Keeps the last good payload while a later poll fails, and reports the failure
 * beside it rather than instead of it: a book from forty seconds ago plus "the
 * gateway is unreachable" is more useful than an empty panel, so long as the
 * staleness is on screen — which is what the freshness stamp is for.
 */
export function useCoherenceRead<T>(url: string, enabled: boolean, pollMs = COHERENCE_POLL_MS): CoherenceLoad<T> & {
  refresh: () => void;
} {
  const [state, setState] = useState<CoherenceLoad<T>>({
    data: null,
    error: null,
    loading: enabled,
    updatedAt: null,
  });
  const inFlight = useRef(false);

  const tick = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const { data, error } = await readJson<T>(url);
      setState((previous) => ({
        data: data ?? previous.data,
        error,
        loading: false,
        updatedAt: data ? new Date() : previous.updatedAt,
      }));
    } finally {
      inFlight.current = false;
    }
  }, [url]);

  // `immediate` is not a nicety here, it is the difference between a working
  // panel and a dead one. Without it `PollingController` waits a full interval
  // before its first tick, so every pane on this tab sat on "Reading…" for
  // twenty seconds — and a reader clicking between sections faster than that
  // never saw data at all. It read as a broken tab, which is what it was.
  usePolling({ tick, enabled, intervalMs: pollMs, revalidateOnVisible: true, immediate: true });

  return { ...state, refresh: () => void tick() };
}
