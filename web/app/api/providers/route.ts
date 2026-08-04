import { NextResponse } from "next/server";

import { openBBReadiness } from "@/lib/providers/openbb-health";
import { capabilityMatrix, providerStatus } from "@/lib/providers/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/providers — the data-supply control panel.
 *
 * For each upstream: whether it is configured, whether its circuit is open, how
 * much of its quota is spent in the current window, and which env var would
 * enable it. Plus, per capability, the ordered list of providers that could
 * serve it right now and the variables that are missing.
 *
 * This is deliberately a first-class endpoint rather than a debug page. On a
 * desk the question "why is this number stale" has to be answerable in one
 * request, and the honest answer is usually one of exactly four things: no key,
 * quota spent, breaker open, or upstream down. All four are here.
 *
 * `providerStatus` now also carries the breaker's full shape, recent latency
 * percentiles and any operator-simulated outage; they ride along in the spread
 * below. `GET /api/system/health` is the superset this endpoint became a subset
 * of — it adds the failover graph, cache accounting and the operator guard —
 * but this contract is unchanged, because things already point at it.
 *
 * **No credential material is returned** — only the *names* of the variables.
 * A status endpoint echoing "key: sk-abc…" as a convenience is how secrets get
 * into logs and screenshots.
 */
export async function GET() {
  const baseProviders = providerStatus();
  const configuredOpenBBUrl = process.env.OPENBB_API_URL?.trim() ?? "";
  const openBB = configuredOpenBBUrl
    ? await openBBReadiness(configuredOpenBBUrl)
    : { ready: false, statusDetail: "Not configured; set OPENBB_API_URL." };

  const providers = baseProviders.map((provider) => {
    if (provider.simulatedOutage) {
      return {
        ...provider,
        ready: false,
        statusDetail: "Held out of routing by an operator-simulated outage.",
      };
    }
    if (!provider.configured) {
      return {
        ...provider,
        ready: false,
        statusDetail: `Not configured; set ${provider.keyEnv}.`,
      };
    }
    if (provider.circuitOpen) {
      return {
        ...provider,
        ready: false,
        statusDetail: "Circuit open after recent provider failures.",
      };
    }
    if (provider.quota && provider.quota.remaining <= 0) {
      return {
        ...provider,
        ready: false,
        statusDetail: "Quota exhausted for the current window.",
      };
    }
    if (provider.id === "openbb") return { ...provider, ...openBB };
    return {
      ...provider,
      ready: true,
      statusDetail: "Configured and available for routing.",
    };
  });
  const configured = providers.filter((p) => p.configured);
  const ready = providers.filter((p) => p.ready);
  const notConfigured = providers.filter((p) => !p.configured);
  const circuitOpen = configured.filter((p) => p.circuitOpen);
  const unavailable = configured.filter((p) => !p.ready && !p.circuitOpen);
  const readyIds = new Set(ready.map((provider) => provider.id));
  const capabilities = Object.fromEntries(
    Object.entries(capabilityMatrix()).map(([capability, state]) => [
      capability,
      {
        ...state,
        available: state.available.filter((provider) => readyIds.has(provider)),
        unavailable: state.available.filter((provider) => !readyIds.has(provider)),
      },
    ]),
  );

  return NextResponse.json({
    fetchedAt: new Date().toISOString(),
    summary: {
      configured: configured.length,
      total: providers.length,
      ready: ready.length,
      statusDetail: `${ready.length} ready; ${notConfigured.length} not configured; ${unavailable.length} unavailable; ${circuitOpen.length} circuit open.`,
      degraded: circuitOpen.map((p) => p.id),
      exhausted: providers
        .filter((p) => p.configured && p.quota && p.quota.remaining <= 0)
        .map((p) => p.id),
    },
    // State lives in the function instance's memory, so on a multi-instance
    // deployment these counters describe *this* instance. Said plainly in the
    // payload rather than buried in a README, because a reader comparing two
    // responses will otherwise think the numbers are wrong.
    scope: "per-instance (in-memory ledger; swap Store for Vercel KV to share)",
    capabilities,
    providers,
  });
}
