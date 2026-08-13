/**
 * The signal path, derived from what this deployment can actually observe.
 *
 * WHY THIS MODULE EXISTS
 *
 * The panel it feeds used to be a hardcoded array. It asserted, as fact, a
 * "FIX Protocol Execution Engine … dispatching 35=D orders and auditing 35=8
 * execution reports", a "Pre-Trade Risk Gateway (15 Gates)", and per-stage
 * latencies of 0.2ms / 0.5ms / 0.8ms / 1.1ms. None of it was measured and the
 * first of it was not true: there is no FIX anywhere in this system — the
 * gateway is FastAPI speaking REST to Binance and Bybit, and a grep for
 * `simplefix`, `quickfix` or `35=` across the gateway returns nothing. The
 * stage count rendered as `{STEPS.length}/{STEPS.length} stages active` in a
 * green pill, so it read 5/5 healthy by construction and could never report a
 * fault.
 *
 * That sat on the Lineage tab, which is the surface a reader opens to find out
 * what the pipeline is, inside a product whose every other panel refuses to
 * draw a number nobody measured. It was the most expensive sentence in the
 * repository.
 *
 * WHAT REPLACED IT
 *
 * Five stages that exist, each carrying the wire field its state was read from,
 * and five states rather than three. `absent` (not configured) and `unknown`
 * (never observed, or the transport is dead) are kept distinct from `down`,
 * because "we cannot see it" and "it is broken" are different claims and only
 * the second is a fault. A stage nothing measures says so instead of borrowing
 * a plausible number.
 */

import type { SystemHealth } from "@/components/systems/types";

export type StageState = "ok" | "degraded" | "down" | "absent" | "unknown";

export interface SignalStage {
  id: string;
  name: string;
  /** Where this stage runs — the reader's first question about a pipeline. */
  role: string;
  state: StageState;
  /** A measured figure, or null when nothing in this system measures it. */
  measured: string | null;
  /** The wire field `state` and `measured` were read from. */
  source: string;
  detail: string;
}

/** Glyph + word, never colour alone. */
export const STAGE_GLYPH: Record<StageState, string> = {
  ok: "●",
  degraded: "▲",
  down: "✕",
  absent: "○",
  unknown: "◌",
};

export const STAGE_WORD: Record<StageState, string> = {
  ok: "healthy",
  degraded: "degraded",
  down: "down",
  absent: "not configured",
  unknown: "not observed",
};

/** Below this a percentile is the maximum wearing a percentile's name. */
const MIN_SAMPLES = 20;

function latencyLabel(stats: { n: number; p50: number | null } | undefined): string | null {
  if (!stats || stats.n === 0) return null;
  if (stats.n < MIN_SAMPLES || stats.p50 == null) return `collecting · n=${stats.n} of ${MIN_SAMPLES}`;
  return `p50 ${Math.round(stats.p50)}ms · n=${stats.n}`;
}

function fromErrorRate(stats: { n: number; errorRate: number } | undefined): StageState {
  if (!stats || stats.n === 0) return "unknown";
  if (stats.errorRate >= 0.25) return "down";
  if (stats.errorRate > 0.05) return "degraded";
  return "ok";
}

export function deriveSignalPath(
  health: SystemHealth | null,
  healthError: string | null,
): SignalStage[] {
  // No snapshot at all: every stage is unobserved, and none of them is claimed
  // to be broken. A transport failure is not evidence about what it carries.
  if (!health) {
    const detail = healthError
      ? `The health probe failed (${healthError}), so nothing downstream can be read.`
      : "No health snapshot has arrived yet.";
    return [
      { id: "venues", name: "Venue market data", role: "Binance & Bybit REST", state: "unknown", measured: null, source: "health.venues[].latency", detail },
      { id: "registry", name: "Provider registry & cache", role: "Next.js route handlers", state: "unknown", measured: null, source: "health.summary", detail },
      { id: "engine", name: "Research engine", role: "this browser", state: "ok", measured: null, source: "lib/engine.ts", detail: "Backtests and parameter sweeps run client-side, so they do not depend on the probe above." },
      { id: "gateway", name: "Pre-trade risk gateway", role: "FastAPI", state: "unknown", measured: null, source: "health.sources.gateway", detail },
      { id: "audit", name: "Paper execution & audit", role: "gateway, append-only", state: "unknown", measured: null, source: "health.platform.audit", detail },
    ];
  }

  const platform = health.platform;
  const gatewaySource = health.sources?.gateway;

  const venueStats = health.venues.reduce(
    (acc, venue) => ({
      n: acc.n + venue.latency.n,
      errorRate: venue.latency.n > 0
        ? (acc.errorRate * acc.n + venue.latency.errorRate * venue.latency.n) / (acc.n + venue.latency.n)
        : acc.errorRate,
      p50: venue.latency.p50 ?? acc.p50,
    }),
    { n: 0, errorRate: 0, p50: null as number | null },
  );

  const venues: SignalStage = {
    id: "venues",
    name: "Venue market data",
    role: `${health.venues.length} direct REST clients`,
    state: health.venues.length === 0 ? "absent" : fromErrorRate(venueStats),
    measured: latencyLabel(venueStats),
    source: "health.venues[].latency",
    detail:
      health.venues.length === 0
        ? "No venue client is configured in this deployment."
        : `Consolidated L2 depth and klines, read directly by /api/depth and /api/tca. ${
            Math.round(venueStats.errorRate * 1000) / 10}% of attempts failed in the rolling window.`,
  };

  const readyRatio = health.summary.total > 0 ? health.summary.ready / health.summary.total : 0;
  const registry: SignalStage = {
    id: "registry",
    name: "Provider registry & cache",
    role: "Next.js route handlers",
    state:
      health.summary.configured === 0 ? "absent"
        : health.summary.ready === 0 ? "down"
        : readyRatio < 1 ? "degraded"
        : "ok",
    measured: latencyLabel(health.summary.latency),
    source: "health.summary.ready / .total / .latency",
    detail: `${health.summary.ready} of ${health.summary.total} providers routable, ${health.summary.configured} configured.`
      + (health.summary.degraded.length ? ` Degraded: ${health.summary.degraded.join(", ")}.` : ""),
  };

  /**
   * The one stage with no server-side measurement, and it is honest about it
   * rather than borrowing a number from a neighbour. The sweep genuinely runs
   * in the visitor's browser (lib/engine.ts), so there is no wire field that
   * could carry a latency for it.
   */
  const engine: SignalStage = {
    id: "engine",
    name: "Research engine",
    role: "this browser",
    state: "ok",
    measured: null,
    source: "lib/engine.ts — client-side, nothing measures it",
    detail:
      "Backtests, walk-forward folds and the parameter sweep all run client-side. "
      + "No server timing exists for this stage, so none is shown.",
  };

  /**
   * The risk state is the reading; the source freshness only decides whether we
   * are allowed to trust it. Keeping these separate matters: an early version
   * returned "ok" whenever a platform snapshot existed and never looked at
   * `risk.status`, so a halted gateway rendered healthy — the precise failure
   * this panel was rewritten to stop making.
   */
  const fromRisk = (): StageState => {
    if (!platform) return "unknown";
    return platform.risk.status === "halted" ? "down"
      : platform.risk.status === "reduce_only" ? "degraded"
      : "ok";
  };

  const gatewayState: StageState = (() => {
    if (!gatewaySource) return fromRisk();
    switch (gatewaySource.state) {
      case "fresh": return fromRisk();
      case "not_configured": return "absent";
      case "unreachable": return "down";
      // stale / invalid: we have a snapshot but cannot vouch for it.
      default: return "unknown";
    }
  })();

  const slowest = platform?.route_latency.routes.reduce<
    { route: string; p95_ms: number; samples: number } | null
  >((worst, route) => (!worst || route.p95_ms > worst.p95_ms ? route : worst), null) ?? null;

  const gateway: SignalStage = {
    id: "gateway",
    name: "Pre-trade risk gateway",
    role: "FastAPI",
    state: gatewayState,
    measured:
      slowest && slowest.samples >= MIN_SAMPLES
        ? `slowest route p95 ${Math.round(slowest.p95_ms)}ms · ${slowest.route}`
        : slowest
          ? `collecting · n=${slowest.samples} of ${MIN_SAMPLES}`
          : null,
    source: "health.sources.gateway.state + platform.risk.status",
    detail: platform
      ? `Risk state ${platform.risk.status}, kill switch ${platform.risk.kill_switch_active ? "engaged" : "clear"}, `
        + `${platform.risk.working_orders} working orders. `
        + `${platform.risk.orders_accepted_total} accepted and ${platform.risk.orders_rejected_total} rejected since start.`
      : gatewaySource?.detail
        ?? "No gateway ops snapshot in this deployment.",
  };

  const audit: SignalStage = {
    id: "audit",
    name: "Paper execution & audit",
    role: "gateway, append-only",
    state: !platform ? (gatewayState === "absent" ? "absent" : "unknown")
      : platform.audit.available ? "ok" : "down",
    measured: null,
    source: "health.platform.audit.available",
    detail: platform
      ? `Every decision is written to ${platform.audit.backend}. Orders are paper only — this desk holds no funds and reaches no real venue.`
      : "Not observable without a gateway ops snapshot.",
  };

  /**
   * A dead transport makes everything behind it unreadable, not broken. Without
   * this, one failed probe would paint three red stages and assert three faults
   * from a single missing measurement.
   */
  if (gatewayState === "down" || gatewayState === "unknown") {
    for (const stage of [gateway, audit]) {
      if (stage.id !== "gateway" && stage.state !== "absent") stage.state = "unknown";
    }
  }

  return [venues, registry, engine, gateway, audit];
}

/** What the header pill reports: counts by state, never `n/n` by construction. */
export function summariseSignalPath(stages: SignalStage[]): {
  label: string;
  tone: "good" | "warn" | "critical" | "neutral";
} {
  const down = stages.filter((s) => s.state === "down").length;
  const degraded = stages.filter((s) => s.state === "degraded").length;
  const unknown = stages.filter((s) => s.state === "unknown").length;
  const ok = stages.filter((s) => s.state === "ok").length;

  if (down > 0) return { label: `${down} of ${stages.length} down`, tone: "critical" };
  if (degraded > 0) return { label: `${degraded} of ${stages.length} degraded`, tone: "warn" };
  if (unknown > 0) return { label: `${unknown} of ${stages.length} not observed`, tone: "neutral" };
  return { label: `${ok} of ${stages.length} healthy`, tone: "good" };
}
