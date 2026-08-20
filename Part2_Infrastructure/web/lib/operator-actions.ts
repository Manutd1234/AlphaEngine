/**
 * The operator action grammar, and the validator that enforces it.
 *
 * Split out of `lib/operator.ts` when that file passed 610 lines. This module is
 * a WIRE CONTRACT with the systems console and with anyone holding a curl
 * command: the action names, the `provider: "all"` rule, and the purge scope
 * grammar — `"all"`, a capability name, or `"symbol:TICKER"` — are all fixed
 * here and nowhere else. Changing one of them changes the API.
 *
 * Rule 1 of the three that shape the operator surface lives here:
 *
 * **Reject, do not coerce.** `POST /api/backtest` sanitises an unrecognised
 * value into a documented default, which is right for a compute request — a bad
 * slider should not 400. It is wrong here. An operator who typed the wrong
 * provider id must not silently reset a different provider's breaker, so an
 * unrecognised field is a 400 and nothing is touched.
 *
 * Re-exported by `lib/operator.ts`; every route still imports `@/lib/operator`.
 */

import { OUTAGE_MAX_MS } from "./observability";
import { BY_ID } from "./providers/registry";
import type { Capability } from "./providers/types";

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
