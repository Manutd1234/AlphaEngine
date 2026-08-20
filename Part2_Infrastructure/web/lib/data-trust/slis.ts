/**
 * The four trust SLI tiles.
 *
 * Split out of `lib/data-trust.ts` when that file passed 780 lines. The
 * section comment below is the whole point of the module and travelled with
 * it: three of the four tiles are NOT the metric that was asked for, and each
 * says what it actually measures rather than borrowing a name the system
 * cannot support.
 */

import type { HealthSourceFreshness, SystemHealth } from "@/components/systems/types";

import type { DataTrustTone } from "./model";

// --------------------------------------------------------------------------
// Trust SLIs
//
// Four tiles, and three of them are NOT the metric that was asked for, because
// that metric does not exist in this system. Each says what it actually
// measures rather than borrowing a name it cannot support:
//
//   "Market feed SLA %"    no SLA target is defined anywhere in the tree — the
//                          only `SLA` in it is the data work board's own
//                          per-item due time. Ships as books within the
//                          freshness budget the gateway publishes.
//   "Missing packet rate"  no sequence-gap or expected-vs-received counter
//                          exists on any feed. Ships as reconnects, each of
//                          which IS an unmeasured gap — and says that nothing
//                          counts the messages lost inside one.
//   "Provider uptime"      only durations exist; a per-provider uptime is not
//                          measurable at all, because providers are observed
//                          only when they are called. Ships as the success rate
//                          of the attempts that were actually made.
//   "Last sync timestamp"  real, and the only one of the four that ships as
//                          asked.
// --------------------------------------------------------------------------

/** Below this a rate is the sample size talking, not the providers. */
export const TRUST_MIN_SAMPLES = 20;

export interface TrustSli {
  label: string;
  value: string;
  note: string;
  tone: DataTrustTone;
}

export function deriveTrustSlis(health: SystemHealth | null): TrustSli[] {
  const platform = health?.platform;
  const feeds = (platform?.market_data.feeds ?? []).filter((feed) => !feed.synthetic);
  const books = feeds.flatMap((feed) => feed.symbols);
  const stale = books.filter((book) => book.stale).length;
  const reconnects = feeds.reduce((sum, feed) => sum + (feed.reconnects ?? 0), 0);
  const budget = platform?.market_data.stale_after_seconds ?? null;

  /**
   * Absent, not zero. With no gateway snapshot these two are unobservable, and
   * "0/0 fresh" or "0 reconnects" would read as a clean bill of health rather
   * than as a missing instrument.
   */
  const noSnapshot = !platform;

  const latency = health?.summary.latency;
  const attempts = latency?.n ?? 0;
  const successRate = attempts ? 1 - latency!.errorRate : null;

  const gateway = health?.sources?.gateway;
  const providers = health?.sources?.providers;
  /**
   * The GATEWAY's observation time, never `fetchedAt`. Fetching the health
   * response does not make an old feed fresh, and `HealthSourceFreshness`
   * exists precisely to keep those two apart.
   */
  const observedAt = gateway?.observedAt ?? providers?.observedAt ?? null;
  const observedAgeMs = gateway?.ageMs ?? providers?.ageMs ?? null;

  return [
    {
      label: "Books within freshness budget",
      value: noSnapshot ? "—" : `${books.length - stale}/${books.length}`,
      note: noSnapshot
        ? "no gateway feed snapshot — the provider registry cannot prove stream freshness"
        : `${budget ?? "?"} s budget; one snapshot, no period SLA is measured anywhere`,
      tone: noSnapshot ? "unknown" : stale === 0 ? "good" : stale < books.length ? "warn" : "bad",
    },
    {
      label: "Feed reconnects",
      value: noSnapshot ? "—" : String(reconnects),
      note: noSnapshot
        ? "no gateway feed snapshot — reconnects are counted by the feed, not by this instance"
        : "each reconnect is an unmeasured gap; nothing counts what was lost inside one",
      tone: noSnapshot ? "unknown" : reconnects === 0 ? "good" : "warn",
    },
    {
      label: "Upstream attempt success",
      value: attempts < TRUST_MIN_SAMPLES
        ? "Collecting"
        : `${((successRate ?? 0) * 100).toFixed(1)}%`,
      note: attempts < TRUST_MIN_SAMPLES
        ? `${attempts}/${TRUST_MIN_SAMPLES} samples — a thin window, not a failure`
        : `provider and venue calls in the rolling 15-minute window; uptime is unmeasurable, providers are observed only when called`,
      tone: attempts < TRUST_MIN_SAMPLES
        ? "unknown"
        : (successRate ?? 0) >= 0.99 ? "good" : (successRate ?? 0) >= 0.9 ? "warn" : "bad",
    },
    {
      label: "Last observation",
      value: observedAgeMs == null ? "—" : `${Math.round(observedAgeMs / 1000)}s ago`,
      note: observedAt
        ? `${gateway?.observedAt ? "gateway" : "provider registry"} observed ${observedAt}`
        : "nothing has reported an observation time",
      tone: observedAgeMs == null ? "unknown"
        : observedAgeMs < 60_000 ? "good" : observedAgeMs < 300_000 ? "warn" : "bad",
    },
  ];
}
