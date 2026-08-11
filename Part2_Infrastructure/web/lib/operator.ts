/**
 * Operator actions — the console's only write path.
 * =================================================
 *
 * Everything else in the systems surface reads. This file is the part that
 * *changes* the running instance: purge a cache, close a breaker, knock a
 * provider out to watch failover happen, re-probe a service, reset a counter.
 *
 * Three rules shape it.
 *
 * **1. Reject, do not coerce.** `POST /api/backtest` sanitises an unrecognised
 * value into a documented default, which is right for a compute request — a bad
 * slider should not 400. It is wrong here. An operator who typed the wrong
 * provider id must not silently reset a different provider's breaker, so an
 * unrecognised field is a 400 and nothing is touched.
 *
 * **2. Closed by default in production.** Every action costs something real:
 * purging a cache spends upstream quota to refill it, a health probe spends a
 * call, resetting a ledger can let the instance overspend a vendor's actual
 * allowance. On a public deployment those are somebody else's dollars, so the
 * route is disabled unless `ALPHAENGINE_OPERATOR_TOKEN` is set. Locally it is
 * open, because a debugging tool that needs a secret before it will show you
 * anything is a debugging tool nobody uses.
 *
 * **3. Nothing here is permanent.** Simulated outages expire. Purged caches
 * refill. There is no action that can leave the deployment worse off after the
 * operator closes the tab, which is the property that makes it safe to hand a
 * "break the data plane" button to someone evaluating the system.
 *
 * The logic lives here rather than in the route so it can be tested the way the
 * rest of this codebase is tested: with an injected `MemoryStore` and an
 * explicit `env`, never over HTTP.
 */

import { timingSafeEqual } from "node:crypto";

import {
  activeOutages,
  clearAllOutages,
  clearOutage,
  emit,
  resetTelemetry,
  simulateOutage,
  OUTAGE_MAX_MS,
} from "./observability";
import { resetOpenBBHealthCache } from "./providers/openbb-health";
import { BY_ID, cacheKeys, getQuote, searchWeb } from "./providers/registry";
import { registerEnvSecrets } from "./providers/trace";
import { resetBreaker, resetQuota, store, Store } from "./providers/runtime";
import type { Capability } from "./providers/types";

// --------------------------------------------------------------------------
// The guard
// --------------------------------------------------------------------------

export type GuardMode =
  /** A token is configured; every mutating call must present it. */
  | "token"
  /** No token, but this is not a production build — actions are open. */
  | "open-dev"
  /** Production, deliberately opened for a demo deployment — see below. */
  | "open-demo"
  /** Production with no token configured — actions are refused outright. */
  | "locked";

export const OPERATOR_TOKEN_ENV = "ALPHAENGINE_OPERATOR_TOKEN";

/**
 * Paper-order-only convenience for a public assessment deployment.
 *
 * When this exact flag is `1` and the server has an operator token, a request
 * with no Authorization header may submit a new paper order. The token never
 * leaves the server. Any header the caller does provide is still authoritative
 * and must validate normally; a wrong override never falls back to this path.
 *
 * This does not apply to risk controls, cancel/replace, or Systems remediation.
 */
export const PAPER_ORDER_DEFAULT_ENV = "ALPHAENGINE_PAPER_ORDER_DEFAULT";

/**
 * The deliberate escape hatch from closed-by-default.
 *
 * Set to the literal string `"1"` and every operator surface — the order
 * ticket, risk actions, remediation — works for anyone who can reach the URL,
 * no token asked. That is the correct configuration for exactly one situation:
 * a paper-trading assessment demo whose reviewers must be able to click Send
 * without being handed a credential first, and it is survivable only because
 * of the property the module doc states — nothing an operator can do here is
 * permanent. Orders are paper and capped by the gateway's own gates, the kill
 * switch is reversible, purged caches refill, simulated outages expire.
 *
 * It is an exact-match on "1", not truthiness, for the same reason the strategy
 * whitelist is derived rather than listed: `ALPHAENGINE_OPERATOR_OPEN=false`
 * set by someone reasoning from other ecosystems must not open the gate.
 *
 * What it does NOT expose: the Python gateway's own credential. Server routes
 * still authenticate to the gateway with `ALPHAENGINE_GATEWAY_TOKEN`, which
 * never leaves the server — this flag opens the portal's door, not the vault's.
 */
export const OPERATOR_OPEN_ENV = "ALPHAENGINE_OPERATOR_OPEN";

export function guardMode(env: NodeJS.ProcessEnv = process.env): GuardMode {
  // Checked before the token so the two set together still mean "open" — the
  // flag is the more explicit statement of intent, and a demo that starts
  // demanding tokens because someone also configured one is a confusing demo.
  if (env[OPERATOR_OPEN_ENV]?.trim() === "1") return "open-demo";
  if (env[OPERATOR_TOKEN_ENV]?.trim()) return "token";
  return env.NODE_ENV === "production" ? "locked" : "open-dev";
}

export interface GuardRejection {
  status: number;
  code: string;
  error: string;
  hint?: string;
}

/**
 * Constant-time credential compare, length-checked first, because
 * `timingSafeEqual` throws on a length mismatch — and a thrown comparison is
 * both a 500 and a length oracle.
 */
function credentialMatches(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Never echoes what was presented, not even a prefix. */
const CREDENTIAL_REJECTED: GuardRejection = {
  status: 401,
  code: "operator_auth_failed",
  error: "The operator credential was rejected.",
};

/**
 * Decide whether this caller may mutate. `null` means yes.
 *
 * In the open modes a missing header uses the open door, but a *presented*
 * credential is an explicit override and is authoritative: it validates
 * against the server token or fails with the same 401 token mode gives. A
 * wrong credential must never be silently downgraded to the open door — an
 * operator who typed a token needs to know it was checked, or the override
 * means nothing. (Same principle `authorisePaperOrder` already states.)
 */
export function authorise(
  presented: string | null,
  env: NodeJS.ProcessEnv = process.env,
): GuardRejection | null {
  const mode = guardMode(env);
  if (mode === "open-dev" || mode === "open-demo") {
    if (presented === null) return null;
    const expected = env[OPERATOR_TOKEN_ENV]?.trim() ?? "";
    if (!expected) {
      return {
        ...CREDENTIAL_REJECTED,
        hint: `No ${OPERATOR_TOKEN_ENV} is configured on this deployment, so a presented credential cannot validate. Omit it to act in the open ${mode === "open-demo" ? "demo" : "dev"} mode.`,
      };
    }
    const supplied = presented.replace(/^Bearer\s+/i, "").trim();
    return credentialMatches(supplied, expected) ? null : CREDENTIAL_REJECTED;
  }
  if (mode === "locked") {
    return {
      status: 503,
      code: "operator_actions_disabled",
      error: "Operator actions are disabled in this environment.",
      hint: `Set ${OPERATOR_TOKEN_ENV} on the server to enable them, or ${OPERATOR_OPEN_ENV}=1 to open them without a token on a demo deployment. Read-only system telemetry stays available without either.`,
    };
  }

  const expected = env[OPERATOR_TOKEN_ENV]!.trim();
  const supplied = (presented ?? "").replace(/^Bearer\s+/i, "").trim();
  return credentialMatches(supplied, expected) ? null : CREDENTIAL_REJECTED;
}

/**
 * Who an already-authorised call is acting as. Only meaningful after
 * `authorise` returned null: any surviving presented credential validated,
 * and absence means the open door admitted the call.
 */
export function operatorIdentity(presented: string | null): "operator" | "demo" {
  return presented === null ? "demo" : "operator";
}

/**
 * Whether typing a credential can elevate a call in the current mode — the
 * UI renders the optional override field only when it would actually work.
 */
export function tokenOverrideAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  const mode = guardMode(env);
  return (mode === "open-demo" || mode === "open-dev")
    && Boolean(env[OPERATOR_TOKEN_ENV]?.trim());
}

/** Whether this deployment offers its server-held credential for new paper orders. */
export function paperOrderDefaultAvailable(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[PAPER_ORDER_DEFAULT_ENV]?.trim() === "1" && guardMode(env) === "token";
}

/**
 * Authorise only `POST /api/gateway/orders`.
 *
 * Header presence means explicit override, including an empty or malformed
 * header. Only true absence may use the deployment default, which prevents a
 * mistyped pasted token from being silently accepted under another identity.
 */
export function authorisePaperOrder(
  presented: string | null,
  env: NodeJS.ProcessEnv = process.env,
): GuardRejection | null {
  if (presented !== null) return authorise(presented, env);
  if (paperOrderDefaultAvailable(env)) return null;
  return authorise(null, env);
}

// --------------------------------------------------------------------------
// Action shapes
// --------------------------------------------------------------------------

export const OPERATOR_ACTIONS = [
  "purge_cache",
  "reset_breaker",
  "simulate_outage",
  "clear_outage",
  "reset_quota",
  "probe_provider",
  "reload_providers",
  "clear_telemetry",
] as const;

export type OperatorActionName = (typeof OPERATOR_ACTIONS)[number];

export interface OperatorAction {
  action: OperatorActionName;
  /** Provider id, or `"all"` for the actions that accept it. */
  provider?: string;
  /** `purge_cache` only: `"all"`, a capability name, or `"symbol:BTCUSDT"`. */
  scope?: string;
  /** `simulate_outage` only, clamped to `OUTAGE_MAX_MS`. */
  ttlMs?: number;
}

/** Cache namespaces a purge may touch. Deliberately excludes `quota:` and `breaker:`. */
export const CACHE_PREFIXES: Capability[] = [
  "quote",
  "bars",
  "news",
  "fundamentals",
  "search",
  "scrape",
];

/** Actions for which `provider: "all"` is meaningful. */
const ACCEPTS_ALL = new Set<OperatorActionName>(["reset_breaker", "clear_outage"]);

/** Actions that require a specific provider. */
const REQUIRES_PROVIDER = new Set<OperatorActionName>([
  "reset_breaker",
  "simulate_outage",
  "clear_outage",
  "reset_quota",
  "probe_provider",
]);

const SYMBOL_RE = /^[A-Z0-9.\-]{1,20}$/;

export type ParseResult =
  | { ok: true; action: OperatorAction }
  | { ok: false; error: string };

/**
 * Validate a request body into an action, or say precisely what is wrong.
 *
 * Every rejection names the field and the accepted values, because the consumer
 * of this message is a developer holding a curl command, not an end user.
 */
export function parseAction(body: unknown): ParseResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "expected a JSON object body" };
  }
  const raw = body as Record<string, unknown>;
  const name = raw.action;
  if (typeof name !== "string" || !(OPERATOR_ACTIONS as readonly string[]).includes(name)) {
    return { ok: false, error: `unknown action; expected one of ${OPERATOR_ACTIONS.join(", ")}` };
  }
  const action = name as OperatorActionName;

  let provider: string | undefined;
  if (raw.provider !== undefined) {
    if (typeof raw.provider !== "string") return { ok: false, error: "provider must be a string" };
    const candidate = raw.provider.trim().toLowerCase();
    const isAll = candidate === "all";
    if (isAll && !ACCEPTS_ALL.has(action)) {
      return { ok: false, error: `${action} does not accept provider "all"` };
    }
    if (!isAll && !BY_ID.has(candidate)) {
      return { ok: false, error: `unknown provider "${candidate}"; expected one of ${[...BY_ID.keys()].join(", ")}` };
    }
    provider = candidate;
  }
  if (REQUIRES_PROVIDER.has(action) && !provider) {
    return { ok: false, error: `${action} requires a provider` };
  }

  let scope: string | undefined;
  if (action === "purge_cache") {
    const requested = raw.scope === undefined ? "all" : raw.scope;
    if (typeof requested !== "string") return { ok: false, error: "scope must be a string" };
    const trimmed = requested.trim();
    const isCapability = (CACHE_PREFIXES as string[]).includes(trimmed);
    const symbolMatch = /^symbol:(.+)$/.exec(trimmed);
    if (trimmed !== "all" && !isCapability && !symbolMatch) {
      return {
        ok: false,
        error: `scope must be "all", a capability (${CACHE_PREFIXES.join(", ")}), or "symbol:TICKER"`,
      };
    }
    if (symbolMatch && !SYMBOL_RE.test(symbolMatch[1].toUpperCase())) {
      return { ok: false, error: "scope symbol is not a well-formed ticker" };
    }
    scope = symbolMatch ? `symbol:${symbolMatch[1].toUpperCase()}` : trimmed;
  } else if (raw.scope !== undefined) {
    return { ok: false, error: `${action} does not accept a scope` };
  }

  let ttlMs: number | undefined;
  if (action === "simulate_outage" && raw.ttlMs !== undefined) {
    const n = Number(raw.ttlMs);
    // `Number(null)` is 0 and `Number("abc")` is NaN; both must fall to the
    // default rather than clamp to the floor. Same trap `lib/params` documents.
    if (!Number.isFinite(n)) return { ok: false, error: "ttlMs must be a finite number" };
    ttlMs = Math.min(OUTAGE_MAX_MS, Math.max(10_000, Math.round(n)));
  } else if (action !== "simulate_outage" && raw.ttlMs !== undefined) {
    return { ok: false, error: `${action} does not accept ttlMs` };
  }

  return { ok: true, action: { action, provider, scope, ttlMs } };
}

// --------------------------------------------------------------------------
// Execution
// --------------------------------------------------------------------------

export interface ActionResult {
  action: OperatorActionName;
  /** One line an operator can read without expanding anything. */
  summary: string;
  /** What the caller should understand about the *limits* of what just happened. */
  caveat?: string;
  data?: Record<string, unknown>;
}

export interface ActionContext {
  env?: NodeJS.ProcessEnv;
  store?: Store;
}

/** Keys a purge would remove, given a scope. Exported so the UI can preview a count. */
export function cacheKeysInScope(scope: string, s: Store = store): string[] {
  const live = s.keys();
  const symbolMatch = /^symbol:(.+)$/.exec(scope);
  return live.filter((key) => {
    const [namespace, subject] = key.split(":");
    if (!(CACHE_PREFIXES as string[]).includes(namespace)) return false;
    if (scope === "all") return true;
    if (!symbolMatch) return namespace === scope;
    // News keys hold a comma-joined symbol list; quote/bars/fundamentals hold
    // one symbol. Splitting on comma covers both without a per-capability branch.
    return (subject ?? "").split(",").includes(symbolMatch[1]);
  });
}

export async function applyAction(
  action: OperatorAction,
  ctx: ActionContext = {},
): Promise<ActionResult> {
  const s = ctx.store ?? store;
  const env = ctx.env ?? process.env;

  switch (action.action) {
    case "purge_cache": {
      const scope = action.scope ?? "all";
      const doomed = cacheKeysInScope(scope, s);
      for (const key of doomed) s.del(key);
      log(action, `purged ${doomed.length} cache entries (${scope})`);
      return {
        action: action.action,
        summary: `Purged ${doomed.length} cached ${doomed.length === 1 ? "entry" : "entries"} (scope: ${scope}).`,
        caveat: doomed.length
          ? "The next request for each key goes upstream and spends real quota."
          : "Nothing matched — the cache was already cold for that scope.",
        data: { scope, purged: doomed.length, keys: doomed.slice(0, 40) },
      };
    }

    case "reset_breaker": {
      const targets = action.provider === "all" ? [...BY_ID.keys()] : [action.provider!];
      const reopened = targets.filter((id) => resetBreaker(id, s));
      log(action, `reset breakers: ${reopened.join(", ") || "none were open"}`);
      return {
        action: action.action,
        summary: reopened.length
          ? `Closed ${reopened.length} open ${reopened.length === 1 ? "circuit" : "circuits"}: ${reopened.join(", ")}.`
          : "No circuit was open — nothing to reset.",
        caveat: reopened.length
          ? "If the provider is still failing, three more consecutive failures reopen it."
          : undefined,
        data: { reset: reopened },
      };
    }

    case "simulate_outage": {
      const record = simulateOutage(action.provider!, action.ttlMs ?? OUTAGE_MAX_MS);
      const seconds = Math.round((record.expiresAt - Date.now()) / 1000);
      log(action, `simulated outage on ${action.provider} for ${seconds}s`);
      return {
        action: action.action,
        summary: `${action.provider} is held out of routing for ${seconds}s.`,
        caveat:
          "Requests now fail over to the next-ranked provider and report reason `simulated_outage` — on every instance, once each syncs the shared ledger. It restores itself — no cleanup required.",
        data: { provider: action.provider, expiresAt: record.expiresAt },
      };
    }

    case "clear_outage": {
      const cleared = action.provider === "all"
        ? clearAllOutages()
        : (clearOutage(action.provider!) ? 1 : 0);
      log(action, `cleared ${cleared} simulated outage(s)`);
      return {
        action: action.action,
        summary: cleared
          ? `Restored ${cleared} ${cleared === 1 ? "provider" : "providers"} to routing.`
          : "No simulated outage was active.",
        data: { cleared, remaining: activeOutages().map((o) => o.provider) },
      };
    }

    case "reset_quota": {
      const adapter = BY_ID.get(action.provider!)!;
      if (!adapter.meta.quota) {
        return {
          action: action.action,
          summary: `${action.provider} has no quota ledger — nothing to reset.`,
          caveat: "This provider is either keyless or metered by weight rather than by call count.",
        };
      }
      const cleared = resetQuota(adapter, s);
      log(action, `reset ${action.provider} quota ledger (was ${cleared})`);
      return {
        action: action.action,
        summary: `Cleared ${action.provider}'s local counter (was ${cleared}/${adapter.meta.quota.calls} this ${adapter.meta.quota.window}).`,
        // The single most important sentence in this file.
        caveat:
          "This resets OUR ledger (the deployment-shared counter, via the gateway), not the vendor's meter. The provider still believes it has served those calls, and further requests may be rejected upstream or billed.",
        data: { provider: action.provider, cleared },
      };
    }

    case "probe_provider":
      return probeProvider(action.provider!, { env, store: s });

    case "reload_providers": {
      const registered = registerEnvSecrets(env);
      resetOpenBBHealthCache();
      log(action, "re-evaluated provider configuration");
      return {
        action: action.action,
        summary: "Re-read provider configuration from the process environment and dropped the cached OpenBB verdict.",
        // Said plainly because the obvious reading of "hot reload" is wrong.
        caveat:
          "Next.js loads .env files once at boot: this re-evaluates the environment the process already has, it does not import new values from disk. A changed .env still needs a restart or a redeploy.",
        data: { secretsRegistered: registered },
      };
    }

    case "clear_telemetry": {
      resetTelemetry({ events: true, latency: true, cache: true });
      // Emitted after the clear so the log is never empty — the first line an
      // operator sees explains why everything above it disappeared.
      log(action, "telemetry buffers cleared");
      return {
        action: action.action,
        summary: "Cleared this instance's event ring, latency buffers and cache counters.",
        caveat:
          "Simulated outages and circuit-breaker state are untouched — those are behaviour, not observation. The gateway-merged ledger keeps other instances' samples, so pooled numbers return on the next sync.",
      };
    }
  }
}

function log(action: OperatorAction, message: string): void {
  emit({
    level: "warn",
    source: "Operator",
    message,
    fields: {
      action: action.action,
      provider: action.provider ?? null,
      scope: action.scope ?? null,
    },
  });
}

/**
 * Ask a provider for one real answer and time it.
 *
 * The cache entry is deleted first, on purpose. A probe that a cached value can
 * satisfy tests nothing — it would report a dead vendor as healthy for as long
 * as the TTL, which is exactly the window in which someone is standing there
 * asking whether it is dead.
 */
async function probeProvider(
  providerId: string,
  ctx: { env: NodeJS.ProcessEnv; store: Store },
): Promise<ActionResult> {
  const adapter = BY_ID.get(providerId)!;
  const capabilities = adapter.meta.capabilities;
  const startedAt = Date.now();

  const run = async (): Promise<{ capability: Capability; detail: string }> => {
    if (capabilities.includes("quote")) {
      // Pick a symbol whose asset class actually reaches this adapter: a crypto
      // symbol against an equity-only provider would be filtered out of the
      // candidate pool and "probe" would silently measure nothing.
      const symbol = adapter.meta.assets.includes("equity") ? "AAPL" : "BTCUSDT";
      ctx.store.del(cacheKeys.quote(symbol, providerId));
      const result = await getQuote(symbol, { provider: providerId, priority: "interactive", ...ctx });
      return { capability: "quote", detail: `${symbol} @ ${result.data.price} ${result.data.currency}` };
    }
    if (capabilities.includes("search")) {
      const query = "AlphaEngine provider health probe";
      ctx.store.del(cacheKeys.search(query, 1));
      const result = await searchWeb(query, 1, { provider: providerId, priority: "interactive", ...ctx });
      return { capability: "search", detail: `${result.data.length} document(s) returned` };
    }
    throw new Error(`${providerId} exposes no probeable capability`);
  };

  try {
    const { capability, detail } = await run();
    const ms = Date.now() - startedAt;
    emit({
      level: "info",
      source: "Operator",
      message: `probe ${providerId} ok in ${ms}ms`,
      fields: { provider: providerId, capability, ms },
    });
    return {
      action: "probe_provider",
      summary: `${providerId} answered a live ${capability} in ${ms}ms — ${detail}.`,
      // Precise rather than reassuring. Our own cache is bypassed, but Binance's
      // keyless endpoints additionally sit behind Next's fetch cache, so a
      // sub-5s repeat can be answered without leaving the process — and a 1ms
      // "probe" presented as proof the vendor is up would be exactly the kind of
      // false confidence this console exists to remove.
      caveat:
        "A real registry request with this provider pinned and our cache bypassed; it spent one unit of the provider's allowance. Binance's public endpoints also sit behind Next's 5s fetch cache, so a repeat inside that window may not have left the process.",
      data: { provider: providerId, capability, ms, ok: true },
    };
  } catch (err) {
    const ms = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : String(err);
    // A probe can fail two very different ways, and reporting them identically
    // is a lie in the more common one. If the single pinned candidate was
    // *skipped* — circuit open, quota spent, key missing — then no request was
    // sent, nothing was spent, and nothing counted toward the breaker. Saying
    // "counts toward the circuit breaker exactly as a real request would" there
    // would have an operator chasing a provider that was never contacted.
    const attempts = (err as { attempts?: { provider: string; reason: string; detail?: string }[] }).attempts ?? [];
    const skipped = attempts.find((a) => a.provider === providerId && a.reason !== "failed");
    emit({
      level: "error",
      source: "Operator",
      message: skipped
        ? `probe ${providerId} not sent — ${skipped.reason}`
        : `probe ${providerId} failed after ${ms}ms`,
      fields: { provider: providerId, ms, reason: skipped?.reason ?? "failed", error: message.slice(0, 160) },
    });
    if (skipped) {
      return {
        action: "probe_provider",
        summary: `${providerId} was not contacted — the registry skipped it (${skipped.reason}).`,
        caveat:
          "No request left this process, so nothing was spent and nothing counted toward the circuit breaker. Clear the condition above and probe again.",
        data: { provider: providerId, ms, ok: false, sent: false, reason: skipped.reason, detail: skipped.detail },
      };
    }
    return {
      action: "probe_provider",
      summary: `${providerId} did not answer (${ms}ms).`,
      caveat: "A failed probe counts toward the circuit breaker exactly as a real request would.",
      // `dispatch` already redacts provider messages before they reach here.
      data: { provider: providerId, ms, ok: false, sent: true, error: message.slice(0, 300) },
    };
  }
}
