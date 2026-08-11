import { NextRequest, NextResponse } from "next/server";

import {
  applyAction,
  authorise,
  guardMode,
  operatorIdentity,
  parseAction,
  tokenOverrideAvailable,
  OPERATOR_ACTIONS,
  OPERATOR_TOKEN_ENV,
} from "@/lib/operator";
import { instanceId } from "@/lib/observability";
import { buildSystemHealthSnapshot } from "@/lib/system-health-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/system/actions
 * Body: { action, provider?, scope?, ttlMs? }
 *
 * The console's write path. Purge a cache, close a breaker, hold a provider out
 * of routing to watch failover happen, re-probe a service, reset a local ledger,
 * clear the telemetry buffers.
 *
 * **Closed by default in production.** Every action costs something real — a
 * purge is refilled with live quota, a probe spends a call — so on a public
 * deployment this refuses with 503 unless `ALPHAENGINE_OPERATOR_TOKEN` is set.
 * Outside production it is open, because a debugging surface that demands a
 * secret before it will do anything is one nobody reaches for. `GET` on this
 * route reports which of those two worlds the caller is in, so the UI can show
 * the reason rather than a dead button.
 *
 * Errors mirror the gateway route's shape: a stable machine `code`, a sentence a
 * human can act on, and a `hint` naming the environment variable when the fix is
 * configuration. The presented credential is never echoed anywhere.
 */
export async function POST(request: NextRequest) {
  const presented = request.headers.get("authorization");
  const rejection = authorise(presented);
  if (rejection) {
    const { status, ...body } = rejection;
    return NextResponse.json(body, { status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { code: "invalid_body", error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = parseAction(body);
  if (!parsed.ok) {
    // Reject rather than coerce. `/api/backtest` clamps an out-of-range slider to
    // a default because a bad slider should not 400; an operator who mistyped a
    // provider id must not have a *different* provider's breaker reset for them.
    return NextResponse.json(
      { code: "invalid_action", error: parsed.error },
      { status: 400 },
    );
  }

  try {
    const result = await applyAction(parsed.action);
    // The ledgers this action just mutated are per-instance module memory. A
    // follow-up poll can land on a different lambda and report a world where
    // the action never happened — so the response itself carries the snapshot
    // of the instance that applied it, the one read guaranteed to agree.
    const health = await buildSystemHealthSnapshot("interactive");
    return NextResponse.json(
      {
        ok: true,
        instance: instanceId,
        appliedAt: new Date().toISOString(),
        // Who acted: "operator" validated a credential, "demo" used the open
        // door. Recorded so the audit story survives the open deployment.
        identity: operatorIdentity(presented),
        ...result,
        health,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      {
        code: "action_failed",
        error: err instanceof Error ? err.message : "The action could not be applied.",
      },
      { status: 500 },
    );
  }
}

/**
 * GET /api/system/actions — the catalogue and the guard's state.
 *
 * Lets the console render the operator panel correctly before anyone clicks
 * anything: which actions exist, and whether this deployment will accept them.
 * A presented Authorization header is checked (never spent — this route
 * mutates nothing) and reported back as `credential`, so the override field
 * can say "checked and valid" instead of guessing.
 */
export async function GET(request: NextRequest) {
  const mode = guardMode();
  const presented = request.headers.get("authorization");
  const credential =
    presented === null ? "none" : authorise(presented) === null ? "valid" : "rejected";
  return NextResponse.json(
    {
      instance: instanceId,
      guard: {
        mode,
        tokenEnv: OPERATOR_TOKEN_ENV,
        tokenOverrideAvailable: tokenOverrideAvailable(),
        detail:
          mode === "open-dev"
            ? "Non-production build — actions are open. Set the token before deploying."
            : mode === "open-demo"
              ? "Demo deployment — actions are open; a typed credential is still checked and is authoritative."
              : mode === "token"
                ? "A bearer token is required on every action."
                : `Production build with no ${OPERATOR_TOKEN_ENV} set — actions are refused.`,
      },
      credential,
      actions: OPERATOR_ACTIONS,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
