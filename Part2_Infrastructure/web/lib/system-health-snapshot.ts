import type { GatewayOpsSnapshot, SystemHealth } from "@/components/systems/types";
import { TRUSTED_ARTIFACT_PUBLIC_KEY_SHA256 } from "@/lib/artifact-trust.mjs";
import {
  evaluateArtifactCustody,
  evaluateBuildTraceability,
  gatewayOpenApiEvidence,
  mcParityEvidence,
} from "@/lib/delivery-readiness";
import { gatewayPayloadParityEvidence, riskParityEvidence } from "@/lib/delivery-parity";
import { callGateway } from "@/lib/gateway";
import {
  guardMode,
  CACHE_PREFIXES,
  OPERATOR_TOKEN_ENV,
  paperOrderDefaultAvailable,
  tokenOverrideAvailable,
} from "@/lib/operator";
import {
  activeOutages,
  cacheStats,
  eventCursor,
  globalLatency,
  latencyByClass,
  latencyWindow,
  instanceId,
  latencyStats,
  recordLatency,
  sharedDataQuality,
  sharedOpsStatus,
  startedAt,
} from "@/lib/observability";
import { ledgerValidation } from "@/lib/data-quality-ledger";
import { syncSharedOpsState } from "@/lib/ops-sync";
import { oracleReadiness } from "@/lib/oracle/health";
import { openBBReadiness } from "@/lib/providers/openbb-health";
import { validationTelemetry } from "@/lib/providers/contracts";
import { quarantine } from "@/lib/providers/quarantine";
import { capabilityMatrix, failoverGraph, providerStatus } from "@/lib/providers/registry";
import { store, TTL_MS } from "@/lib/providers/runtime";
import type { Priority } from "@/lib/providers/types";
import {
  gatewaySourceFreshness,
  isGatewayOpsSnapshot,
  OPS_SNAPSHOT_TIMEOUT_MS,
  PROVIDER_HEALTH_STALE_AFTER_MS,
} from "@/lib/reliability";
import { APP_COMMIT, APP_DEPLOYMENT_ENV } from "@/lib/version";

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
 * Everything the systems console needs in one payload — shared by
 * `GET /api/system/health` and by `POST /api/system/actions`, which returns the
 * snapshot the *acting* instance sees. The embedding gives an operator action a
 * zero-latency read from the instance that applied it; the gateway ledger sync
 * below is what then makes every *other* instance agree within one sync,
 * instead of reporting a world where the action never happened.
 */
export async function buildSystemHealthSnapshot(priority: Priority): Promise<SystemHealth> {
  const buildCommit = process.env.ALPHAENGINE_BUILD_COMMIT_SHA ?? APP_COMMIT;

  // First, deliberately serial: everything below reads the ledgers, so the
  // cross-instance overlay must be as fresh as this snapshot claims to be.
  // An unreachable gateway resolves quickly and the reads fall back to the
  // per-instance buckets, which `instance.scope` then discloses.
  await syncSharedOpsState();
  const sharedOps = sharedOpsStatus();
  const sharedLedger = sharedDataQuality();

  const base = providerStatus();
  const configuredOpenBBUrl = process.env.OPENBB_API_URL?.trim() ?? "";
  const gatewayProbeStarted = Date.now();
  const [openBB, oracle, gatewaySnapshot, schemaEvidence] = await Promise.all([
    configuredOpenBBUrl
      ? openBBReadiness(configuredOpenBBUrl)
      : Promise.resolve({ ready: false, statusDetail: "Not configured; set OPENBB_API_URL." }),
    // Cached and short-timeout: this endpoint is polled, and an Always Free
    // instance that has auto-stopped must not make every poll wait on a TCP
    // connect that is never going to complete.
    oracleReadiness(),
    callGateway<GatewayOpsSnapshot>("/api/ops/snapshot", {
      method: "GET",
      timeoutMs: OPS_SNAPSHOT_TIMEOUT_MS,
      subject: "the operations snapshot",
      validate: isGatewayOpsSnapshot,
    }).then((result) => {
      // A real network round trip this poll just paid for — recorded so the
      // latency pool has at least one genuine sample per poll on a fresh
      // serverless instance. Deliberately NOT the cached oracle/openbb
      // readiness reads: a cache hit measures nothing, and faking samples is
      // exactly what the ledger's house rule forbids.
      recordLatency("plane:gateway", Date.now() - gatewayProbeStarted, result.ok);
      return result;
    }),
    gatewayOpenApiEvidence(),
  ]);

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

  const fetchedAtMs = Date.now();
  const fetchedAt = new Date(fetchedAtMs).toISOString();
  const gatewayFreshness = gatewaySourceFreshness(
    gatewaySnapshot.ok ? gatewaySnapshot.data : undefined,
    gatewaySnapshot.ok ? undefined : gatewaySnapshot.failure,
    fetchedAtMs,
  );
  return {
    schemaVersion: 2,
    fetchedAt,
    instance: {
      id: instanceId,
      startedAt: new Date(startedAt).toISOString(),
      uptimeMs: Date.now() - startedAt,
      // Repeated in every telemetry payload rather than documented once. A
      // reader comparing two responses from two instances needs to see the
      // reason they agree — or the reason they no longer do — in the
      // responses themselves.
      scope: sharedOps.backed
        ? `gateway-shared ledger (${sharedOps.instances.length} ${sharedOps.instances.length === 1 ? "instance" : "instances"} reporting in the last 15m)`
        : "per-instance (in-memory fallback — the gateway ledger sync is unavailable)",
      shared: sharedOps,
    },
    guard: {
      mode: guardMode(),
      tokenEnv: OPERATOR_TOKEN_ENV,
      paperOrderDefaultAvailable: paperOrderDefaultAvailable(),
      tokenOverrideAvailable: tokenOverrideAvailable(),
    },
    summary: (() => {
      const latencyClasses = latencyByClass();
      return {
      total: providers.length,
      configured: providers.filter((p) => p.configured).length,
      ready: ready.length,
      degraded: providers.filter((p) => p.breaker.state === "open").map((p) => p.id),
      exhausted: providers
        .filter((p) => p.configured && p.quota && p.quota.remaining <= 0)
        .map((p) => p.id),
      simulated: providers.filter((p) => p.simulatedOutage).map((p) => p.id),
      latency: globalLatency(),
      upstreamLatency: latencyClasses.upstream,
      gatewayHopLatency: latencyClasses.gatewayHop,
      cache: cacheStats().total,
      };
    })(),
    /* The trend beneath the scalars above. The samples have always been here;
       only the aggregates ever left the server, so the client could report a
       p95 and had no way to say whether it was climbing. */
    latencyWindow: latencyWindow(),
    providers,
    venues: DIRECT_VENUES.map((venue) => ({
      ...venue,
      latency: latencyStats(`venue:${venue.id}`),
    })),
    // The analytics plane, reported beside the market-data providers rather
    // than inside them: it answers a different question (can the desk compute
    // in-database risk and search its own research) and has no failover story,
    // so a row in the provider matrix would imply a fallback that is not there.
    oracle,
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
    ...(gatewaySnapshot.ok ? { platform: gatewaySnapshot.data } : {}),
    sources: {
      providers: {
        state: "fresh",
        observedAt: fetchedAt,
        receivedAt: fetchedAt,
        ageMs: 0,
        staleAfterMs: PROVIDER_HEALTH_STALE_AFTER_MS,
        detail: "Provider registry and readiness state were observed in this response.",
      },
      gateway: gatewayFreshness,
    },
    // Payloads that failed their data contract, with the violations that
    // flagged them. A counter alone would say something was wrong and nothing
    // about what, which is the state this buffer exists to end.
    quarantine: {
      size: quarantine.size,
      byProvider: quarantine.byProvider(),
      recent: quarantine.list(12),
    },
    // Contract evidence: the gateway's durable, cross-instance ledger when the
    // sync just returned one, else this function instance's bounded window —
    // and the `scope` word says which. Zero means no payload was evaluated
    // in that scope; it must not be rendered as a clean bill of health.
    validation: sharedLedger ? ledgerValidation(sharedLedger) : validationTelemetry.snapshot(),
    delivery: {
      schema: schemaEvidence,
      // Production route guards executed against canonical payload families.
      payloads: gatewayPayloadParityEvidence(),
      // The TypeScript consumer executed against the Python-generated fixture.
      risk: riskParityEvidence(),
      // The numerics gate: this instance recomputed the committed Monte Carlo
      // fixture. Cached after the first poll — determinism is the claim.
      numerics: mcParityEvidence(),
      build: evaluateBuildTraceability(APP_DEPLOYMENT_ENV, buildCommit),
      artifact: evaluateArtifactCustody({
        deploymentEnvironment: APP_DEPLOYMENT_ENV,
        commitIdentity: buildCommit,
        attestation: process.env.ALPHAENGINE_ARTIFACT_ATTESTATION,
        signature: process.env.ALPHAENGINE_ARTIFACT_SIGNATURE,
        publicKey: process.env.ALPHAENGINE_ARTIFACT_PUBLIC_KEY,
        trustedPublicKeySha256: TRUSTED_ARTIFACT_PUBLIC_KEY_SHA256,
        provenanceSha256: process.env.ALPHAENGINE_BUILD_PROVENANCE_SHA256,
      }),
    },
    // Cast: the payload is a superset of the client's SystemHealth — `oracle`
    // is read by the console through its own narrower type. Field-level drift
    // in the shared portion still fails the compile (see provenanceDigest).
  } as SystemHealth;
}
