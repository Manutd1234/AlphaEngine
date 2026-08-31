import { NextResponse } from "next/server";

import { callGateway, failureBody } from "@/lib/gateway";
import { isCoherenceStatus } from "@/lib/coherence/types";
import { gatewayRequestContext, gatewayResponseHeaders } from "@/lib/gateway-request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Same-origin, read-only boundary to the coherence engine on the gateway.
 * The gateway address and bearer token never cross into the browser bundle.
 *
 * Never cached: a cached order book is a wrong order book, and every figure on
 * this tab is an argument about prices as they stand right now.
 */
export async function GET(request: Request) {
  // Status performs two live venue probes. H1's three seconds was shorter than
  // a normal cold start and aborted a healthy gateway before its own bounded
  // degraded answer could arrive. H2 leaves two seconds beyond the gateway's
  // six-second probe ceiling for proxying, validation, and serialisation.
  const context = gatewayRequestContext(request, "H2");
  const incoming = new URL(request.url).searchParams;
  const forwarded = new URLSearchParams();
  for (const key of []) {
    const value = incoming.get(key);
    if (value) forwarded.set(key, value);
  }
  const query = forwarded.toString();
  const result = await callGateway(`/api/coherence/status${query ? `?${query}` : ""}`, {
    subject: "the coherence engine's own state",
    validate: isCoherenceStatus,
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
