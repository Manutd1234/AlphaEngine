import { NextResponse } from "next/server";

import { callGateway, failureBody } from "@/lib/gateway";
import { isCoherenceRfqPanel } from "@/lib/coherence/types-lab";
import { gatewayRequestContext, gatewayResponseHeaders } from "@/lib/gateway-request-context";
import { authorizeRfqAccount } from "@/lib/rfq-server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Same-origin, read-only boundary to the coherence lab on the gateway.
 * The gateway address and bearer token never cross into the browser bundle.
 *
 * No query parameters: the RFQ panel is whatever the signed read returns, and
 * there is nothing here for a caller to select. Never cached — it is a live
 * read of a private channel. Unlike the desk shell, this route requires a
 * server-verified account session: a guest pass is not an identity and must
 * never spend or receive an account-private venue read.
 */
export async function GET(request: Request) {
  const context = gatewayRequestContext(request, "H4");
  const responseHeaders = {
    ...gatewayResponseHeaders(context),
    "Cache-Control": "no-store",
    Vary: "Authorization",
  };

  // Authenticate before callGateway. Apart from preventing disclosure, this
  // prevents an unauthenticated caller from draining the venue's signed-read
  // budget by repeatedly asking this same-origin proxy to do the work.
  const authorization = await authorizeRfqAccount(request);
  if (!authorization.ok) {
    const { status, ...body } = authorization.failure;
    return NextResponse.json(
      { ...body, requestId: context.requestId, endpointClass: context.budgetClass },
      {
        status,
        headers: {
          ...responseHeaders,
          ...(status === 401 ? { "WWW-Authenticate": "Bearer" } : {}),
        },
      },
    );
  }

  const result = await callGateway("/api/coherence/rfq", {
    subject: "what the makers disagree about",
    validate: isCoherenceRfqPanel,
    timeoutMs: 25_000,
    context,
  });

  if (!result.ok) {
    return NextResponse.json(failureBody(result.failure, context), {
      status: result.failure.status,
      headers: responseHeaders,
    });
  }
  return NextResponse.json(result.data, { headers: responseHeaders });
}
