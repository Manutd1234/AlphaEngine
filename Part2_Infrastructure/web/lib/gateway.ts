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
 * `ALPHAENGINE_GATEWAY_URL` / `ALPHAENGINE_GATEWAY_TOKEN` and the separately
 * scoped recovery ingress credential are read here and nowhere in the client
 * bundle.
 */

import {
  gatewayRequestHeaders,
  remainingGatewayBudgetMs,
  type GatewayRequestContext,
} from "./gateway-request-context";
import { gatewayFetch } from "./gateway-ca";
import {
  GATEWAY_PUBLIC_URL_ENV,
  GATEWAY_URL_ENV,
  gatewayCandidates,
  gatewayIngresses,
  gatewayState,
  type GatewayIngress,
  type GatewayState,
} from "./gateway-origin";
import { TRANSPORT_HINTS, transportCause } from "./gateway-transport";

export const GATEWAY_TOKEN_ENV = "ALPHAENGINE_GATEWAY_TOKEN";
export const GATEWAY_RECOVERY_TOKEN_ENV = "ALPHAENGINE_GATEWAY_RECOVERY_TOKEN";
export {
  GATEWAY_PUBLIC_URL_ENV,
  GATEWAY_URL_ENV,
  gatewayBase,
  gatewayCandidates,
  gatewayIngresses,
  gatewayState,
  type GatewayIngress,
  type GatewayState,
} from "./gateway-origin";

const DEFAULT_TIMEOUT_MS = 8_000;
export { TRANSPORT_HINTS, transportCause } from "./gateway-transport";
export { gatewayFetch } from "./gateway-ca";
export interface GatewayFailure {
  code: "gateway_not_configured" | "gateway_misconfigured" | "gateway_auth_failed"
    | "gateway_unreachable" | "gateway_timeout" | "gateway_cancelled"
    | "gateway_rejected" | "gateway_invalid_payload";
  error: string;
  hint?: string;
  /** HTTP status this app should answer with — not the upstream's. */
  status: number;
  upstreamStatus?: number;
}

export type GatewayResult<T> = { ok: true; data: T } | { ok: false; failure: GatewayFailure };

function headersWithToken(
  token: string | undefined,
  context?: GatewayRequestContext,
  remainingBudgetMs?: number,
): Record<string, string> {
  return {
    accept: "application/json",
    "Content-Type": "application/json",
    ...(token ? { "X-AlphaEngine-Token": token } : {}),
    ...(context ? gatewayRequestHeaders(context, Date.now(), remainingBudgetMs) : {}),
  };
}

export function gatewayHeaders(
  env: NodeJS.ProcessEnv = process.env,
  context?: GatewayRequestContext,
  remainingBudgetMs?: number,
): Record<string, string> {
  const state = gatewayState(env);
  const selected = state.kind === "url"
    ? gatewayIngresses(env).find((ingress) => ingress.url.href === state.url.href)
    : undefined;
  const tokenName = selected?.credential === "recovery"
    ? GATEWAY_RECOVERY_TOKEN_ENV
    : GATEWAY_TOKEN_ENV;
  return headersWithToken(env[tokenName]?.trim(), context, remainingBudgetMs);
}

function gatewayHeadersForIngress(
  ingress: GatewayIngress,
  env: NodeJS.ProcessEnv,
  context?: GatewayRequestContext,
  remainingBudgetMs?: number,
): Record<string, string> {
  const tokenName = ingress.credential === "recovery"
    ? GATEWAY_RECOVERY_TOKEN_ENV
    : GATEWAY_TOKEN_ENV;
  return headersWithToken(env[tokenName]?.trim(), context, remainingBudgetMs);
}

export function notConfigured(what: string): GatewayFailure {
  return {
    code: "gateway_not_configured",
    error: `No risk gateway is connected in this environment, so ${what} is unavailable.`,
    hint: `Set ${GATEWAY_URL_ENV} (or ${GATEWAY_PUBLIC_URL_ENV}) and ${GATEWAY_TOKEN_ENV} on the server.`,
    status: 503,
  };
}

export function misconfigured(state: Extract<GatewayState, { kind: "invalid" | "insecure" | "loopback" }>): GatewayFailure {
  return {
    code: "gateway_misconfigured",
    error: state.kind === "loopback"
      ? "The configured gateway URL points at a loopback or private address, which a serverless function cannot reach."
      : state.kind === "insecure"
        ? "The configured gateway URL uses plaintext HTTP, which a Vercel function must not use for a credentialed request."
        : "The configured gateway URL is not a valid http(s) origin.",
    hint: `Fix ${GATEWAY_URL_ENV} or set ${GATEWAY_PUBLIC_URL_ENV} to a public origin on the server — the configured value cannot resolve from this deployment.`,
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
  /** Fixed route ceiling, cancellation signal, and sanitised correlation ID. */
  context?: GatewayRequestContext;
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
 * Context-free GETs in flight right now, keyed by path.
 *
 * Two route handlers asking the gateway for the same payload in the same
 * moment made two upstream round trips. The browser side of this was already
 * solved at a better layer — `lib/use-book.ts` and `lib/use-system-health.ts`
 * own the shared polls and `workspace-routing-nav.test.ts` fails the build if a
 * panel fetches them itself — so what is left is server-side collapsing:
 * context-free server reads, separate callers, one upstream call.
 *
 * Browser proxy requests stay out: their context carries an abort signal and
 * correlation id that another caller must not inherit. The browser read cache
 * already removes duplicates within one mounted desk before this boundary.
 *
 * GET only. POST and PATCH move state and two of them are two intentions, not
 * one repeated question; collapsing them would silently drop an order.
 *
 * Safe to key on the path alone because the gateway credential is this
 * SERVER's, from the environment — `gatewayHeaders` reads no per-user value —
 * so the answer does not vary by who asked. If a per-identity header is ever
 * added to that function, this key has to grow with it or one desk will read
 * another's book. That is the one way this goes wrong.
 */
/** Structured-cloned per waiter: a shared success would hand two callers the
 *  same object, and a route that mutated its payload before serialising would
 *  corrupt the other's. The clone costs microseconds against a network hop. */
function cloneResult<T>(result: GatewayResult<unknown>): GatewayResult<T> {
  if (!result.ok) return result as GatewayResult<T>;
  return { ok: true, data: structuredClone(result.data) as T };
}

import { shareGet } from "./gateway-inflight";

/**
 * Re-exported so importers keep the names they had when the join lived here.
 * `gateway-transport.test.ts` reads them, and the split is a file boundary
 * rather than a contract change.
 */
export { JOIN_FLOOR_MS, joinIsWorthIt } from "./gateway-inflight";

function availableBudgetMs(options: CallOptions): number {
  const configured = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return options.context
    ? Math.max(0, Math.min(configured, remainingGatewayBudgetMs(options.context)))
    : Math.max(0, configured);
}

export async function callGateway<T = unknown>(path: string, options: CallOptions = {}): Promise<GatewayResult<T>> {
  const method = options.method ?? "GET";
  // A context owns cancellation and correlation, so another caller cannot
  // share it. Same-desk URL dedupe already happens before this server hop.
  if (method === "GET" && !options.context) {
    return shareGet<GatewayResult<T>>(
      path,
      availableBudgetMs(options),
      () => callGatewayUncached<T>(path, options),
      (result) => cloneResult<T>(result),
    );
  }
  return callGatewayUncached<T>(path, options);
}

async function callGatewayUncached<T = unknown>(path: string, options: CallOptions = {}): Promise<GatewayResult<T>> {
  // Before the configuration check: a caller passing the wrong body type is a
  // programming error, and it must not stay hidden on deployments where the
  // gateway happens to be unset — that is exactly how this one survived review.
  if (options.body !== undefined) assertUnserialised(options.body);
  const method = options.method ?? "GET";

  const state = gatewayState();
  if (state.kind === "absent") return { ok: false, failure: notConfigured(options.subject ?? path) };
  if (state.kind !== "url") return { ok: false, failure: misconfigured(state) };
  // A GET is safe to repeat through the same gateway's recovery ingress. A
  // POST/PATCH is not: a transport failure does not prove the first ingress
  // failed before the state change reached the gateway.
  const ingresses = gatewayIngresses();
  const selected = ingresses.find((ingress) => ingress.url.href === state.url.href);
  const bases = method === "GET"
    ? ingresses
    : [selected ?? { url: state.url, credential: "canonical" as const }];

  const timeoutMs = availableBudgetMs(options);
  if (timeoutMs <= 0) {
    return {
      ok: false,
      failure: {
        code: "gateway_timeout",
        error: "The risk gateway request budget was exhausted before dispatch.",
        status: 504,
      },
    };
  }
  const controller = new AbortController();
  let deadlineElapsed = false;
  let callerCancelled = options.context?.signal.aborted ?? false;
  const cancelFromCaller = () => {
    callerCancelled = true;
    controller.abort();
  };
  if (callerCancelled) {
    return {
      ok: false,
      failure: {
        code: "gateway_cancelled",
        error: "The workspace request was cancelled before the risk gateway answered.",
        status: 499,
      },
    };
  }
  options.context?.signal.addEventListener("abort", cancelFromCaller, { once: true });
  const timer = setTimeout(() => {
    deadlineElapsed = true;
    controller.abort();
  }, timeoutMs);

  try {
    let lastTransportError: unknown;
    for (let candidateIndex = 0; candidateIndex < bases.length; candidateIndex += 1) {
      const ingress = bases[candidateIndex];
      let response: Response;
      try {
        response = await gatewayFetch(new URL(path, ingress.url), {
          method,
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
          headers: gatewayHeadersForIngress(ingress, process.env, options.context, timeoutMs),
          // Callers pass plain objects; this boundary owns serialisation. The
          // guard runs at function entry (assertUnserialised).
          ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        });
      } catch (error) {
        lastTransportError = error;
        if (candidateIndex + 1 < bases.length && !deadlineElapsed && !callerCancelled) {
          continue;
        }
        throw error;
      }

      if (!response.ok) {
        const transientIngress = response.status === 502 || response.status === 503 || response.status === 504;
        if (method === "GET" && transientIngress && candidateIndex + 1 < bases.length) {
          await response.body?.cancel().catch(() => undefined);
          continue;
        }
        const authFailed = response.status === 401 || response.status === 403;
        return {
          ok: false,
          failure: {
            code: authFailed ? "gateway_auth_failed" : "gateway_rejected",
            error: authFailed
              ? "The risk gateway rejected this server's credential."
              : `The risk gateway responded with HTTP ${response.status}.`,
            hint: authFailed
              ? `Check ${ingress.credential === "recovery" ? GATEWAY_RECOVERY_TOKEN_ENV : GATEWAY_TOKEN_ENV} against the gateway's WEB_API_TOKEN.`
              : undefined,
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
    }
    throw lastTransportError ?? new Error("No usable gateway ingress was available.");
  } catch (error) {
    if (deadlineElapsed) {
      return {
        ok: false,
        failure: {
          code: "gateway_timeout",
          error: `The risk gateway did not answer within ${timeoutMs}ms.`,
          status: 504,
        },
      };
    }
    if (callerCancelled) {
      return {
        ok: false,
        failure: {
          code: "gateway_cancelled",
          error: "The workspace request was cancelled before the risk gateway answered.",
          status: 499,
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
    options.context?.signal.removeEventListener("abort", cancelFromCaller);
  }
}

/** Shape a failure into the JSON body this app returns, minus the status. */
export function failureBody(
  failure: GatewayFailure,
  context?: GatewayRequestContext,
): Record<string, unknown> {
  const { status, ...body } = failure;
  void status;
  return {
    ...body,
    ...(context ? { requestId: context.requestId, endpointClass: context.budgetClass } : {}),
  };
}
