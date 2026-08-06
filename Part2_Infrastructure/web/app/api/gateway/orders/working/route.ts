import { NextRequest, NextResponse } from "next/server";

import { callGateway, failureBody } from "@/lib/gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/gateway/orders/working?symbol=BTCUSDT — the book that is still open.
 *
 * A sibling of `/api/gateway/orders` rather than a `GET` on it. That route's
 * `GET` already answers a different question — what this deployment will accept
 * and whether it is currently permitted — and it is the shape the ticket form
 * reads before it renders. Overloading it with live book state would mean one
 * response where a static capability list and a polled, changing dataset share
 * a cache policy and a failure mode.
 *
 * What this returns is deliberately *not* the blotter. `/api/gateway/audit?feed=orders`
 * is the terminal record — filled, rejected, cancelled, expired — and it only
 * ever grows. This is the set a desk can still act on right now, which is the
 * only set for which a cancel or a replace button means anything. Rendering a
 * cancel control against an audit row would offer the trader an action that
 * cannot succeed.
 *
 * ── No operator gate, on purpose ────────────────────────────────────────────
 * `ALPHAENGINE_OPERATOR_TOKEN` answers "may this *request* change something".
 * This one changes nothing, so gating it would buy no safety and cost a great
 * deal: a deployment without the operator token would show a trader an empty
 * resting book while orders were genuinely working, which is a worse failure
 * than any it prevents. `app/api/gateway/audit/route.ts` is the precedent —
 * reads are not operator-gated anywhere in this app. The gateway's own
 * credential still applies and is attached server-side.
 */

/**
 * Matches the gateway family's ticker shape (`app/api/gateway/orders/route.ts`,
 * `app/api/gateway/risk/route.ts`) rather than `lib/params`'s `SYMBOL_RE`, which
 * is tuned for market-data vendors and demands five characters. A gateway can
 * legitimately hold a resting order in `SI` or `BRK.B`.
 */
const SYMBOL_RE = /^[A-Z0-9.\-]{1,20}$/;

export async function GET(request: NextRequest) {
  const requested = request.nextUrl.searchParams.get("symbol");

  // An absent parameter and an empty one are the same statement — "no filter" —
  // and a select whose first option is "All symbols" submits the second. A
  // malformed *non-empty* symbol is a different thing entirely: it means the
  // caller meant something specific and got it wrong, so it is rejected rather
  // than quietly widened into a request for the whole book. Silently dropping
  // a bad filter is how a trader ends up reading the desk's resting orders
  // while believing they are reading one instrument's.
  const symbol = (requested ?? "").trim().toUpperCase();
  if (symbol && !SYMBOL_RE.test(symbol)) {
    return NextResponse.json(
      { code: "invalid_symbol", error: "symbol must be 1-20 characters of A-Z, 0-9, dot or dash." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const query = symbol ? `?symbol=${encodeURIComponent(symbol)}` : "";
  const result = await callGateway<unknown[]>(`/api/orders${query}`, {
    // The subject is what a person wanted; the path is how we asked.
    subject: "the resting order book",
    // An empty array is the correct answer for a desk with nothing working, so
    // only a non-array payload is malformed. Treating `[]` as a failure would
    // report a quiet book as a broken gateway.
    validate: (payload) => Array.isArray(payload),
  });

  if (!result.ok) {
    // no-store here too. A cached gateway failure is a panel that keeps showing
    // an outage after the gateway came back, which is the same class of lie as a
    // cached book.
    return NextResponse.json(
      failureBody(result.failure),
      { status: result.failure.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    // `symbol: null` says no filter was applied, which is not the same claim as
    // a filter that matched nothing — the caller can tell an unfiltered empty
    // book from an empty result for one instrument.
    { symbol: symbol || null, rows: result.data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
