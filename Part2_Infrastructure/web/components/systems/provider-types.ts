/**
 * Provider identity, routing state and the presentation map every routing
 * surface reads from.
 *
 * Split out of `types.ts` when that file passed the length ceiling. Same wire
 * contract, same rule: hand-written mirrors of what `/api/system/*` promises,
 * optional-tolerant wherever a rolling deploy could serve an older shape.
 * `types.ts` re-exports every name below, so no import path changed.
 */

export interface LatencyStats {
  n: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
  errorRate: number;
  lastAt: number | null;
}

export interface BreakerSnapshot {
  state: "closed" | "open" | "half_open";
  failures: number;
  threshold: number;
  openedAt: number | null;
  cooldownRemainingMs: number;
}

export interface QuotaState {
  used: number;
  limit: number;
  remaining: number;
  reserve: number;
  window: string;
}

export interface ProviderRow {
  id: string;
  label: string;
  docs: string;
  signup: string;
  capabilities: string[];
  assets: string[];
  keyEnv: string;
  configured: boolean;
  circuitOpen: boolean;
  quota: QuotaState | null;
  rank: Record<string, number>;
  breaker: BreakerSnapshot;
  latency: LatencyStats;
  simulatedOutage: { expiresAt: number; note: string } | null;
  /**
   * Capabilities this key was refused (401/402/403), learned by dispatch on
   * the answering instance. Optional: an older health route omits it.
   */
  licence?: Array<{ capability: string; status: number | null; expiresAt: number }>;
  ready: boolean;
  statusDetail: string;
}

export type RouteState =
  | "ready"
  | "simulated_outage"
  | "not_configured"
  | "circuit_open"
  | "unlicensed"
  | "quota_exhausted"
  | "quota_reserved";

export interface FailoverNode {
  provider: string;
  label: string;
  rank: number;
  state: RouteState;
  detail: string;
  latency: LatencyStats;
  active: boolean;
  /** Out-of-band health probe, where the provider has one. Absent on older payloads. */
  health?: { ok: boolean; detail: string } | null;
}

export interface FailoverRoute {
  capability: string;
  asset: string;
  nodes: FailoverNode[];
  activeProvider: string | null;
  cacheTtlMs: number;
}

/**
 * Route-state presentation. Icon and word carry the meaning; colour reinforces.
 *
 * Typographic marks, not emoji. These were coloured circles, which meant the
 * house rule against emoji in the UI was broken in the one map every routing
 * surface reads from — so the violation appeared wherever a route state did.
 * A mark inherits the surrounding text colour and renders in the app's own
 * font; an emoji brings a vendor's palette with it and fights the theme.
 */
export const ROUTE_STATE_STYLE: Record<RouteState, { icon: string; label: string; tone: string }> = {
  ready: { icon: "●", label: "ONLINE (Ready)", tone: "var(--success-text)" },
  circuit_open: { icon: "✕", label: "OFFLINE (Circuit Open)", tone: "var(--critical-text)" },
  simulated_outage: { icon: "▲", label: "DEGRADED (Simulated Outage)", tone: "var(--notice-text)" },
  quota_exhausted: { icon: "▲", label: "DEGRADED (Quota Spent)", tone: "var(--warning-text)" },
  quota_reserved: { icon: "▲", label: "DEGRADED (Quota Reserved)", tone: "var(--warning-text)" },
  // An absence rather than a fault: the key is not entitled to this
  // capability. Same mark and tone as "not configured", and the words say
  // which capability and that the block is per instance.
  unlicensed: { icon: "○", label: "NOT LICENSED (This Key)", tone: "var(--text-secondary)" },
  not_configured: { icon: "○", label: "NOT CONFIGURED", tone: "var(--text-secondary)" },
};
