import { NextRequest, NextResponse } from "next/server";

import { gatewayBase as sharedGatewayBase } from "@/lib/gateway";

import { emit } from "@/lib/observability";
import { authorise, guardMode, OPERATOR_TOKEN_ENV } from "@/lib/operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/gateway/risk — the workspace's only write path to the risk gateway.
 * Body: { action: "halt" | "resume" | "flatten", reason?, symbol?, confirm }
 *
 * Everything else in this app reads. This halts a desk or closes a book, so it
 * is built to a different standard than the panels around it.
 *
 * ── Two independent gates, on purpose ───────────────────────────────────────
 * The gateway authenticates every caller with `X-AlphaEngine-Token`, which lives
 * only on this server and never reaches the browser — the same arrangement the
 * read-only portfolio proxy already uses. That alone would be enough to *reach*
 * the gateway, and it is deliberately not enough to *use* this route.
 *
 * A second gate, `ALPHAENGINE_OPERATOR_TOKEN`, is required in production exactly
 * as it is for the systems console's actions. The reason is that these two
 * credentials answer different questions. The gateway token says "this
 * deployment is allowed to talk to that gateway". The operator token says "this
 * *request* is allowed to change something". A deployment that can read a book
 * should not automatically be able to flatten it, and collapsing the two would
 * mean the moment anyone wires up the portfolio view they also expose a
 * one-request kill switch on a public URL.
 *
 * ── Flatten is composed, not delegated ──────────────────────────────────────
 * The gateway has no flatten endpoint — `POST /api/orders/flatten` does not
 * exist, and a hand-off card in this repo pointed at it, which would have 404ed.
 * So flatten is built from what the gateway *does* expose: read the authoritative
 * book, then submit one opposite-side MARKET order per open position through
 * `POST /api/orders`, which is risk-gated like any other order. That matters —
 * a flatten that bypassed the pre-trade gates would be a second, unaudited
 * execution path, and every order here returns the same decision vector a manual
 * order would.
 *
 * Orders are submitted **sequentially**. Firing them in parallel would race the
 * gateway's own exposure accounting, so a book that should partly fill could
 * have every leg accepted against the same stale state.
 */

const TIMEOUT_MS = 12_000;

/** Actions this route will relay, and whether they can move a position. */
const ACTIONS = ["halt", "resume", "flatten"] as const;
type Action = (typeof ACTIONS)[number];

/**
 * The word an operator must type back.
 *
 * A confirm flag the client sets for itself is not a confirmation, it is a
 * second click. Requiring the literal action name means an accidental replay of
 * a captured request body is the only way to trigger this without having read
 * what it does.
 */
const CONFIRM_WORD: Record<Action, string> = {
  halt: "HALT",
  resume: "RESUME",
  flatten: "FLATTEN",
};

interface GatewayPosition {
  symbol: string;
  side: "LONG" | "SHORT" | "FLAT";
  notional: number;
  quantity: number;
}

/**
 * Delegates to the shared resolver so `gatewayConnected` below cannot say true
 * for a URL the shared boundary would refuse — a loopback address baked into a
 * deployment once made this route report a connected gateway while every fetch
 * through it failed, which is the worst possible answer for the one field
 * operators check first.
 */
function gatewayBase(): URL | null {
  return sharedGatewayBase();
}

function gatewayHeaders(): HeadersInit {
  const token = process.env.ALPHAENGINE_GATEWAY_TOKEN?.trim();
  return {
    "Content-Type": "application/json",
    accept: "application/json",
    ...(token ? { "X-AlphaEngine-Token": token } : {}),
  };
}

async function callGateway(
  base: URL,
  path: string,
  init: RequestInit,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(new URL(path, base), {
      ...init,
      cache: "no-store",
      signal: controller.signal,
      headers: gatewayHeaders(),
    });
    const body = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, body };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: { error: controller.signal.aborted ? `timed out after ${TIMEOUT_MS}ms` : (err as Error).message },
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: NextRequest) {
  // Gate 1: may this request change anything at all?
  const rejection = authorise(request.headers.get("authorization"));
  if (rejection) {
    const { status, ...body } = rejection;
    return NextResponse.json(body, { status });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ code: "invalid_body", error: "Request body must be valid JSON." }, { status: 400 });
  }
  const input = (raw ?? {}) as Record<string, unknown>;

  const action = String(input.action ?? "") as Action;
  if (!(ACTIONS as readonly string[]).includes(action)) {
    return NextResponse.json(
      { code: "invalid_action", error: `action must be one of ${ACTIONS.join(", ")}` },
      { status: 400 },
    );
  }

  if (String(input.confirm ?? "").trim().toUpperCase() !== CONFIRM_WORD[action]) {
    return NextResponse.json(
      {
        code: "confirmation_required",
        error: `This action changes live risk state. Send confirm: "${CONFIRM_WORD[action]}" to proceed.`,
      },
      { status: 428 },
    );
  }

  // Gate 2: is there an authoritative gateway to talk to at all?
  const base = gatewayBase();
  if (!base) {
    return NextResponse.json(
      {
        code: "gateway_not_configured",
        error: "No risk gateway is connected in this environment, so there is nothing to act on.",
        hint: "Set ALPHAENGINE_GATEWAY_URL and ALPHAENGINE_GATEWAY_TOKEN on the server.",
      },
      { status: 503 },
    );
  }

  const symbol = typeof input.symbol === "string" && /^[A-Z0-9.\-]{1,20}$/i.test(input.symbol)
    ? input.symbol.toUpperCase()
    : undefined;
  const reason = typeof input.reason === "string" && input.reason.trim()
    ? input.reason.trim().slice(0, 200)
    : "manual action from the portfolio workspace";

  emit({
    level: "warn",
    source: "RiskGateway",
    message: `${action} requested${symbol ? ` for ${symbol}` : ""}`,
    fields: { action, symbol: symbol ?? null, guard: guardMode() },
  });

  if (action === "halt" || action === "resume") {
    const path = action === "halt" ? "/api/risk/kill" : "/api/risk/resume";
    const result = await callGateway(base, path, {
      method: "POST",
      body: JSON.stringify(action === "halt" ? { reason, symbol } : { symbol }),
    });
    return relay(action, result, { symbol, reason });
  }

  // ---- flatten ----------------------------------------------------------
  const book = await callGateway(base, "/api/portfolio", { method: "GET" });
  if (!book.ok) return relay("flatten", book, { symbol, reason });

  const positions = (
    (book.body as { exposure?: { positions?: GatewayPosition[] } })?.exposure?.positions ?? []
  ).filter((p) => p.side !== "FLAT" && p.notional > 0 && (!symbol || p.symbol === symbol));

  if (!positions.length) {
    return NextResponse.json({
      ok: true,
      action: "flatten",
      summary: symbol ? `${symbol} is already flat.` : "The book is already flat — no orders were sent.",
      orders: [],
    });
  }

  // Sequential, never parallel: the gateway's exposure accounting is stateful,
  // and concurrent submissions would all be gated against the same stale book.
  const orders: Array<Record<string, unknown>> = [];
  for (const position of positions) {
    const result = await callGateway(base, "/api/orders", {
      method: "POST",
      body: JSON.stringify({
        symbol: position.symbol,
        side: position.side === "LONG" ? "SELL" : "BUY",
        notional: Math.abs(position.notional),
        order_type: "MARKET",
        strategy: "flatten",
      }),
    });
    orders.push({
      symbol: position.symbol,
      side: position.side === "LONG" ? "SELL" : "BUY",
      notional: Math.abs(position.notional),
      accepted: result.ok,
      status: result.status,
      // The gateway's own decision vector, relayed verbatim — a rejection here
      // is the pre-trade gates doing their job, not this route failing.
      decision: result.body,
    });
  }

  const accepted = orders.filter((o) => o.accepted).length;
  emit({
    level: accepted === orders.length ? "warn" : "error",
    source: "RiskGateway",
    message: `flatten submitted ${accepted}/${orders.length} orders`,
    fields: { accepted, total: orders.length },
  });

  return NextResponse.json({
    ok: accepted === orders.length,
    action: "flatten",
    summary:
      accepted === orders.length
        ? `Submitted ${accepted} closing ${accepted === 1 ? "order" : "orders"} through the risk gates.`
        : `${accepted} of ${orders.length} closing orders were accepted — the rest were rejected by the pre-trade gates.`,
    caveat: "Every order was risk-gated exactly like a manual one. A rejection is a gate firing, not a transport failure.",
    orders,
  });
}

/** One shape for a relayed gateway response, with auth failures reclassified. */
function relay(
  action: string,
  result: { ok: boolean; status: number; body: unknown },
  context: { symbol?: string; reason: string },
): NextResponse {
  if (result.ok) {
    return NextResponse.json({
      ok: true,
      action,
      summary:
        action === "halt"
          ? `Kill switch engaged${context.symbol ? ` for ${context.symbol}` : " across the book"}.`
          : `Trading resumed${context.symbol ? ` for ${context.symbol}` : " across the book"}.`,
      gateway: result.body,
    });
  }
  // Never proxy the gateway's status code straight through: a 401 from it is not
  // a 401 from us, and a browser that saw one would prompt for the wrong
  // credential entirely.
  const authFailed = result.status === 401 || result.status === 403;
  return NextResponse.json(
    {
      code: authFailed ? "gateway_auth_failed" : result.status === 0 ? "gateway_unreachable" : "gateway_rejected",
      error: authFailed
        ? "The risk gateway rejected this server's credential."
        : result.status === 0
          ? "The risk gateway did not answer."
          : `The risk gateway refused the ${action} (HTTP ${result.status}).`,
      hint: authFailed ? "Check ALPHAENGINE_GATEWAY_TOKEN against the gateway's WEB_API_TOKEN." : undefined,
      gateway: result.body,
    },
    { status: authFailed ? 502 : result.status === 0 ? 504 : 502 },
  );
}

/**
 * Whether the gateway is actually there, asked rather than assumed.
 *
 * `gatewayConnected` used to be `gatewayBase() !== null` — a URL is
 * configured. The comment on `gatewayBase` above already records this exact
 * class of bug being fixed once, for a loopback address that "reported a
 * connected gateway while every fetch through it failed, the worst possible
 * answer for the one field operators check first". Resolving the URL more
 * carefully narrowed that; it did not close it, because a correctly-shaped URL
 * pointing at a stopped process still resolves.
 *
 * The panel says GATEWAY ONLINE directly above a box that halts trading. It
 * has to mean the gateway answered.
 *
 * Deadlined at the same 2.5s the browser-side reads use, so a hung gateway
 * reports unreachable instead of holding the panel open on a spinner — the
 * failure an operator can least afford to wait out.
 */
const PROBE_DEADLINE_MS = 2_500;

async function probeGateway(base: URL | null): Promise<{ reachable: boolean; reason: string | null }> {
  if (!base) {
    return { reachable: false, reason: "No gateway URL is configured for this deployment." };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_DEADLINE_MS);
  try {
    const response = await fetch(new URL("/health", base), {
      cache: "no-store",
      signal: controller.signal,
      headers: gatewayHeaders(),
    });
    if (response.ok) return { reachable: true, reason: null };
    return {
      reachable: false,
      reason: `The gateway answered HTTP ${response.status} rather than a health report.`,
    };
  } catch (err) {
    return {
      reachable: false,
      reason: controller.signal.aborted
        ? `The gateway did not answer within ${PROBE_DEADLINE_MS}ms.`
        : `The gateway could not be reached: ${(err as Error).message}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** GET — what this route would do and whether it is currently permitted. */
export async function GET() {
  const mode = guardMode();
  const probe = await probeGateway(gatewayBase());
  return NextResponse.json({
    actions: ACTIONS,
    confirm: CONFIRM_WORD,
    guard: { mode, tokenEnv: OPERATOR_TOKEN_ENV },
    gatewayConnected: probe.reachable,
    /** Null when it answered. The panel prints this instead of guessing. */
    gatewayReason: probe.reason,
    note:
      "Flatten is composed from GET /api/portfolio plus one risk-gated POST /api/orders per open position — "
      + "the gateway exposes no flatten endpoint. Orders are submitted sequentially so they cannot race its exposure accounting.",
  });
}
