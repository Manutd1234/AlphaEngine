import { NextRequest, NextResponse } from "next/server";

import { callGateway, failureBody, gatewayBase, GATEWAY_URL_ENV } from "@/lib/gateway";
import { emit } from "@/lib/observability";
import { authorise, guardMode, OPERATOR_TOKEN_ENV } from "@/lib/operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/gateway/orders/{id}/cancel — pull one resting order.
 *
 * ── No typed-confirmation ritual, unlike `/api/gateway/risk` ────────────────
 * That route relays three named desk-wide controls behind a word the operator
 * must type back, because an accidental replay of a captured body must not be
 * able to halt a desk. The ceremony that suits a kill switch is wrong here: this
 * is a single order a trader pulls repeatedly, and a confirmation dialog on a
 * cancel is a dialog people learn to dismiss without reading — which is exactly
 * how the ritual stops protecting the action it was built for.
 *
 * The asymmetry is also about direction. A cancel only ever *reduces* exposure.
 * The failure mode a confirmation guards against — doing something large by
 * accident — has no equivalent here; the dangerous accident is failing to cancel,
 * so every obstacle between the trader and this route is a cost with no
 * corresponding benefit. The gateway agrees: `cancel_working` spends no
 * rate-limit token, because a book in trouble must always be able to get out.
 *
 * The operator gate stays, because it answers a different question. Reaching the
 * gateway and being allowed to *move* something are separate permissions, and a
 * deployment that can read a book still must not be able to reshape it from a
 * public URL without `ALPHAENGINE_OPERATOR_TOKEN`.
 */

/**
 * Order ids are server-minted (`uuid4().hex[:16]`), so this is a containment
 * bound rather than a format assertion. Pinning the exact hex shape would make
 * this route reject ids the gateway itself issued the day that format gains a
 * prefix; what actually has to be guaranteed is that nothing path-shaped or
 * unbounded reaches the URL builder.
 */
const ORDER_ID_RE = /^[A-Za-z0-9._\-]{1,64}$/;

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const rejection = authorise(request.headers.get("authorization"));
  if (rejection) {
    // The authorisation boundary stays first — a config check ahead of it would
    // turn a bad credential's 401 into a 503. But when the guard is locked
    // because no operator token EXISTS, the caller is about to be told to go set
    // one, follow the hint, and then discover a second missing dependency behind
    // it. One rejection should name every blocker it knows.
    const { status, ...body } = rejection;
    const blockers = [OPERATOR_TOKEN_ENV, ...(gatewayBase() ? [] : [GATEWAY_URL_ENV])];
    return NextResponse.json(
      guardMode() === "locked" ? { ...body, blockers } : body,
      { status, headers: NO_STORE },
    );
  }

  const orderId = (await context.params).id.trim();
  if (!ORDER_ID_RE.test(orderId)) {
    return NextResponse.json(
      { code: "invalid_order_id", error: "order id must be 1-64 characters of A-Z, a-z, 0-9, dot, underscore or dash." },
      { status: 400, headers: NO_STORE },
    );
  }

  // A body is optional here, and an unparseable one is NOT a 400 — the single
  // deviation from `app/api/gateway/orders/route.ts`, which rejects malformed
  // JSON outright. The difference is what the body carries. There, every field
  // changes what gets sent to a venue, so a garbled body means the trader's
  // screen and the audit log would disagree about what was asked for. Here the
  // only field is a free-text reason with a documented default, and refusing to
  // pull a resting order because its annotation would not parse is the wrong
  // failure in the one direction that always reduces risk.
  const raw = await request.json().catch(() => null);
  const input = (raw ?? {}) as Record<string, unknown>;
  const reason = typeof input.reason === "string" && input.reason.trim()
    ? input.reason.trim().slice(0, 200)
    : "manual cancel from the portfolio workspace";

  const result = await callGateway<Record<string, unknown>>(
    `/api/orders/${encodeURIComponent(orderId)}/cancel`,
    {
      subject: `the cancel for order ${orderId}`,
      method: "POST",
      body: { reason },
      validate: (payload) => typeof payload === "object" && payload !== null && "status" in payload,
    },
  );

  if (!result.ok) {
    // A 404 is not a fault, it is an answer: the order stopped resting between
    // the trader reading the book and pressing the button. Relaying it as the
    // shared boundary's blanket 502 would have the UI render "the gateway is
    // broken" for the single most ordinary race in order handling, and the
    // trader would go looking for an outage instead of refreshing the book.
    //
    // The explanation below is this route's own. `lib/gateway.ts` classifies an
    // upstream failure and discards its body, so the gateway's literal `detail`
    // string is not reachable from here — what is relayed faithfully is its
    // status, carried in `upstreamStatus` alongside the boundary's own verdict.
    if (result.failure.upstreamStatus === 404) {
      return NextResponse.json(
        {
          code: "order_not_resting",
          error: `${orderId} is not resting — it may have filled, expired, or already been cancelled.`,
          hint: "Re-read the working book; terminal orders live in the audit blotter, where there is nothing left to cancel.",
          gateway: failureBody(result.failure),
        },
        { status: 404, headers: NO_STORE },
      );
    }

    emit({
      level: "error",
      source: "RiskGateway",
      message: `cancel of ${orderId} could not be relayed`,
      fields: { code: result.failure.code, orderId },
    });
    return NextResponse.json(failureBody(result.failure), { status: result.failure.status, headers: NO_STORE });
  }

  emit({
    level: "warn",
    source: "RiskGateway",
    message: `cancelled resting order ${orderId}`,
    fields: { orderId, status: String(result.data.status ?? "?"), guard: guardMode() },
  });

  return NextResponse.json(
    { ok: true, order_id: orderId, reason, ack: result.data },
    { headers: NO_STORE },
  );
}
