/** Server-only gateway origin selection shared by every proxy route. */

export const GATEWAY_URL_ENV = "ALPHAENGINE_GATEWAY_URL";

/**
 * Recovery ingress for the same stateful gateway. It stays server-only: the
 * browser calls same-origin routes and never receives gateway topology or
 * credentials. Read-only proxy calls may try it after a transport failure on
 * the canonical ingress; mutations never fail over because replaying an order
 * against a second process would be unsafe even when both URLs look related.
 * A distinct recovery credential is required when the origins differ, so a
 * typo here cannot disclose the canonical gateway token to another host.
 */
export const GATEWAY_PUBLIC_URL_ENV = "ALPHAENGINE_GATEWAY_PUBLIC_URL";

/** Absent, malformed, insecure, and private are distinct remediations. */
export type GatewayState =
  | { kind: "url"; url: URL }
  | { kind: "absent" }
  | { kind: "invalid"; raw: string }
  | { kind: "insecure"; raw: string }
  | { kind: "loopback"; raw: string };

export interface GatewayIngress {
  url: URL;
  credential: "canonical" | "recovery";
}

const PRIVATE_HOSTS = /^(localhost|127(?:\.\d{1,3}){3}|\[?::1\]?|0\.0\.0\.0|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})$/i;

function resolveCandidate(raw: string, env: NodeJS.ProcessEnv): GatewayState {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { kind: "invalid", raw };
    }
    // In a Vercel function, 127.0.0.1 is the function itself rather than the
    // desk's FastAPI process. `NODE_ENV=production` alone cannot identify that
    // topology: `next start` and local containers legitimately reach a local or
    // RFC-1918 gateway. Vercel publishes this runtime marker in every
    // environment, so keep the serverless guard exact instead of breaking the
    // production-mode local desk.
    if (env.VERCEL === "1") {
      if (PRIVATE_HOSTS.test(parsed.hostname)) {
        return { kind: "loopback", raw };
      }
      // A server-only token still crosses the network. Vercel may reach only
      // a public TLS origin; local development and next start retain HTTP for
      // the co-located gateway documented by the runbook.
      if (parsed.protocol !== "https:") {
        return { kind: "insecure", raw };
      }
    }
    return { kind: "url", url: new URL(`${parsed.origin}/`) };
  } catch {
    return { kind: "invalid", raw };
  }
}

export function gatewayState(env: NodeJS.ProcessEnv = process.env): GatewayState {
  const configured = env[GATEWAY_URL_ENV]?.trim() ?? "";
  const recovery = env[GATEWAY_PUBLIC_URL_ENV]?.trim() ?? "";
  const primary = configured ? resolveCandidate(configured, env) : null;
  if (primary?.kind === "url") return primary;

  // Consult recovery only after proving the canonical origin unusable. This
  // cannot silently reroute a healthy production gateway.
  const secondary = recovery ? resolveCandidate(recovery, env) : null;
  if (secondary?.kind === "url") return secondary;

  // Preserve the canonical classification when both values are bad so the
  // operator is told which selected value needs repair.
  if (primary) return primary;
  if (secondary) return secondary;
  if (env.NODE_ENV === "development") {
    return resolveCandidate("http://127.0.0.1:8000", env);
  }
  return { kind: "absent" };
}

/**
 * Usable ingresses in preference order.
 *
 * `gatewayState` remains the operator-facing classification: a valid canonical
 * origin is still the selected origin. This list exists for idempotent GETs,
 * which may reach the same gateway through its public recovery ingress when a
 * DNS, TLS, or listener fault takes the canonical ingress down. Invalid and
 * serverless-private values never become candidates, and duplicates collapse
 * after URL normalisation.
 */
export function gatewayIngresses(env: NodeJS.ProcessEnv = process.env): GatewayIngress[] {
  const configured = env[GATEWAY_URL_ENV]?.trim() ?? "";
  const recovery = env[GATEWAY_PUBLIC_URL_ENV]?.trim() ?? "";
  const states: Array<{ state: GatewayState; credential: GatewayIngress["credential"] }> = [
    ...(configured ? [{ state: resolveCandidate(configured, env), credential: "canonical" as const }] : []),
    ...(recovery ? [{ state: resolveCandidate(recovery, env), credential: "recovery" as const }] : []),
  ];
  const candidates: GatewayIngress[] = [];
  for (const { state, credential } of states) {
    if (state.kind !== "url") continue;
    if (!candidates.some((candidate) => candidate.url.href === state.url.href)) {
      candidates.push({ url: state.url, credential });
    }
  }
  if (candidates.length > 0) return candidates;

  // Match gatewayState's local-development default only when no explicit
  // value supplied a more useful invalid/loopback diagnosis.
  if (!configured && !recovery && env.NODE_ENV === "development") {
    const local = resolveCandidate("http://127.0.0.1:8000", env);
    return local.kind === "url" ? [{ url: local.url, credential: "canonical" }] : [];
  }
  return [];
}

export function gatewayCandidates(env: NodeJS.ProcessEnv = process.env): URL[] {
  return gatewayIngresses(env).map((candidate) => candidate.url);
}

/**
 * Back-compatible resolver for direct callers that pair this URL with the
 * canonical credential. Recovery selection needs credential-aware dispatch;
 * returning it here would let an older caller send the canonical token to a
 * different host. `callGateway` and streaming readers use `gatewayIngresses`.
 */
export function gatewayBase(env: NodeJS.ProcessEnv = process.env): URL | null {
  return gatewayIngresses(env).find((ingress) => ingress.credential === "canonical")?.url ?? null;
}
