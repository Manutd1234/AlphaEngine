import { NextRequest, NextResponse } from "next/server";

import { callGateway, failureBody } from "@/lib/gateway";
import { emit } from "@/lib/observability";
import { authorise, guardMode, OPERATOR_TOKEN_ENV } from "@/lib/operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/gateway/orders — submit one order to the risk gateway.
 *
 * Deliberately a sibling of `/api/gateway/risk` rather than another action on
 * it. That route relays three named desk-wide controls behind a typed
 * confirmation word; this one carries arbitrary order parameters. Folding order
 * entry into an action enum would mean one route where "FLATTEN" and "buy $25k
 * of BTC" share a validation path, and the confirmation ritual that suits a
 * kill switch is wrong for a ticket a trader sends repeatedly.
 *
 * What is shared is the operator gate: reaching the gateway and being allowed
 * to *move* something are separate questions, so a deployment that can read a
 * book still cannot send an order without `ALPHAENGINE_OPERATOR_TOKEN`.
 *
 * Every field is validated here and rejected — never coerced. A notional that
 * arrives as "1e9" or a side of "SIDEWAYS" is a 400; silently substituting a
 * default would mean the trader's screen and the audit log disagree about what
 * was asked for.
 *
 * A rejection *from the gateway* is relayed with HTTP 200 and its full check
 * vector, because a blocked order is the system working. Only transport and
 * configuration failures are errors here.
 */

const SIDES = ["BUY", "SELL"] as const;
const TYPES = ["MARKET", "LIMIT"] as const;
const MAX_NOTIONAL = 100_000_000;

interface Rejection { code: string; error: string }

function parseOrder(input: Record<string, unknown>): { order: Record<string, unknown> } | Rejection {
  const symbol = String(input.symbol ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9.\-]{1,20}$/.test(symbol)) {
    return { code: "invalid_symbol", error: "symbol must be 1-20 characters of A-Z, 0-9, dot or dash." };
  }

  const side = String(input.side ?? "").trim().toUpperCase();
  if (!(SIDES as readonly string[]).includes(side)) {
    return { code: "invalid_side", error: `side must be one of ${SIDES.join(", ")}.` };
  }

  const orderType = String(input.order_type ?? "MARKET").trim().toUpperCase();
  if (!(TYPES as readonly string[]).includes(orderType)) {
    return { code: "invalid_order_type", error: `order_type must be one of ${TYPES.join(", ")}.` };
  }

  const notional = Number(input.notional);
  if (!Number.isFinite(notional) || notional <= 0 || notional > MAX_NOTIONAL) {
    return {
      code: "invalid_notional",
      error: `notional must be a positive number below ${MAX_NOTIONAL.toLocaleString()}.`,
    };
  }

  const order: Record<string, unknown> = { symbol, side, order_type: orderType, notional };

  if (orderType === "LIMIT") {
    const limitPrice = Number(input.limit_price);
    if (!Number.isFinite(limitPrice) || limitPrice <= 0) {
      return { code: "invalid_limit_price", error: "A LIMIT order needs a positive limit_price." };
    }
    order.limit_price = limitPrice;
  }

  // Free-text provenance. These are how a fill is later joined back to the
  // research that motivated it, so they are passed through as given (bounded)
  // rather than normalised into something the audit log cannot match.
  if (typeof input.strategy === "string" && input.strategy.trim()) {
    order.strategy = input.strategy.trim().slice(0, 60);
  }
  if (typeof input.client_order_id === "string" && input.client_order_id.trim()) {
    order.client_order_id = input.client_order_id.trim().slice(0, 80);
  }

  return { order };
}

export async function POST(request: NextRequest) {
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

  const parsed = parseOrder((raw ?? {}) as Record<string, unknown>);
  if (!("order" in parsed)) {
    return NextResponse.json(parsed, { status: 400 });
  }
  const { order } = parsed;

  const result = await callGateway<Record<string, unknown>>("/api/orders", {
    method: "POST",
    body: order,
    validate: (payload) => typeof payload === "object" && payload !== null && "accepted" in payload,
  });

  if (!result.ok) {
    emit({
      level: "error",
      source: "RiskGateway",
      message: `order to ${String(order.symbol)} could not be submitted`,
      fields: { code: result.failure.code, symbol: String(order.symbol) },
    });
    return NextResponse.json(failureBody(result.failure), { status: result.failure.status });
  }

  const accepted = result.data.accepted === true;
  const blockedBy = result.data.rejected_by;
  emit({
    level: accepted ? "info" : "warn",
    source: "RiskGateway",
    message: `${String(order.side)} ${String(order.symbol)} ${accepted ? "accepted" : "rejected by pre-trade gates"}`,
    fields: {
      symbol: String(order.symbol),
      side: String(order.side),
      notional: Number(order.notional),
      rejectedBy: Array.isArray(blockedBy) ? blockedBy.join(",") : null,
    },
  });

  // 200 either way: the check vector is the answer, not an error page.
  return NextResponse.json({ ok: true, submitted: order, decision: result.data });
}

/** GET — what this route accepts and whether it is currently permitted. */
export async function GET() {
  return NextResponse.json({
    sides: SIDES,
    orderTypes: TYPES,
    guard: { mode: guardMode(), tokenEnv: OPERATOR_TOKEN_ENV },
    note:
      "Every order passes the gateway's pre-trade gates. A rejection is returned with HTTP 200 and the full "
      + "check vector, because a blocked order is a result, not a failure.",
  });
}
