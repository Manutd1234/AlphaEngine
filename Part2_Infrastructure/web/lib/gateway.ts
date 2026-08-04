/**
 * Server-side boundary to the authoritative FastAPI risk gateway.
 * ===============================================================
 *
 * The gateway's address and credential live only on this server. Every route
 * that talks to it repeats the same four concerns — resolve the base URL,
 * attach the token, bound the wait, and classify the failure — so they live
 * here once instead of drifting apart across route handlers.
 *
 * The classification matters more than it looks. A 401 from the gateway is not
 * a 401 from this app: relaying it straight through would make a browser prompt
 * for the wrong credential entirely. So upstream statuses are translated into
 * this app's own vocabulary, and the caller always learns which side failed.
 *
 * `ALPHAENGINE_GATEWAY_URL` / `ALPHAENGINE_GATEWAY_TOKEN` are read here and
 * nowhere in the client bundle.
 */

export const GATEWAY_URL_ENV = "ALPHAENGINE_GATEWAY_URL";
export const GATEWAY_TOKEN_ENV = "ALPHAENGINE_GATEWAY_TOKEN";

const DEFAULT_TIMEOUT_MS = 8_000;

export interface GatewayFailure {
  code: "gateway_not_configured" | "gateway_auth_failed" | "gateway_unreachable"
    | "gateway_timeout" | "gateway_rejected" | "gateway_invalid_payload";
  error: string;
  hint?: string;
  /** HTTP status this app should answer with — not the upstream's. */
  status: number;
  upstreamStatus?: number;
}

export type GatewayResult<T> = { ok: true; data: T } | { ok: false; failure: GatewayFailure };

/**
 * Resolve the configured gateway origin.
 *
 * Development falls back to the conventional local port so the workspace is
 * useful with nothing configured; production does not, because silently
 * pointing a deployed app at localhost produces a confusing "unreachable"
 * rather than an honest "not configured".
 */
export function gatewayBase(env: NodeJS.ProcessEnv = process.env): URL | null {
  const configured = env[GATEWAY_URL_ENV]?.trim();
  const raw = configured || (env.NODE_ENV === "development" ? "http://127.0.0.1:8000" : "");
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return new URL(`${parsed.origin}/`);
  } catch {
    return null;
  }
}

export function gatewayHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const token = env[GATEWAY_TOKEN_ENV]?.trim();
  return {
    accept: "application/json",
    "Content-Type": "application/json",
    ...(token ? { "X-AlphaEngine-Token": token } : {}),
  };
}

export function notConfigured(what: string): GatewayFailure {
  return {
    code: "gateway_not_configured",
    error: `No risk gateway is connected in this environment, so ${what} is unavailable.`,
    hint: `Set ${GATEWAY_URL_ENV} and ${GATEWAY_TOKEN_ENV} on the server.`,
    status: 503,
  };
}

export interface CallOptions {
  method?: "GET" | "POST";
  body?: unknown;
  timeoutMs?: number;
  /** Reject a 200 whose shape this app cannot safely render. */
  validate?: (payload: unknown) => boolean;
}

export async function callGateway<T = unknown>(path: string, options: CallOptions = {}): Promise<GatewayResult<T>> {
  const base = gatewayBase();
  if (!base) return { ok: false, failure: notConfigured(path) };

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(new URL(path, base), {
      method: options.method ?? "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: gatewayHeaders(),
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });

    if (!response.ok) {
      const authFailed = response.status === 401 || response.status === 403;
      return {
        ok: false,
        failure: {
          code: authFailed ? "gateway_auth_failed" : "gateway_rejected",
          error: authFailed
            ? "The risk gateway rejected this server's credential."
            : `The risk gateway responded with HTTP ${response.status}.`,
          hint: authFailed ? `Check ${GATEWAY_TOKEN_ENV} against the gateway's WEB_API_TOKEN.` : undefined,
          status: 502,
          upstreamStatus: response.status,
        },
      };
    }

    const payload: unknown = await response.json().catch(() => null);
    if (options.validate && !options.validate(payload)) {
      return {
        ok: false,
        failure: {
          code: "gateway_invalid_payload",
          error: "The risk gateway returned a payload this workspace does not recognise.",
          hint: "Deploy the gateway and the workspace together before treating this data as live.",
          status: 502,
        },
      };
    }
    return { ok: true, data: payload as T };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      failure: {
        code: timedOut ? "gateway_timeout" : "gateway_unreachable",
        error: timedOut
          ? `The risk gateway did not answer within ${timeoutMs}ms.`
          : "The risk gateway is currently unreachable.",
        status: timedOut ? 504 : 503,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Shape a failure into the JSON body this app returns, minus the status. */
export function failureBody(failure: GatewayFailure): Record<string, unknown> {
  const { status, ...body } = failure;
  void status;
  return body;
}
