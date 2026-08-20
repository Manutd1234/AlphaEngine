/**
 * The operator guard — who is allowed to change the running instance.
 *
 * Split out of `lib/operator.ts` when that file passed 610 lines. Rule 2 of the
 * three that shape the operator surface lives here in full:
 *
 * **Closed by default in production.** Every action costs something real:
 * purging a cache spends upstream quota to refill it, a health probe spends a
 * call, resetting a ledger can let the instance overspend a vendor's actual
 * allowance. On a public deployment those are somebody else's dollars, so the
 * route is disabled unless `ALPHAENGINE_OPERATOR_TOKEN` is set. Locally it is
 * open, because a debugging tool that needs a secret before it will show you
 * anything is a debugging tool nobody uses.
 *
 * Re-exported by `lib/operator.ts`; every route still imports `@/lib/operator`.
 */

import { timingSafeEqual } from "node:crypto";

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
