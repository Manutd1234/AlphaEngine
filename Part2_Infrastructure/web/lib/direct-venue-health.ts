/**
 * A small, real market-data probe for the two direct REST venue clients.
 *
 * `/api/system/health` used to read only the fifteen-minute latency ledger. A
 * health poll therefore made no venue call, so Bybit could stream a live book
 * over WebSocket while the dependency view said "not observed" indefinitely.
 * This probe asks both public venues for one uncached BTCUSDT book. It is
 * coalesced and briefly cached so three consoles or several users cannot turn a
 * health read into an upstream request storm.
 *
 * This is readiness evidence, not the trading feed. The gateway and browser
 * WebSockets still own continuous books; this only proves that a fresh,
 * two-sided REST snapshot can be obtained now.
 */

import type { LiveDataObservation } from "@/components/systems/types";
import { fetchBooks, type VenueBook, type VenueName } from "@/lib/venues";

export const DIRECT_VENUE_PROBE_SYMBOL = "BTCUSDT";
export const DIRECT_VENUE_PROBE_TTL_MS = 20_000;
export const DIRECT_VENUE_STALE_AFTER_MS = 60_000;
export const DIRECT_VENUE_PROBE_TIMEOUT_MS = 2_000;

type VenueId = "binance" | "bybit";
export type DirectVenueObservations = Record<VenueId, LiveDataObservation>;

const VENUES: Array<{ id: VenueId; venue: VenueName }> = [
  { id: "binance", venue: "BINANCE" },
  { id: "bybit", venue: "BYBIT" },
];

function usable(book: VenueBook | undefined): book is VenueBook {
  return Boolean(
    book?.ok
    && book.bids.length > 0
    && book.asks.length > 0
    && book.bestBid !== null
    && book.bestAsk !== null
    && Number.isFinite(book.bestBid)
    && Number.isFinite(book.bestAsk)
    && book.bestBid > 0
    && book.bestAsk > 0
    && book.bestBid <= book.bestAsk,
  );
}

/** Pure projection kept public so malformed and one-sided books are testable. */
export function observationsFromBooks(
  books: readonly VenueBook[],
  observedAtMs: number,
): DirectVenueObservations {
  const observedAt = new Date(observedAtMs).toISOString();
  return Object.fromEntries(VENUES.map(({ id, venue }) => {
    const book = books.find((candidate) => candidate.venue === venue);
    const valid = usable(book);
    const observation: LiveDataObservation = {
      state: valid ? "fresh" : "failed",
      observedAt,
      ageMs: 0,
      staleAfterMs: DIRECT_VENUE_STALE_AFTER_MS,
      symbol: DIRECT_VENUE_PROBE_SYMBOL,
      bestBid: valid ? book.bestBid : null,
      bestAsk: valid ? book.bestAsk : null,
      detail: valid
        ? `Fresh ${DIRECT_VENUE_PROBE_SYMBOL} two-sided order book received from ${venue}.`
        : `${venue} did not return a usable two-sided ${DIRECT_VENUE_PROBE_SYMBOL} order book.`,
    };
    return [id, observation];
  })) as DirectVenueObservations;
}

let cached: { completedAtMs: number; observations: DirectVenueObservations } | null = null;
let inflight: Promise<DirectVenueObservations> | null = null;

function age(
  observations: DirectVenueObservations,
  nowMs: number,
): DirectVenueObservations {
  return Object.fromEntries(Object.entries(observations).map(([id, observation]) => {
    const observedAtMs = Date.parse(observation.observedAt);
    const ageMs = Number.isFinite(observedAtMs) ? Math.max(0, nowMs - observedAtMs) : Number.POSITIVE_INFINITY;
    return [id, {
      ...observation,
      ageMs,
      state: ageMs > observation.staleAfterMs ? "stale" : observation.state,
    }];
  })) as DirectVenueObservations;
}

/** Coalesced readiness poll used by every system-health snapshot. */
export async function observeDirectVenues(): Promise<DirectVenueObservations> {
  const now = Date.now();
  if (cached && now - cached.completedAtMs <= DIRECT_VENUE_PROBE_TTL_MS) {
    return age(cached.observations, now);
  }
  if (inflight) return inflight.then((observations) => age(observations, Date.now()));

  inflight = fetchBooks(DIRECT_VENUE_PROBE_SYMBOL, 5, DIRECT_VENUE_PROBE_TIMEOUT_MS)
    .then((books) => observationsFromBooks(books, Date.now()))
    .catch(() => observationsFromBooks([], Date.now()))
    .then((observations) => {
      cached = { completedAtMs: Date.now(), observations };
      return observations;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Testing seam: no poll in one test may answer a later one from cache. */
export function resetDirectVenueObservationCache(): void {
  cached = null;
  inflight = null;
}
