/**
 * Readiness probe for the independently deployed OpenBB service.
 *
 * OpenBB is the one provider whose "configured" bit does not settle the
 * question. The others are a key: present or absent, and the answer is exact.
 * This one is a URL pointing at a separate Python deployment that can be
 * unreachable, cold, missing its provider runtime, or missing credentials — all
 * while `OPENBB_API_URL` looks perfectly fine. So it gets an actual network
 * probe, cached, with the result classified rather than echoed.
 *
 * Lifted out of `app/api/providers/route.ts` because the systems console asks the
 * same question. Two copies of a cache and a timeout constant is how the two
 * endpoints end up disagreeing about whether a provider is up.
 */

export interface OpenBBReadiness {
  ready: boolean;
  statusDetail: string;
}

/**
 * The standalone Python service can spend a few seconds importing OpenBB on a
 * cold Vercel instance. Match the adapter's bounded request window so a healthy
 * cold start is not reported as an unavailable provider.
 */
const HEALTH_TIMEOUT_MS = 7_500;
const HEALTH_TTL_MS = 30_000;

interface HealthCache extends OpenBBReadiness {
  origin: string;
  expiresAt: number;
}

let cache: HealthCache | null = null;
let inFlight: { origin: string; promise: Promise<OpenBBReadiness> } | null = null;

function parseOrigin(raw: string): string | null {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

function unavailableDetail(payload: unknown): string {
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

async function probe(origin: string): Promise<OpenBBReadiness> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
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
    return { ready: false, statusDetail: unavailableDetail(payload) };
  } catch {
    return controller.signal.aborted
      ? { ready: false, statusDetail: "OpenBB health check timed out." }
      : { ready: false, statusDetail: "OpenBB service is unreachable." };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Cached readiness, with concurrent callers sharing one in-flight probe.
 *
 * Without the single-flight, the console's health poll and a page load landing
 * together would each open their own 7.5s request to a service whose whole
 * problem might be that it is slow.
 */
export async function openBBReadiness(configuredUrl: string): Promise<OpenBBReadiness> {
  const origin = parseOrigin(configuredUrl);
  if (!origin) {
    return { ready: false, statusDetail: "Configured OpenBB service URL is invalid." };
  }

  const now = Date.now();
  if (cache?.origin === origin && cache.expiresAt > now) {
    return { ready: cache.ready, statusDetail: cache.statusDetail };
  }

  if (inFlight?.origin === origin) return inFlight.promise;

  const promise = probe(origin).then((result) => {
    cache = { origin, expiresAt: Date.now() + HEALTH_TTL_MS, ...result };
    return result;
  }).finally(() => {
    if (inFlight?.origin === origin) inFlight = null;
  });

  inFlight = { origin, promise };
  return promise;
}

/**
 * Forget the cached verdict so the next caller probes for real.
 *
 * This is what "hot-reload providers" means for OpenBB: the environment may now
 * point somewhere else, or the service may have finished deploying, and a
 * 30-second-old "unreachable" would otherwise outlive the thing it describes.
 */
export function resetOpenBBHealthCache(): void {
  cache = null;
}

/** Current cached verdict without triggering a probe; null when none is held. */
export function peekOpenBBHealth(): OpenBBReadiness | null {
  if (!cache || cache.expiresAt <= Date.now()) return null;
  return { ready: cache.ready, statusDetail: cache.statusDetail };
}
