import { NextResponse } from "next/server";

import { callGateway, failureBody } from "@/lib/gateway";
import { isCoherenceRfqPanel } from "@/lib/coherence/types-lab";
import { gatewayRequestContext, gatewayResponseHeaders } from "@/lib/gateway-request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Same-origin, read-only boundary to the coherence lab on the gateway.
 * The gateway address and bearer token never cross into the browser bundle.
 *
 * No query parameters: the RFQ panel is whatever the signed read returns, and
 * there is nothing here for a caller to select. Never cached — it is a live
 * read of a private channel.
 */
export async function GET(request: Request) {
  const context = gatewayRequestContext(request, "H4");
  const result = await callGateway("/api/coherence/rfq", {
    subject: "what the makers disagree about",
    validate: isCoherenceRfqPanel,
    timeoutMs: 25_000,
    context,
  });
  const responseHeaders = {
    ...gatewayResponseHeaders(context),
    "Cache-Control": "no-store",
  };

  if (!result.ok) {
    return NextResponse.json(failureBody(result.failure, context), {
      status: result.failure.status,
      headers: responseHeaders,
    });
  }
  return NextResponse.json(result.data, { headers: responseHeaders });
}
