import { NextResponse } from "next/server";

import { callGateway, failureBody } from "@/lib/gateway";
import { isCoherenceFees } from "@/lib/coherence/types";
import { gatewayRequestContext, gatewayResponseHeaders } from "@/lib/gateway-request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Same-origin, read-only boundary to the coherence engine on the gateway.
 * The gateway address and bearer token never cross into the browser bundle.
 *
 * Never cached: this is an argument about prices as they stand right now.
 */
export async function GET(request: Request) {
  const context = gatewayRequestContext(request, "H2");
  const incoming = new URL(request.url).searchParams;
  const forwarded = new URLSearchParams();
  for (const key of ["price", "contracts_fp", "fills", "series"]) {
    const value = incoming.get(key);
    if (value) forwarded.set(key, value);
  }
  const query = forwarded.toString();
  const result = await callGateway(`/api/coherence/fees${query ? `?${query}` : ""}`, {
    subject: "the three-component fee, worked through",
    validate: isCoherenceFees,
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
