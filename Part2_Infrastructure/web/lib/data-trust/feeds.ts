/**
 * Feed throughput per venue, and the latency-window key resolver.
 *
 * Split out of `lib/data-trust.ts` when that file passed 780 lines — the same
 * snapshot-backed family as `./analytics`, kept separate only so neither half
 * sits near the 400-line ceiling again.
 */

import type { LatencyStats, SystemHealth } from "@/components/systems/types";

export interface FeedBookRow {
  symbol: string;
  updateRateHz: number;
  ageSeconds: number | null;
  updatesTotal: number;
  stale: boolean;
}

export interface FeedThroughputRow {
  venue: string;
  status: "up" | "degraded" | "stale" | "down";
  connected: boolean;
  synthetic: boolean;
  reconnects: number;
  uptimeSeconds: number;
  updatesTotal: number;
  /** Lifetime mean, or `null` when there is no uptime to divide by. */
  meanRateHz: number | null;
  books: FeedBookRow[];
}

/**
 * The richest live dataset reaching this tab, and the one it rendered as a
 * single decimal in a table cell.
 *
 * `update_rate_hz` and `uptime_seconds` are confirmed rendered nowhere else in
 * the tree. The mean rate is derived rather than published: it ASSUMES every
 * book was subscribed when the venue connected, which is why it is separated
 * from the instantaneous rate instead of being averaged with it, and why the
 * panel says so.
 */
export function deriveFeedThroughput(health: SystemHealth | null): FeedThroughputRow[] {
  return (health?.platform?.market_data.feeds ?? []).map((feed) => {
    const updatesTotal = feed.symbols.reduce((sum, book) => sum + (book.updates_total ?? 0), 0);
    return {
      venue: feed.venue,
      status: feed.status,
      connected: feed.connected,
      synthetic: feed.synthetic,
      reconnects: feed.reconnects,
      uptimeSeconds: feed.uptime_seconds,
      updatesTotal,
      meanRateHz: feed.uptime_seconds > 0 ? updatesTotal / feed.uptime_seconds : null,
      books: feed.symbols.map((book) => ({
        symbol: book.symbol,
        updateRateHz: book.update_rate_hz,
        ageSeconds: book.age_seconds,
        updatesTotal: book.updates_total,
        stale: book.stale,
      })),
    };
  });
}

export interface LatencySourceRef {
  key: string;
  label: string;
  kind: "provider" | "venue" | "plane" | "unknown";
  /** The published fifteen-minute aggregate, or `null` when none exists. */
  stats: LatencyStats | null;
  /** Why there is no aggregate, when there is none. */
  note: string | null;
}

/**
 * Resolve a latency-window series key to the source it measures.
 *
 * The bug this replaces: the panel matched `venue:*` and provider ids only, so
 * `plane:gateway` — recorded on EVERY health poll by the health route itself,
 * and therefore the densest line on the tab — fell through both branches and
 * showed a permanent "—" beside a fully drawn sparkline. A stat chip that is
 * blank no matter how much traffic a source gets reads as a broken source.
 *
 * `plane:*` keys genuinely have no published aggregate: only providers and
 * venues carry `LatencyStats` on the wire. So the p95 is withheld and named
 * `n/a`, and the sample count comes from the window's own per-bucket counts,
 * which describe the same sample pool.
 */
export function resolveLatencySource(health: SystemHealth | null, key: string): LatencySourceRef {
  if (key.startsWith("venue:")) {
    const id = key.slice("venue:".length);
    const venue = health?.venues.find((row) => row.id === id) ?? null;
    return { key, label: id, kind: "venue", stats: venue?.latency ?? null, note: venue ? null : "venue not in this snapshot" };
  }
  if (key.startsWith("plane:")) {
    const plane = key.slice("plane:".length);
    return {
      key,
      label: `${plane} probe`,
      kind: "plane",
      stats: null,
      note: "the health route's own call to the gateway; no fifteen-minute aggregate is published",
    };
  }
  const provider = health?.providers.find((row) => row.id === key) ?? null;
  return {
    key,
    label: provider?.label ?? key,
    kind: provider ? "provider" : "unknown",
    stats: provider?.latency ?? null,
    note: provider ? null : "no provider, venue or plane in this snapshot owns this key",
  };
}
