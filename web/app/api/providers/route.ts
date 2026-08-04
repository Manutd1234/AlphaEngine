import { NextResponse } from "next/server";

import { capabilityMatrix, providerStatus } from "@/lib/providers/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPENBB_HEALTH_TIMEOUT_MS = 2_500;
const OPENBB_HEALTH_TTL_MS = 30_000;

interface OpenBBReadiness {
  ready: boolean;
  statusDetail: string;
}

interface OpenBBHealthCache extends OpenBBReadiness {
  origin: string;
  expiresAt: number;
}

let openbbHealthCache: OpenBBHealthCache | null = null;
let openbbHealthInFlight: { origin: string; promise: Promise<OpenBBReadiness> } | null = null;

function parseOpenBBOrigin(raw: string): string | null {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

function unavailableOpenBBDetail(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "OpenBB service reachable but returned an invalid health response.";
  }

  const detail = "detail" in payload && typeof payload.detail === "string"
    ? payload.detail.toLowerCase()
    : "";

  // Deliberately classify rather than echo the gateway's text. Import errors and
  // provider exceptions can contain local paths, hosts or credential fragments.
  if (detail.includes("not installed") || detail.includes("no module named")) {
    return "OpenBB service is missing its provider runtime.";
  }
  if (detail.includes("credential") || detail.includes("api key")) {
    return "OpenBB service needs provider credentials.";
  }
  return "OpenBB service reported unavailable.";
}

async function probeOpenBB(origin: string): Promise<OpenBBReadiness> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENBB_HEALTH_TIMEOUT_MS);
  const token = process.env.OPENBB_API_TOKEN?.trim();

  try {
    const response = await fetch(new URL("/api/research/openbb/health", `${origin}/`), {
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.status === 404) {
        return { ready: false, statusDetail: "Gateway does not expose the OpenBB health route." };
      }
      if (response.status === 401 || response.status === 403) {
        return { ready: false, statusDetail: "Gateway rejected the OpenBB health check." };
      }
      return {
        ready: false,
        statusDetail: `Gateway health check returned HTTP ${response.status}.`,
      };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { ready: false, statusDetail: "Gateway returned invalid JSON for OpenBB health." };
    }

    if (payload && typeof payload === "object" && "ok" in payload && payload.ok === true) {
      return { ready: true, statusDetail: "OpenBB service reachable and ready." };
    }
    return { ready: false, statusDetail: unavailableOpenBBDetail(payload) };
  } catch {
    return controller.signal.aborted
      ? { ready: false, statusDetail: "OpenBB health check timed out." }
      : { ready: false, statusDetail: "OpenBB service is unreachable." };
  } finally {
    clearTimeout(timeout);
  }
}

async function openBBReadiness(configuredUrl: string): Promise<OpenBBReadiness> {
  const origin = parseOpenBBOrigin(configuredUrl);
  if (!origin) {
    return { ready: false, statusDetail: "Configured OpenBB service URL is invalid." };
  }

  const now = Date.now();
  if (openbbHealthCache?.origin === origin && openbbHealthCache.expiresAt > now) {
    return {
      ready: openbbHealthCache.ready,
      statusDetail: openbbHealthCache.statusDetail,
    };
  }

  if (openbbHealthInFlight?.origin === origin) return openbbHealthInFlight.promise;

  const promise = probeOpenBB(origin).then((result) => {
    openbbHealthCache = { origin, expiresAt: Date.now() + OPENBB_HEALTH_TTL_MS, ...result };
    return result;
  }).finally(() => {
    if (openbbHealthInFlight?.origin === origin) openbbHealthInFlight = null;
  });

  openbbHealthInFlight = { origin, promise };
  return promise;
}

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
