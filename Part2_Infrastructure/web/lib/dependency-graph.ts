/**
 * What this desk depends on, and what each dependency's state was read from.
 *
 * WHY A TREE HERE WHEN `FailoverGraph` ARGUES FOR A LIST. That component says a
 * ranked failover chain is a list, that reduced-motion strips every transition,
 * and that a list survives wrapping onto four lines. All true — and scoped to
 * *that* structure. A ranked chain genuinely is linear: entry, cache, rank 1,
 * rank 2. Drawing it as a graph adds nothing.
 *
 * The dependency topology is not linear. One gateway failure takes out market
 * data, pre-trade risk, the research queue, the audit store and the Postgres
 * mirror at the same time, and that fan-out is the single most important thing
 * this tab has to say. A list cannot show it.
 *
 * So the conclusion is overruled and every constraint that produced it is met
 * by different means: the renderer is a nested `<ul>` with CSS connectors, which
 * IS an indented outline at any width, has no coordinates to animate, needs no
 * `forced-color-adjust` exemption, and reads correctly to a screen reader.
 *
 * FIVE STATES, NOT THREE. `absent` (not configured) and `unknown` (never
 * observed, or the transport is dead) stay distinct from `down`, because "we
 * cannot see it" and "it is broken" are different claims and only the second is
 * a fault. This is the distinction the Supabase comment insists on — "only the
 * last is a fault" — and the one `OracleReadiness` insists on when it says not
 * configured "must never render as red".
 *
 * And the rule that makes the whole thing honest: WHEN THE GATEWAY IS DOWN OR
 * UNREADABLE, EVERY CHILD BEHIND IT IS `unknown`, NOT `down`. You cannot read a
 * component's health through a transport that is not answering, and painting
 * five children red asserts five faults from one missing measurement.
 */

import type { SystemHealth } from "@/components/systems/types";

export type DependencyHealth = "ok" | "degraded" | "down" | "absent" | "unknown";

export interface DependencyNode {
  id: string;
  label: string;
  /** Where it runs — the reader's first question about a dependency. */
  role: string;
  health: DependencyHealth;
  /** The reading that produced `health`. Never a guess. */
  detail: string;
  /** The wire field it was read from, so the claim can be checked. */
  source: string;
  children?: DependencyNode[];
}

export const DEPENDENCY_GLYPH: Record<DependencyHealth, string> = {
  ok: "●", degraded: "▲", down: "✕", absent: "○", unknown: "◌",
};

export const DEPENDENCY_WORD: Record<DependencyHealth, string> = {
  ok: "healthy", degraded: "degraded", down: "down",
  absent: "not configured", unknown: "not observed",
};

function humanMs(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m}m`;
  return `${Math.round(m / 60)}h`;
}

export function deriveDependencyTree(
  health: SystemHealth | null,
  healthError: string | null,
): DependencyNode {
  if (!health) {
    return {
      id: "web",
      label: "Next.js runtime",
      role: "this instance",
      health: "unknown",
      detail: healthError
        ? `The health probe failed (${healthError}), so nothing below it can be read.`
        : "No health snapshot has arrived yet.",
      source: "GET /api/system/health",
      children: [],
    };
  }

  const platform = health.platform;
  const gatewaySource = health.sources?.gateway;

  // ---- providers -------------------------------------------------------
  const providerNodes: DependencyNode[] = health.providers.map((provider) => {
    const state: DependencyHealth = !provider.configured
      ? "absent"
      : provider.simulatedOutage
        ? "degraded"
        : provider.circuitOpen
          ? "down"
          : provider.quota && provider.quota.remaining <= 0
            ? "degraded"
            : provider.ready
              ? "ok"
              : "down";
    return {
      id: `provider:${provider.id}`,
      label: provider.id,
      role: provider.capabilities.join(", ") || "provider",
      health: state,
      // Server-authored and already redacted; repeating it beats paraphrasing.
      detail: provider.statusDetail ?? DEPENDENCY_WORD[state],
      source: `health.providers[${provider.id}]`,
    };
  });

  const ready = health.summary.ready;
  const registry: DependencyNode = {
    id: "registry",
    label: "Provider registry & cache",
    role: "Next.js route handlers",
    health: health.summary.configured === 0 ? "absent"
      : ready === 0 ? "down"
      : ready < health.summary.total ? "degraded"
      : "ok",
    detail: `${ready} of ${health.summary.total} routable, ${health.summary.configured} configured.`
      + (health.summary.degraded.length ? ` Degraded: ${health.summary.degraded.join(", ")}.` : ""),
    source: "health.summary.ready / .total",
    children: providerNodes,
  };

  // ---- venues, reached directly and NOT through the gateway -------------
  const venueNodes: DependencyNode[] = health.venues.map((venue) => {
    const stats = venue.latency;
    const state: DependencyHealth = stats.n === 0 ? "unknown"
      : stats.errorRate >= 0.25 ? "down"
      : stats.errorRate > 0.05 ? "degraded"
      : "ok";
    return {
      id: `venue:${venue.id}`,
      label: venue.label,
      role: "direct REST",
      health: state,
      detail: stats.n === 0
        ? "No call observed in the rolling window."
        : `p95 ${stats.p95 == null ? "—" : `${Math.round(stats.p95)}ms`} · n=${stats.n} · `
          + `${(stats.errorRate * 100).toFixed(1)}% failed`,
      source: `health.venues[${venue.id}].latency`,
    };
  });

  // ---- the gateway, and everything behind it ---------------------------
  const gatewayHealth: DependencyHealth = (() => {
    if (gatewaySource) {
      if (gatewaySource.state === "not_configured") return "absent";
      if (gatewaySource.state === "unreachable") return "down";
      if (gatewaySource.state !== "fresh") return "unknown";
    }
    if (!platform) return "unknown";
    // `halted` is an operator decision, not a fault — the desk is deliberately
    // stopped, and colouring it the same red as a crash would make a controlled
    // halt indistinguishable from an outage.
    return platform.status === "critical" ? "down"
      : platform.status === "degraded" || platform.status === "halted" ? "degraded"
      : "ok";
  })();

  /**
   * A child is only as readable as the transport that carries it. When the
   * gateway cannot be read, its children report `unknown` rather than their
   * last-known state or a red.
   */
  const behindGateway = (node: DependencyNode): DependencyNode =>
    gatewayHealth === "ok" || gatewayHealth === "degraded"
      ? node
      : {
        ...node,
        health: node.health === "absent" ? "absent" : "unknown",
        detail: gatewayHealth === "absent"
          ? "No gateway is configured in this deployment."
          : "Not readable while the gateway is not answering.",
      };

  const gatewayChildren: DependencyNode[] = platform
    ? [
      behindGateway({
        id: "feeds",
        label: "Market data feeds",
        role: "websocket",
        health: platform.market_data.status === "nominal" ? "ok"
          : platform.market_data.status === "critical" ? "down"
          : platform.market_data.status === "disabled" ? "absent"
          : "degraded",
        detail: `${platform.market_data.feeds.filter((f) => f.connected).length}`
          + `/${platform.market_data.feeds.length} connected`
          + (platform.market_data.synthetic_active ? " · synthetic fallback active" : ""),
        source: "health.platform.market_data.status",
      }),
      behindGateway({
        id: "risk",
        label: "Pre-trade risk",
        role: "gate battery",
        health: platform.risk.status === "halted" ? "down"
          : platform.risk.status === "reduce_only" ? "degraded" : "ok",
        detail: `${platform.risk.status} · ${platform.risk.working_orders} working · `
          + `kill switch ${platform.risk.kill_switch_active ? "engaged" : "clear"}`,
        source: "health.platform.risk.status",
      }),
      behindGateway({
        id: "audit",
        label: "Audit store",
        role: "append-only",
        health: platform.audit.available ? "ok" : "down",
        detail: `${platform.audit.backend}${platform.audit.available ? "" : " — unavailable"}`,
        source: "health.platform.audit.available",
      }),
      behindGateway({
        id: "queue",
        label: "Research queue",
        role: platform.queue.backend ?? "queue",
        health: platform.queue.broker_configured && platform.queue.backend !== "celery"
          ? "degraded" : "ok",
        detail: `${(platform.queue.by_status.queued ?? 0) + (platform.queue.by_status.running ?? 0)}`
          + ` active · ${platform.queue.workers ?? 0} configured slots (not worker heartbeats)`,
        source: "health.platform.queue",
      }),
      /**
       * Three different absences, kept apart. The key missing entirely means an
       * older gateway build; `configured: false` means the mirror is off; a
       * dropped count means it is on and losing rows. Only the last is a fault.
       */
      behindGateway({
        id: "mirror",
        label: "Postgres mirror",
        role: "Supabase",
        health: !platform.supabase ? "absent"
          : !platform.supabase.configured ? "absent"
          : (platform.supabase.dropped ?? 0) > 0 || platform.supabase.last_error_kind != null
            ? "degraded" : "ok",
        detail: !platform.supabase
          ? "This gateway build does not report the mirror."
          : !platform.supabase.configured
            ? "Mirror not configured."
            : `${platform.supabase.written ?? 0} mirrored`
              + ((platform.supabase.dropped ?? 0) > 0 ? ` · ${platform.supabase.dropped} DROPPED` : ""),
        source: "health.platform.supabase",
      }),
    ]
    : [];

  const gateway: DependencyNode = {
    id: "gateway",
    label: "Trading gateway",
    role: "FastAPI",
    health: gatewayHealth,
    detail: gatewaySource?.detail
      ?? (platform
        ? `${platform.status} · build ${platform.version} · ${platform.environment}`
        : "No ops snapshot observed."),
    source: "health.sources.gateway.state",
    children: gatewayChildren,
  };

  /**
   * NO ORACLE NODE. The analytics plane is real, but `SystemHealth` carries no
   * `oracle` field — checked against the type rather than assumed, after a
   * first pass wrote one on the strength of a claim that it existed. A node
   * whose state is read from a field that is not on the wire is exactly the
   * fabrication this tab exists to avoid; if the readiness probe is ever
   * published, it belongs here beside the gateway.
   */
  const shared = health.instance.shared;

  return {
    id: "web",
    label: "Next.js runtime",
    role: "this instance",
    health: "ok",
    detail: `instance ${health.instance.id} · up ${humanMs(health.instance.uptimeMs)}`
      + (shared?.backed && shared.instances.length
        ? ` · ${shared.instances.length} instance${shared.instances.length === 1 ? "" : "s"} in the shared ledger`
        : " · per-instance ledger"),
    source: "health.instance",
    children: [registry, ...venueNodes, gateway],
  };
}

/** Counts by state, so a summary chip can go amber and red. */
export function summariseTree(root: DependencyNode): Record<DependencyHealth, number> {
  const counts: Record<DependencyHealth, number> = {
    ok: 0, degraded: 0, down: 0, absent: 0, unknown: 0,
  };
  const walk = (node: DependencyNode) => {
    counts[node.health] += 1;
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
  return counts;
}
