import { NextRequest, NextResponse } from "next/server";

import { guardMode, CACHE_PREFIXES, OPERATOR_TOKEN_ENV } from "@/lib/operator";
import {
  activeOutages,
  cacheStats,
  eventCursor,
  globalLatency,
  instanceId,
  latencyStats,
  startedAt,
} from "@/lib/observability";
import { openBBReadiness } from "@/lib/providers/openbb-health";
import { quarantine } from "@/lib/providers/quarantine";
import { capabilityMatrix, failoverGraph, providerStatus } from "@/lib/providers/registry";
import { store, TTL_MS } from "@/lib/providers/runtime";
import { parsePriority } from "@/lib/providers/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The two exchange clients that `/api/depth` and `/api/tca` reach directly,
 * without passing through the provider registry. They have no failover story
 * and therefore no row in the provider matrix, but they are real upstreams and
 * a console that omitted them would be lying by silence.
 */
const DIRECT_VENUES = [
  { id: "binance", label: "Binance REST (order books, klines)" },
  { id: "bybit", label: "Bybit REST (order books)" },
] as const;

/**
 * GET /api/system/health[?priority=interactive|background]
 *
 * Everything the systems console needs in one request: provider readiness with
 * breaker shape and latency percentiles, the ranked failover chain per
 * capability with the node a request would actually land on, quota consumption,
 * cache hit accounting, active simulated outages, and the operator guard's mode.
 *
 * `priority` changes the answer and that is the point. A background poll is
 * fenced out of each provider's quota reserve, so the chain a scheduled refresh
 * would take is not always the chain an operator's click would take — and the
 * failover graph is worth very little if it only ever shows one of them.
 *
 * This is a superset of `GET /api/providers`, which still exists unchanged. No
 * credential material is returned here either: env variable *names* only, and
 * every free-text detail has been through the redactor on its way out.
 */
export async function GET(request: NextRequest) {
  const priority = parsePriority(request.nextUrl.searchParams.get("priority"));

  const base = providerStatus();
  const configuredOpenBBUrl = process.env.OPENBB_API_URL?.trim() ?? "";
  const openBB = configuredOpenBBUrl
    ? await openBBReadiness(configuredOpenBBUrl)
    : { ready: false, statusDetail: "Not configured; set OPENBB_API_URL." };

  const providers = base.map((provider) => {
    if (provider.simulatedOutage) {
      const seconds = Math.ceil((provider.simulatedOutage.expiresAt - Date.now()) / 1000);
      return {
        ...provider,
        ready: false,
        statusDetail: `Held out of routing by an operator-simulated outage; restores in ${seconds}s.`,
      };
    }
    if (!provider.configured) {
      return { ...provider, ready: false, statusDetail: `Not configured; set ${provider.keyEnv}.` };
    }
    if (provider.breaker.state === "open") {
      return {
        ...provider,
        ready: false,
        statusDetail: `Circuit open after ${provider.breaker.failures} consecutive failures; probes again in ${Math.ceil(provider.breaker.cooldownRemainingMs / 1000)}s.`,
      };
    }
    if (provider.quota && provider.quota.remaining <= 0) {
      return { ...provider, ready: false, statusDetail: "Quota exhausted for the current window." };
    }
    if (provider.id === "openbb") return { ...provider, ...openBB };
    return {
      ...provider,
      ready: true,
      statusDetail: provider.breaker.state === "half_open"
        ? "Cooldown elapsed — the next call probes this provider."
        : "Configured and available for routing.",
    };
  });

  const ready = providers.filter((p) => p.ready);
  const readyIds = new Set(ready.map((p) => p.id));
  const capabilities = Object.fromEntries(
    Object.entries(capabilityMatrix()).map(([capability, state]) => [
      capability,
      {
        ...state,
        available: state.available.filter((id) => readyIds.has(id)),
        unavailable: state.available.filter((id) => !readyIds.has(id)),
      },
    ]),
  );

  const liveKeys = store.keys();
  const cacheEntries = liveKeys.filter((key) =>
    (CACHE_PREFIXES as string[]).includes(key.split(":")[0]),
  ).length;

  return NextResponse.json({
    fetchedAt: new Date().toISOString(),
    instance: {
      id: instanceId,
      startedAt: new Date(startedAt).toISOString(),
      uptimeMs: Date.now() - startedAt,
      // Repeated in every telemetry payload rather than documented once. A
      // reader comparing two responses from two instances needs to see the
      // reason they differ in the responses themselves.
      scope: "per-instance (in-memory ledger; swap Store for Vercel KV to share)",
    },
    guard: {
      mode: guardMode(),
      tokenEnv: OPERATOR_TOKEN_ENV,
    },
    summary: {
      total: providers.length,
      configured: providers.filter((p) => p.configured).length,
      ready: ready.length,
      degraded: providers.filter((p) => p.breaker.state === "open").map((p) => p.id),
      exhausted: providers
        .filter((p) => p.configured && p.quota && p.quota.remaining <= 0)
        .map((p) => p.id),
      simulated: providers.filter((p) => p.simulatedOutage).map((p) => p.id),
      latency: globalLatency(),
      cache: cacheStats().total,
    },
    providers,
    venues: DIRECT_VENUES.map((venue) => ({
      ...venue,
      latency: latencyStats(`venue:${venue.id}`),
    })),
    // The readiness overlay is what stops the graph and the matrix disagreeing:
    // OpenBB can be configured (so dispatch will try it) and unreachable (so it
    // will time out and fall through). Both facts travel with the node.
    routes: failoverGraph(process.env, store, priority, { openbb: openBB }),
    routePriority: priority,
    capabilities,
    outages: activeOutages(),
    cache: {
      ...cacheStats(),
      entries: cacheEntries,
      stateEntries: liveKeys.length - cacheEntries,
      ttlMs: TTL_MS,
    },
    events: eventCursor(),
    // Payloads that failed their data contract, with the violations that
    // flagged them. A counter alone would say something was wrong and nothing
    // about what, which is the state this buffer exists to end.
    quarantine: {
      size: quarantine.size,
      byProvider: quarantine.byProvider(),
      recent: quarantine.list(12),
    },
  });
}
