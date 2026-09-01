/**
 * Server-side account proof for the private RFQ proxy.
 *
 * The desk cookie is intentionally not an authorization credential. It is an
 * unsigned routing pass, and a guest can mint one on demand. The RFQ route can
 * expose account-private Kalshi data, so it accepts only a Supabase access
 * token that Supabase itself verifies on this request, and then only for an
 * account with a server-provisioned active assignment to this desk.
 */

import { createClient } from "@supabase/supabase-js";

export const RFQ_AUTH_VERIFY_TIMEOUT_MS = 5_000;
/** The single desk this deployment's gateway and Kalshi account serve. */
export const RFQ_DESK_ID = "00000000-0000-0000-0000-000000000001";

export type RfqAccountAuthorization =
  | { ok: true; accountId: string; deskId: string }
  | {
      ok: false;
      failure: {
        code:
          | "rfq_auth_not_configured"
          | "rfq_auth_required"
          | "rfq_auth_invalid"
          | "rfq_auth_unavailable"
          | "rfq_auth_membership_required"
          | "rfq_auth_membership_unavailable";
        error: string;
        hint?: string;
        status: 401 | 403 | 503;
      };
    };

function bearer(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

function authErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("status" in error)) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

/**
 * Verify the caller before the route spends a signed venue read.
 *
 * The request-scoped client persists and refreshes nothing. Its fetch is
 * bounded so identity verification AND the membership lookup share one local
 * deadline. The route's H4 clock already runs while this executes, so any auth
 * latency correctly reduces the budget later propagated to the risk gateway.
 *
 * `desk_risk_limits` is the existing membership authority: a row binds a user
 * to a desk, `is_active` revokes it, RLS lets an account read only its own row,
 * and authenticated INSERT/DELETE is explicitly revoked. It is therefore a
 * server-provisioned assignment rather than a row any signed-up user can mint.
 */
export async function authorizeRfqAccount(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RfqAccountAuthorization> {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  if (!url || !anonKey) {
    return {
      ok: false,
      failure: {
        code: "rfq_auth_not_configured",
        error: "Account verification is not configured, so the private RFQ read is unavailable.",
        hint: "Configure Supabase authentication on this deployment before enabling the RFQ proxy.",
        status: 503,
      },
    };
  }

  const token = bearer(request);
  if (!token) {
    return {
      ok: false,
      failure: {
        code: "rfq_auth_required",
        error: "Sign in with an account to read the private RFQ channel.",
        status: 401,
      },
    };
  }

  const deadlineAtMs = Date.now() + RFQ_AUTH_VERIFY_TIMEOUT_MS;
  const client = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      // PostgREST must evaluate the membership query as this user so its RLS
      // policy remains part of the boundary. The token is never forwarded to
      // the risk gateway; that call is built separately after this returns.
      headers: { Authorization: `Bearer ${token}` },
      fetch: (input, init) => {
        const deadline = AbortSignal.timeout(Math.max(1, deadlineAtMs - Date.now()));
        const signals = [request.signal, deadline, ...(init?.signal ? [init.signal] : [])];
        const signal = AbortSignal.any(signals);
        return globalThis.fetch(input, { ...init, signal });
      },
    },
  });

  let accountId: string;
  try {
    const { data, error } = await client.auth.getUser(token);
    if (!error && data.user?.id) accountId = data.user.id;
    else {
      const status = authErrorStatus(error);
      if (status === 400 || status === 401 || status === 403 || (!error && !data.user)) {
        return {
          ok: false,
          failure: {
            code: "rfq_auth_invalid",
            error: "The account session is no longer valid. Sign in again before reading the private RFQ channel.",
            status: 401,
          },
        };
      }
      return {
        ok: false,
        failure: {
          code: "rfq_auth_unavailable",
          error: "The account session could not be verified, so no private RFQ read was attempted.",
          hint: "Check the Supabase Auth deployment and retry after account verification recovers.",
          status: 503,
        },
      };
    }
  } catch {
    return {
      ok: false,
      failure: {
        code: "rfq_auth_unavailable",
        error: "The account session could not be verified, so no private RFQ read was attempted.",
        hint: "Check the Supabase Auth deployment and retry after account verification recovers.",
        status: 503,
      },
    };
  }

  try {
    const { data: membership, error } = await client
      .from("desk_risk_limits")
      .select("desk_id")
      .eq("desk_id", RFQ_DESK_ID)
      .eq("user_id", accountId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (error) {
      return {
        ok: false,
        failure: {
          code: "rfq_auth_membership_unavailable",
          error: "Desk membership could not be verified, so no private RFQ read was attempted.",
          hint: "Check the desk_risk_limits schema, grants and RLS policy in Supabase.",
          status: 503,
        },
      };
    }
    if (!membership || membership.desk_id !== RFQ_DESK_ID) {
      return {
        ok: false,
        failure: {
          code: "rfq_auth_membership_required",
          error: "This account is not an active member of the desk that owns the private RFQ channel.",
          status: 403,
        },
      };
    }
    return { ok: true, accountId, deskId: RFQ_DESK_ID };
  } catch {
    return {
      ok: false,
      failure: {
        code: "rfq_auth_membership_unavailable",
        error: "Desk membership could not be verified, so no private RFQ read was attempted.",
        hint: "Check the desk_risk_limits schema, grants and RLS policy in Supabase.",
        status: 503,
      },
    };
  }
}
