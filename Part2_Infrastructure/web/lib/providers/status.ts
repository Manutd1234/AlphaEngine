/**
 * What each provider's state is right now, and which one a request would land
 * on.
 *
 * Split out of `registry.ts` when that file passed 630 lines. Two readers, one
 * source of truth: `/api/providers` renders the matrix, and the failover graph
 * draws the ranked chain per capability/asset pair.
 *
 * `routeState` below re-evaluates a provider EXACTLY the way `dispatch` does,
 * in dispatch's own check order. That duplication is deliberate and commented
 * at the function — a graph that shows "quota spent" where the code would have
 * said "circuit open" sends someone to fix the wrong thing.
 */

import {
  type LatencyStats,
  latencyStats,
  outageFor,
} from "../observability";
import { ADAPTERS, candidatesFor } from "./adapters";
import { ROUTE_MATRIX } from "./capabilities";
import {
  type BreakerSnapshot,
  breakerSnapshot,
  isConfigured,
  licenceBlock,
  licenceBlocks,
  quotaState,
  store,
  Store,
  TTL_MS,
} from "./runtime";
import { Adapter, AssetClass, Capability, Priority } from "./types";

export interface ProviderStatus {
  id: string;
  label: string;
  docs: string;
  signup: string;
  capabilities: Capability[];
  assets: AssetClass[];
  keyEnv: string;
  configured: boolean;
  circuitOpen: boolean;
  quota: { used: number; limit: number; remaining: number; reserve: number; window: string } | null;
  rank: Partial<Record<Capability, number>>;
  /** Full breaker shape — failure count and cooldown, not just the boolean. */
  breaker: BreakerSnapshot;
  /** p50/p95/p99 over the recent window, with the sample count that produced them. */
  latency: LatencyStats;
  /** Set while an operator is deliberately holding this provider out of routing. */
  simulatedOutage: { expiresAt: number; note: string } | null;
  /**
   * Capabilities this key has been refused (401/402/403), learned by dispatch
   * on this instance and skipped without a call until they expire.
   */
  licence: Array<{ capability: Capability; status: number | null; expiresAt: number }>;
}

/**
 * The provider matrix, for `/api/providers` and the UI's health strip.
 *
 * Never includes a key or any prefix of one — only the *name* of the variable
 * that would hold it. A status endpoint is the classic place a credential leaks
 * out of an otherwise careful system, usually as a well-meant "first 4 chars so
 * you can tell which key is loaded".
 */
export function providerStatus(
  env: NodeJS.ProcessEnv = process.env,
  s: Store = store,
): ProviderStatus[] {
  return ADAPTERS.map((a) => {
    // `breakerSnapshot`, not `breakerOpen`: the latter retires an elapsed
    // breaker as a side effect of being asked. A status endpoint that half-opens
    // circuits merely by being polled would make the health panel a participant
    // in the behaviour it is supposed to be reporting.
    const breaker = breakerSnapshot(a.meta.id, s);
    const outage = outageFor(a.meta.id);
    return {
      id: a.meta.id,
      label: a.meta.label,
      docs: a.meta.docs,
      signup: a.meta.signup,
      capabilities: a.meta.capabilities,
      assets: a.meta.assets,
      keyEnv: a.meta.keyEnv || "(none — public)",
      configured: isConfigured(a, env),
      circuitOpen: breaker.state === "open",
      quota: quotaState(a, s),
      rank: a.meta.rank,
      breaker,
      latency: latencyStats(a.meta.id),
      simulatedOutage: outage ? { expiresAt: outage.expiresAt, note: outage.note } : null,
      licence: licenceBlocks(a.meta.id, s).map((block) => ({
        capability: block.capability,
        status: block.status,
        expiresAt: Date.now() + block.expiresInMs,
      })),
    };
  });
}

// --------------------------------------------------------------------------
// Failover graph
// --------------------------------------------------------------------------

/** Why a provider is or is not routable right now, in dispatch's own order. */
export type RouteState =
  | "ready"
  | "simulated_outage"
  | "not_configured"
  | "circuit_open"
  /** This key was refused this capability (401/402/403); skipped until the block expires. */
  | "unlicensed"
  | "quota_exhausted"
  | "quota_reserved";

export interface FailoverNode {
  provider: string;
  label: string;
  /** Position in the ranked chain for this capability, 1-based. */
  rank: number;
  state: RouteState;
  detail: string;
  latency: LatencyStats;
  /** True for the node a request issued right now would actually land on. */
  active: boolean;
  /**
   * Out-of-band health-probe verdict, where one exists (today: OpenBB).
   *
   * Kept separate from `state` rather than folded into it, because they are
   * different facts and collapsing them makes the graph wrong either way. A
   * provider whose service is down is still *configured*, so `dispatch` will
   * genuinely try it first and only fail over after it times out — reporting it
   * as skipped would be a lie about routing. Reporting it as healthy would be a
   * lie about the service. Both are stated.
   */
  health: { ok: boolean; detail: string } | null;
}

export interface FailoverRoute {
  capability: Capability;
  asset: AssetClass;
  nodes: FailoverNode[];
  /** Provider id a request would reach, or null when the whole chain is dark. */
  activeProvider: string | null;
  /** Cache TTL in front of this chain, from the runtime's per-capability table. */
  cacheTtlMs: number;
}

/**
 * Evaluate one provider exactly the way `dispatch` will.
 *
 * The order of these checks is not cosmetic — it is copied from the dispatch
 * loop, because a graph that shows "quota spent" where the code would have said
 * "circuit open" is worse than no graph: it sends someone to fix the wrong
 * thing. `priority` matters too, since the reserve fences background traffic out
 * of budget an interactive lookup could still spend.
 */
function routeState(
  adapter: Adapter,
  capability: Capability,
  env: NodeJS.ProcessEnv,
  s: Store,
  priority: Priority,
): { state: RouteState; detail: string } {
  const outage = outageFor(adapter.meta.id);
  if (outage) {
    const seconds = Math.ceil((outage.expiresAt - Date.now()) / 1000);
    return { state: "simulated_outage", detail: `${outage.note} — restores in ${seconds}s` };
  }
  if (!isConfigured(adapter, env)) {
    return { state: "not_configured", detail: `set ${adapter.meta.keyEnv}` };
  }
  const breaker = breakerSnapshot(adapter.meta.id, s);
  if (breaker.state === "open") {
    return {
      state: "circuit_open",
      detail: `${breaker.failures} consecutive failures — probes in ${Math.ceil(breaker.cooldownRemainingMs / 1000)}s`,
    };
  }
  const licence = licenceBlock(adapter.meta.id, capability, s);
  if (licence) {
    const hours = Math.max(1, Math.round(licence.expiresInMs / 3_600_000));
    return {
      state: "unlicensed",
      detail: `HTTP ${licence.status ?? "?"} on ${capability}; learned on this instance, re-probes in ${hours} h`,
    };
  }
  const quota = quotaState(adapter, s);
  if (quota && quota.remaining <= 0) {
    return { state: "quota_exhausted", detail: `${quota.used}/${quota.limit} spent this ${quota.window}` };
  }
  if (quota && priority === "background" && quota.remaining <= quota.reserve) {
    return {
      state: "quota_reserved",
      detail: `${quota.remaining} left, all of it reserved for interactive lookups`,
    };
  }
  return {
    state: "ready",
    detail: breaker.state === "half_open"
      ? "cooldown elapsed — next call probes this provider"
      : "configured and routable",
  };
}

/** Health-probe verdicts keyed by provider id, for providers that have one. */
export type ReadinessOverlay = Record<string, { ready: boolean; statusDetail: string }>;

/** The ranked chain for one capability/asset pair, with live state on each node. */
export function failoverRoute(
  capability: Capability,
  asset: AssetClass,
  env: NodeJS.ProcessEnv = process.env,
  s: Store = store,
  priority: Priority = "interactive",
  readiness: ReadinessOverlay = {},
): FailoverRoute {
  const chain = candidatesFor(capability, asset);
  let activeProvider: string | null = null;

  const nodes: FailoverNode[] = chain.map((adapter, index) => {
    const { state, detail } = routeState(adapter, capability, env, s, priority);
    // First ready node in ranked order wins, exactly as the dispatch loop does.
    const active = state === "ready" && activeProvider === null;
    if (active) activeProvider = adapter.meta.id;
    const probe = readiness[adapter.meta.id];
    return {
      provider: adapter.meta.id,
      label: adapter.meta.label,
      rank: index + 1,
      state,
      detail,
      latency: latencyStats(adapter.meta.id),
      active,
      health: probe ? { ok: probe.ready, detail: probe.statusDetail } : null,
    };
  });

  return { capability, asset, nodes, activeProvider, cacheTtlMs: TTL_MS[capability] };
}

/**
 * Every capability/asset pair a façade can actually dispatch. The pairs come
 * from `ROUTE_MATRIX` in `./capabilities`, derived from the same table the
 * façades gate on — a routing diagram that shows a route the gate refuses is
 * the same defect as one that hides a route it admits.
 */
export function failoverGraph(
  env: NodeJS.ProcessEnv = process.env,
  s: Store = store,
  priority: Priority = "interactive",
  readiness: ReadinessOverlay = {},
): FailoverRoute[] {
  const routes: FailoverRoute[] = [];
  for (const { capability, assets } of ROUTE_MATRIX) {
    for (const asset of assets) {
      if (!candidatesFor(capability, asset).length) continue;
      routes.push(failoverRoute(capability, asset, env, s, priority, readiness));
    }
  }
  return routes;
}

/** Capability → the providers that could serve it right now. */
export function capabilityMatrix(env: NodeJS.ProcessEnv = process.env) {
  const caps: Capability[] = ["quote", "bars", "news", "fundamentals", "search", "scrape"];
  return Object.fromEntries(
    caps.map((c) => [
      c,
      {
        available: ADAPTERS.filter((a) => a.meta.capabilities.includes(c) && isConfigured(a, env))
          .sort((a, b) => (a.meta.rank[c] ?? 99) - (b.meta.rank[c] ?? 99))
          .map((a) => a.meta.id),
        // What a reviewer needs to know when a capability is dark: which key.
        missing: ADAPTERS.filter((a) => a.meta.capabilities.includes(c) && !isConfigured(a, env))
          .map((a) => a.meta.keyEnv),
      },
    ]),
  );
}
