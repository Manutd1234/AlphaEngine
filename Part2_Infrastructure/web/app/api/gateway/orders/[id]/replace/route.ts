import { NextRequest, NextResponse } from "next/server";

import { callGateway, failureBody, gatewayBase, GATEWAY_URL_ENV } from "@/lib/gateway";
import { emit } from "@/lib/observability";
import { authorise, guardMode, OPERATOR_TOKEN_ENV } from "@/lib/operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/gateway/orders/{id}/replace — cancel-and-new on one resting order.
 *
 * A replace is not an edit. The gateway retires the original and submits a fresh
 * order that faces every pre-trade gate again, so it can be rejected exactly
 * where the first one passed — a size increase that now breaches concentration,
 * a reprice into a symbol that has since been halted. That is why the response
 * carries the *new* order's full check vector rather than the original's:
 * returning stale evidence would let a screen show a working order that no
 * longer exists.
 *
 * Which makes the HTTP status the important design decision here. A replacement
 * blocked by a gate is relayed with **200 and the whole decision**, matching
 * `app/api/gateway/orders/route.ts`. A blocked order is the system working, and
 * an error status would push the check vector — the only thing that explains
 * *which* limit bound — into a client's error path, where this app renders a
 * banner instead of the evidence. Only transport and configuration failures are
 * errors on this route.
 *
 * The operator gate is the same one order submission uses, for the same reason:
 * a replace moves risk, and reaching the gateway is not the same permission as
 * being allowed to move something.
 */

/** Mirrors `app/api/gateway/orders/route.ts` so a fat finger is caught identically on both paths. */
const MAX_NOTIONAL = 100_000_000;

/**
 * Ceilings on the other two legs of the same fat-finger problem. These are not
 * risk limits — the gateway owns those, and it is the only place that can, since
 * it holds the book. What they catch is a unit error: satoshis pasted where BTC
 * was meant, or a price in cents. Rejecting those here means the audit log never
 * records a 1e12-share order that the gates then had to refuse.
 */
const MAX_QUANTITY = 1_000_000_000;
const MAX_LIMIT_PRICE = 10_000_000;

/** See the cancel route: a containment bound on a server-minted id, not a format assertion. */
const ORDER_ID_RE = /^[A-Za-z0-9._\-]{1,64}$/;

const NO_STORE = { "Cache-Control": "no-store" } as const;

interface Rejection { code: string; error: string }

/**
 * The three sizeable fields, each with the code its rejection carries.
 *
 * Codes are spelled out rather than composed as `invalid_${field}`. A code that
 * exists only as a template cannot be grepped for out of a log line, which is
 * the single moment anyone ever needs it.
 */
const AMOUNTS = {
  quantity: { code: "invalid_quantity", ceiling: MAX_QUANTITY },
  notional: { code: "invalid_notional", ceiling: MAX_NOTIONAL },
  limit_price: { code: "invalid_limit_price", ceiling: MAX_LIMIT_PRICE },
} as const;

/** A positive, finite, bounded number — or a rejection naming the field. */
function parseAmount(raw: unknown, field: keyof typeof AMOUNTS): { value: number } | Rejection | null {
  const { code, ceiling } = AMOUNTS[field];
  if (raw === undefined || raw === null) return null;
  // The type guard is doing real work: `Number(true)` is 1 and `Number([])` is
  // 0, so a bare `Number()` would read a JSON boolean as a one-unit order. Only
  // a number or the string form a JSON client may send is a size at all.
  const value = typeof raw === "number" || typeof raw === "string" ? Number(raw) : NaN;
  // Finiteness is asserted before the range so "1e999" is rejected as unparseable
  // rather than as an Infinity that failed the ceiling — the two would print the
  // same message about a limit the trader never approached.
  if (!Number.isFinite(value) || value <= 0 || value > ceiling) {
    return { code, error: `${field} must be a positive number below ${ceiling.toLocaleString()}.` };
  }
  return { value };
}

function parseReplacement(input: Record<string, unknown>): { patch: Record<string, unknown> } | Rejection {
  const patch: Record<string, unknown> = {};

  const quantity = parseAmount(input.quantity, "quantity");
  if (quantity && !("value" in quantity)) return quantity;

  const notional = parseAmount(input.notional, "notional");
  if (notional && !("value" in notional)) return notional;

  // The gateway's `replace_working` would accept both and hand `OrderRequest`
  // a quantity *and* a notional, leaving it to decide which one the trader
  // meant. There is no correct guess: the two disagree about size the moment
  // the mark moves, and whichever wins, the audit log records a size nobody
  // asked for. Rejected rather than resolved.
  if (quantity && notional) {
    return {
      code: "ambiguous_size",
      error: "Send quantity or notional, not both — they describe the same field and would disagree.",
    };
  }
  if (quantity) patch.quantity = quantity.value;
  if (notional) patch.notional = notional.value;

  const limitPrice = parseAmount(input.limit_price, "limit_price");
  if (limitPrice && !("value" in limitPrice)) return limitPrice;
  if (limitPrice) patch.limit_price = limitPrice.value;

  // A replace that changes nothing is not a no-op — it retires a working order
  // and submits a new one, which loses queue position and re-faces every gate.
  // A trader who sends an empty body wanted something; refusing is the only
  // answer that does not silently spend their place in the book.
  if (!("quantity" in patch) && !("notional" in patch) && !("limit_price" in patch)) {
    return {
      code: "no_change_requested",
      error: "A replace must change quantity, notional or limit_price — it cancels and re-submits, which costs queue priority.",
    };
  }

  patch.reason = typeof input.reason === "string" && input.reason.trim()
    ? input.reason.trim().slice(0, 200)
    : "replace from the portfolio workspace";

  return { patch };
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const rejection = authorise(request.headers.get("authorization"));
  if (rejection) {
    // Locked means no operator token exists at all, and the caller is about to
    // be sent to set one — then discover a missing gateway URL behind it. One
    // rejection should name every blocker it knows.
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

  // Unlike the cancel route, a malformed body IS a 400 here: every field on a
  // replacement changes what reaches a venue, so falling back to a default
  // would submit a size or a price the trader never sent.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { code: "invalid_body", error: "Request body must be valid JSON." },
      { status: 400, headers: NO_STORE },
    );
  }

  const parsed = parseReplacement((raw ?? {}) as Record<string, unknown>);
  if (!("patch" in parsed)) {
    return NextResponse.json(parsed, { status: 400, headers: NO_STORE });
  }
  const { patch } = parsed;

  const result = await callGateway<Record<string, unknown>>(
    `/api/orders/${encodeURIComponent(orderId)}/replace`,
    {
      subject: `the replacement for order ${orderId}`,
      method: "POST",
      body: patch,
      validate: (payload) => typeof payload === "object" && payload !== null && "accepted" in payload,
    },
  );

  if (!result.ok) {
    // The order stopped resting between the trader reading the book and pressing
    // the button — the ordinary race, not a fault. Relayed as a 404 so the UI can
    // say "it already went" instead of rendering the shared boundary's blanket
    // 502 as an outage. `lib/gateway.ts` discards an upstream failure body, so
    // the sentence is this route's own; the gateway's status travels verbatim in
    // `upstreamStatus`.
    if (result.failure.upstreamStatus === 404) {
      return NextResponse.json(
        {
          code: "order_not_resting",
          error: `${orderId} is not resting, so there is nothing to replace — it may have filled, expired, or already been cancelled.`,
          hint: "Re-read the working book. The original is untouched; no replacement was submitted.",
          gateway: failureBody(result.failure),
        },
        { status: 404, headers: NO_STORE },
      );
    }

    emit({
      level: "error",
      source: "RiskGateway",
      message: `replacement for ${orderId} could not be submitted`,
      fields: { code: result.failure.code, orderId },
    });
    return NextResponse.json(failureBody(result.failure), { status: result.failure.status, headers: NO_STORE });
  }

  const accepted = result.data.accepted === true;
  const blockedBy = result.data.rejected_by;
  emit({
    level: accepted ? "info" : "warn",
    source: "RiskGateway",
    message: `replacement for ${orderId} ${accepted ? "accepted" : "rejected by pre-trade gates"}`,
    fields: {
      orderId,
      replacementId: typeof result.data.order_id === "string" ? result.data.order_id : null,
      symbol: typeof result.data.symbol === "string" ? result.data.symbol : null,
      rejectedBy: Array.isArray(blockedBy) ? blockedBy.join(",") : null,
    },
  });

  // 200 either way. The check vector is the answer, not an error page — and a
  // rejected replacement still means the original is gone, which the client can
  // only learn by reading the decision it is being handed here.
  return NextResponse.json(
    { ok: true, replaced: orderId, requested: patch, decision: result.data },
    { headers: NO_STORE },
  );
}
