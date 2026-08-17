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
  code: "gateway_not_configured" | "gateway_misconfigured" | "gateway_auth_failed"
    | "gateway_unreachable" | "gateway_timeout" | "gateway_rejected" | "gateway_invalid_payload";
  error: string;
  hint?: string;
  /** HTTP status this app should answer with — not the upstream's. */
  status: number;
  upstreamStatus?: number;
}

export type GatewayResult<T> = { ok: true; data: T } | { ok: false; failure: GatewayFailure };

/**
 * The three ways a gateway URL can be wrong are three different statements, and
 * conflating them is how a typo gets reported as an outage. `absent` means this
 * is a demo deployment and the honest degraded path may run; `invalid` and
 * `loopback` mean an operator set a value that can never work, which must be
 * said out loud rather than dressed up as either "not configured" or "down".
 */
export type GatewayState =
  | { kind: "url"; url: URL }
  | { kind: "absent" }
  | { kind: "invalid"; raw: string }
  | { kind: "loopback"; raw: string };

const LOOPBACK_HOSTS = /^(localhost|127(?:\.\d{1,3}){3}|\[?::1\]?|0\.0\.0\.0|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})$/i;

export function gatewayState(env: NodeJS.ProcessEnv = process.env): GatewayState {
  const configured = env[GATEWAY_URL_ENV]?.trim();
  const raw = configured || (env.NODE_ENV === "development" ? "http://127.0.0.1:8000" : "");
  if (!raw) return { kind: "absent" };
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { kind: "invalid", raw };
    // A serverless function fetching 127.0.0.1 fetches *itself*. This exact
    // mistake shipped once — a dev .env.local swept into a CLI upload — and
    // spent a day reading as a gateway outage instead of a config error.
    if (env.NODE_ENV !== "development" && LOOPBACK_HOSTS.test(parsed.hostname)) {
      return { kind: "loopback", raw };
    }
    return { kind: "url", url: new URL(`${parsed.origin}/`) };
  } catch {
    return { kind: "invalid", raw };
  }
}

/** Back-compat resolver: the URL when one is usable, otherwise null. */
export function gatewayBase(env: NodeJS.ProcessEnv = process.env): URL | null {
  const state = gatewayState(env);
  return state.kind === "url" ? state.url : null;
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

export function misconfigured(state: Extract<GatewayState, { kind: "invalid" | "loopback" }>): GatewayFailure {
  return {
    code: "gateway_misconfigured",
    error: state.kind === "loopback"
      ? "The configured gateway URL points at a loopback or private address, which a serverless function cannot reach."
      : "The configured gateway URL is not a valid http(s) origin.",
    hint: `Fix ${GATEWAY_URL_ENV} on the server — it currently reads a value that can never resolve from this deployment.`,
    status: 503,
  };
}

export interface CallOptions {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  timeoutMs?: number;
  /** Reject a 200 whose shape this app cannot safely render. */
  validate?: (payload: unknown) => boolean;
  /** Refuse oversized JSON before parsing it. Omitted for existing callers. */
  maxResponseBytes?: number;
  /**
   * Human noun for the thing the caller wanted — "the order blotter", not the
   * upstream path with its query string. Error text is read by reviewers, and
   * `/api/audit/orders?limit=60 is unavailable` reads as a stack trace.
   */
  subject?: string;
}

/**
 * Reject a body the caller already serialised. Every gateway route binds a
 * Pydantic model, and a quoted JSON string fails that binding with a 422 the
 * client sees as `gateway_rejected` — a real defect wearing an outage's face.
 * A string body is never legitimate here, so it is safe to refuse outright.
 */
function assertUnserialised(body: unknown): unknown {
  if (typeof body === "string") {
    throw new TypeError(
      "callGateway serialises its body — pass a plain object, not a JSON string "
      + "(pre-stringifying double-encodes and the gateway answers 422)",
    );
  }
  return body;
}

/**
 * The operating-system reason a connection never completed.
 *
 * `fetch` throws a flat `TypeError: fetch failed` and puts the real answer one
 * level down in `cause`, so reading only the thrown error's message discards
 * the single most useful fact available. Older shapes carry `code` directly, so
 * both are checked.
 *
 * The value is a stable identifier like `ECONNREFUSED`, never a host or a
 * credential — this boundary exists to keep those server-side, and the codes
 * below say nothing the app's own reachability state does not already admit.
 */
export function transportCause(error: unknown): string | null {
  const direct = (error as { code?: unknown })?.code;
  if (typeof direct === "string") return direct;
  const cause = (error as { cause?: unknown })?.cause;
  const nested = (cause as { code?: unknown })?.code;
  return typeof nested === "string" ? nested : null;
}

/**
 * What each transport failure means for whoever has to fix it.
 *
 * Deliberately phrased as the next action rather than a restatement of the
 * code. Anything unmapped still reports its code in the message above, which is
 * enough to search for — an unknown code must not silence the diagnosis.
 */
export const TRANSPORT_HINTS: Record<string, string> = {
  // The pinned-CA flip in docs/TLS_FLIP.md, unfinished or misconfigured.
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY:
    `The gateway's certificate is signed by a root this deployment does not trust. `
    + `Point NODE_EXTRA_CA_CERTS at the bundled certs/gateway-ca.pem, or set ${GATEWAY_URL_ENV} back to the plaintext port.`,
  SELF_SIGNED_CERT_IN_CHAIN:
    `The gateway's certificate chain ends in a root this deployment does not trust — see docs/TLS_FLIP.md.`,
  DEPTH_ZERO_SELF_SIGNED_CERT:
    `The gateway presented a self-signed certificate with no chain — see docs/TLS_FLIP.md.`,
  CERT_HAS_EXPIRED:
    `The gateway's certificate has expired. Re-copy the root printed by the deploy workflow's TLS sidecar step.`,
  ERR_TLS_CERT_ALTNAME_INVALID:
    `The gateway's certificate does not cover the host ${GATEWAY_URL_ENV} names.`,
  // An https:// URL aimed at the plaintext port is the mirror-image mistake,
  // and it is the code OpenSSL actually emits for it — measured, not guessed.
  // EPROTO is kept because other Node builds and proxy paths report that
  // instead for the same handshake failure.
  ERR_SSL_WRONG_VERSION_NUMBER:
    `The server on that port is not speaking TLS. ${GATEWAY_URL_ENV} is https:// against the gateway's plaintext port — use the TLS port, or http:// for the plaintext one.`,
  EPROTO:
    `The TLS handshake failed. ${GATEWAY_URL_ENV} may be https:// against the gateway's plaintext port.`,
  ECONNREFUSED:
    `Nothing is listening on the port ${GATEWAY_URL_ENV} names. Check the gateway container and the port.`,
  ENOTFOUND: `The host in ${GATEWAY_URL_ENV} does not resolve.`,
  EAI_AGAIN: `DNS lookup for the host in ${GATEWAY_URL_ENV} failed temporarily.`,
  ETIMEDOUT:
    `The connection timed out before any response. Usually a firewall or cloud security list, not the gateway process.`,
  EHOSTUNREACH: `No route to the gateway host — check the network path and any security list.`,
  ENETUNREACH: `No route to the gateway network — check the network path and any security list.`,
  ECONNRESET: `The gateway closed the connection mid-request.`,
};

export async function callGateway<T = unknown>(path: string, options: CallOptions = {}): Promise<GatewayResult<T>> {
  // Before the configuration check: a caller passing the wrong body type is a
  // programming error, and it must not stay hidden on deployments where the
  // gateway happens to be unset — that is exactly how this one survived review.
  if (options.body !== undefined) assertUnserialised(options.body);

  const state = gatewayState();
  if (state.kind === "absent") return { ok: false, failure: notConfigured(options.subject ?? path) };
  if (state.kind !== "url") return { ok: false, failure: misconfigured(state) };
  const base = state.url;

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(new URL(path, base), {
      method: options.method ?? "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: gatewayHeaders(),
      // Callers pass plain objects; this boundary owns serialisation. The
      // guard runs at function entry (assertUnserialised).
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

    const invalidPayload = (error: string): GatewayResult<T> => ({
      ok: false,
      failure: {
        code: "gateway_invalid_payload",
        error,
        hint: "Deploy the gateway and the workspace together before treating this data as live.",
        status: 502,
      },
    });
    const declaredLength = Number(response.headers.get("content-length"));
    if (
      options.maxResponseBytes != null
      && Number.isFinite(declaredLength)
      && declaredLength > options.maxResponseBytes
    ) {
      controller.abort();
      await response.body?.cancel().catch(() => undefined);
      return invalidPayload("The risk gateway returned a payload larger than this workspace accepts.");
    }
    let responseText: string;
    if (options.maxResponseBytes != null && response.body) {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > options.maxResponseBytes) {
          await reader.cancel().catch(() => undefined);
          return invalidPayload("The risk gateway returned a payload larger than this workspace accepts.");
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      responseText = new TextDecoder().decode(bytes);
    } else {
      responseText = await response.text();
    }
    let payload: unknown;
    try {
      payload = JSON.parse(responseText);
    } catch {
      return invalidPayload("The risk gateway returned malformed JSON.");
    }
    if (options.validate && !options.validate(payload)) {
      return invalidPayload("The risk gateway returned a payload this workspace does not recognise.");
    }
    return { ok: true, data: payload as T };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    if (timedOut) {
      return {
        ok: false,
        failure: {
          code: "gateway_timeout",
          error: `The risk gateway did not answer within ${timeoutMs}ms.`,
          status: 504,
        },
      };
    }
    // Everything else used to collapse into one sentence. A certificate this
    // deployment does not trust and a port with nothing behind it read
    // identically, which is exactly how an unfinished TLS flip sat unnoticed
    // while the gateway itself was healthy on both ports. The transport code
    // costs nothing to carry and is the whole diagnosis.
    const transport = transportCause(error);
    return {
      ok: false,
      failure: {
        code: "gateway_unreachable",
        error: transport
          ? `The risk gateway is currently unreachable (${transport}).`
          : "The risk gateway is currently unreachable.",
        hint: transport ? TRANSPORT_HINTS[transport] : undefined,
        status: 503,
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
