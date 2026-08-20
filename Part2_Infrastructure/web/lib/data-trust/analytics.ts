/**
 * Snapshot-backed analytics: instance scope, provider supply, failover depth
 * and quota headroom.
 *
 * Split out of `lib/data-trust.ts` when that file passed 780 lines. The
 * section comment below explains why these four read the half of the health
 * payload that is built during the health request itself, and it travelled
 * with them. The feed-throughput and latency-source halves are in `./feeds`,
 * which imports `humanDuration` from here.
 */

import type { RouteState, SystemHealth } from "@/components/systems/types";

import type { DataTrustTone } from "./model";

// --------------------------------------------------------------------------
// Snapshot-backed analytics
//
// WHY these sources and not the obvious ones.
//
// `validation.*`, `cache.byCapability`, `events.*` and `quarantine.*` are only
// ever incremented inside `dispatch()` (lib/providers/runtime.ts), which runs
// in the `/api/quote`-family lambdas. `/api/system/health` is answered by
// `buildSystemHealthSnapshot` in a DIFFERENT serverless process with its own
// module scope, so those four read ~0 on a fully warm, heavily-trafficked
// deployment. That is not a cold start and no amount of traffic fixes it —
// drawing more charts over them just produces more empty charts.
//
// Everything below reads the half of the payload that is BUILT DURING the
// health request itself: the provider registry, the failover graph, the quota
// ledger and the gateway's own ops snapshot. Those are populated on every poll,
// on every instance, which is why the analytics moved onto them.
// --------------------------------------------------------------------------

/** A duration a person can read. `null` stays absent — never "0s". */
export function humanDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "n/a";
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3_600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${(seconds / 3_600).toFixed(1)}h`;
  return `${(seconds / 86_400).toFixed(1)}d`;
}

export interface InstanceScopeFact {
  id: "scope" | "instances" | "uptime" | "observed";
  label: string;
  value: string;
  detail: string;
  tone: DataTrustTone;
}

/**
 * Whose numbers these are.
 *
 * `instance.scope`, `instance.shared` and `instance.uptimeMs` have been on the
 * wire and typed the whole time, and nothing rendered them. They are the single
 * highest-value thing on this tab and not a chart: `scope` states outright
 * whether the counters below were merged across the fleet through the gateway
 * ledger or measured by this one lambda, and `uptimeMs` states how long that
 * lambda has been alive. Together they turn "0 evaluated" from an alarm into an
 * explained boundary.
 */
export function deriveInstanceScope(health: SystemHealth | null): InstanceScopeFact[] {
  const instance = health?.instance ?? null;
  const shared = instance?.shared ?? null;
  const backed = shared?.backed ?? false;
  const reporting = shared?.instances.length ?? 0;
  const uptimeMs = instance ? instance.uptimeMs : null;

  return [
    {
      id: "scope",
      label: "Ledger scope",
      value: !instance ? "not observed" : backed ? "Gateway-shared" : "Per-instance",
      detail: instance?.scope
        ?? "No health snapshot has arrived, so the measurement boundary is unknown.",
      tone: !instance ? "unknown" : backed ? "good" : "warn",
    },
    {
      id: "instances",
      // Not "0" when the sync is down: an unmerged ledger is an unobserved
      // fleet, not a fleet of none.
      label: "Instances merged",
      value: backed && reporting > 0 ? String(reporting) : "n/a",
      detail: backed && reporting > 0
        ? `${shared!.instances.slice(0, 4).join(", ")}${reporting > 4 ? ` +${reporting - 4} more` : ""}`
          + `${shared!.windowSeconds ? `; ${shared!.windowSeconds} s merge window` : ""}`
        : instance
          ? "The gateway ledger sync is unavailable, so every counter here was measured by this lambda alone."
          : "Waiting for the first health snapshot.",
      tone: backed && reporting > 0 ? "good" : "unknown",
    },
    {
      id: "uptime",
      label: "This instance uptime",
      value: humanDuration(uptimeMs),
      detail: instance
        ? `Instance ${instance.id}. Validation, cache, event and quarantine counters increment in the quote lambdas, so they stay empty here.`
        : "No instance identity has been reported.",
      // A young instance is the honest explanation for a thin window, so it is
      // flagged rather than presented as a healthy reading.
      tone: uptimeMs == null ? "unknown" : uptimeMs < 300_000 ? "warn" : "good",
    },
    {
      id: "observed",
      label: "Ledger observed",
      value: shared?.ageMs == null ? "n/a" : `${Math.max(0, Math.round(shared.ageMs / 1000))}s ago`,
      detail: shared?.observedAt
        ? `Shared ops state last merged at ${shared.observedAt}.`
        : "No shared observation time to merge against.",
      tone: shared?.ageMs == null ? "unknown" : shared.ageMs < 60_000 ? "good" : "warn",
    },
  ];
}

export interface SupplyCounts {
  total: number;
  ready: number;
  circuitOpen: number;
  quotaExhausted: number;
  simulatedOutage: number;
  notConfigured: number;
  /** Configured, not blocked by circuit or quota, and still not routable. */
  blocked: number;
}

/**
 * Every provider counted EXACTLY ONCE.
 *
 * `summary.degraded`, `summary.exhausted` and `summary.simulated` are three
 * independent id lists and a provider can appear in more than one of them, so a
 * ring built from those three plus `ready` can sum past `total` — a composition
 * chart whose slices do not partition its own denominator. Classifying each
 * provider row by precedence is what makes the ring add up.
 */
export function deriveProviderSupply(health: SystemHealth | null): SupplyCounts {
  const counts: SupplyCounts = {
    total: 0,
    ready: 0,
    circuitOpen: 0,
    quotaExhausted: 0,
    simulatedOutage: 0,
    notConfigured: 0,
    blocked: 0,
  };
  for (const provider of health?.providers ?? []) {
    counts.total += 1;
    if (!provider.configured) counts.notConfigured += 1;
    else if (provider.simulatedOutage) counts.simulatedOutage += 1;
    else if (provider.circuitOpen || provider.breaker.state === "open") counts.circuitOpen += 1;
    else if (provider.quota && provider.quota.remaining <= 0) counts.quotaExhausted += 1;
    else if (provider.ready) counts.ready += 1;
    else counts.blocked += 1;
  }
  return counts;
}

export interface FailoverDepthRow {
  capability: string;
  asset: string;
  total: number;
  ready: number;
  byState: Record<RouteState, number>;
  activeProvider: string | null;
}

const ROUTE_STATES: RouteState[] = [
  "ready",
  "quota_reserved",
  "quota_exhausted",
  "circuit_open",
  "simulated_outage",
  "unlicensed",
  "not_configured",
];

/**
 * How deep each failover chain actually is right now.
 *
 * `routes` is the richest structure on the wire — one ranked chain per
 * capability × asset, each node carrying its own routing state — and the tab
 * reduced all of it to the single scalar "9 route graphs". The question a chain
 * answers is whether anything is behind the provider currently serving it, so
 * the thinnest chains sort first.
 */
export function deriveFailoverDepth(health: SystemHealth | null): FailoverDepthRow[] {
  return (health?.routes ?? [])
    .map((route) => {
      const byState = Object.fromEntries(ROUTE_STATES.map((state) => [state, 0])) as Record<RouteState, number>;
      for (const node of route.nodes) byState[node.state] = (byState[node.state] ?? 0) + 1;
      return {
        capability: route.capability,
        asset: route.asset,
        total: route.nodes.length,
        ready: byState.ready,
        byState,
        activeProvider: route.activeProvider,
      };
    })
    .sort((left, right) =>
      left.ready - right.ready
      || left.capability.localeCompare(right.capability)
      || left.asset.localeCompare(right.asset));
}

export interface QuotaHeadroomRow {
  id: string;
  label: string;
  used: number;
  limit: number;
  remaining: number;
  reserve: number;
  window: string;
  /** Shares of the window, summing to exactly 100 so rows stay comparable. */
  spentPct: number;
  freePct: number;
  reservedPct: number;
  tone: DataTrustTone;
}

/**
 * Quota as a proportion, tightest first.
 *
 * Deliberately NOT the per-provider meters in `QuotaMeters` (Providers section),
 * which are absolute counts with a window countdown: 5/5000 and 5/5 are the same
 * bar there and opposite facts here. The reserve is carved out of the top of the
 * window — background polling stops when `remaining <= reserve` — so it is drawn
 * as its own band rather than as part of the free space, because a desk reading
 * "245 left" is already being refused refreshes at 50 of them.
 */
export function deriveQuotaHeadroom(health: SystemHealth | null): QuotaHeadroomRow[] {
  const rows: QuotaHeadroomRow[] = [];
  for (const provider of health?.providers ?? []) {
    const quota = provider.quota;
    // A zero or missing limit is not a quota of nothing; it is no local ledger.
    // Unconfigured providers are excluded even though the registry still
    // reports their window: a budget that cannot be spent is not headroom, and
    // a full green bar for a provider with no key is the most flattering
    // possible way to draw a missing credential.
    if (!provider.configured || !quota || quota.limit <= 0) continue;
    const spent = Math.min(quota.limit, Math.max(0, quota.used));
    const reserved = Math.min(Math.max(0, quota.remaining), Math.max(0, quota.reserve));
    const spentPct = Math.round((spent / quota.limit) * 1000) / 10;
    const reservedPct = Math.round((reserved / quota.limit) * 1000) / 10;
    rows.push({
      id: provider.id,
      label: provider.label,
      used: quota.used,
      limit: quota.limit,
      remaining: quota.remaining,
      reserve: quota.reserve,
      window: quota.window,
      spentPct,
      reservedPct,
      // The remainder, not a third rounding: the three shares must total 100 or
      // the bar overruns the track it is drawn in.
      freePct: Math.max(0, Math.round((100 - spentPct - reservedPct) * 10) / 10),
      tone: quota.remaining <= 0 ? "bad" : quota.remaining <= quota.reserve ? "warn" : "good",
    });
  }
  return rows.sort((left, right) =>
    (left.remaining - left.reserve) / left.limit - (right.remaining - right.reserve) / right.limit
    || left.label.localeCompare(right.label));
}
