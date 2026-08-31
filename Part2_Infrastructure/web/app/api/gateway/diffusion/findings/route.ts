import { NextResponse } from "next/server";

import { callGateway, failureBody } from "@/lib/gateway";
import { isFindingsRead, type FindingsRead } from "@/components/coherence/diffusion/types";
import { gatewayRequestContext, gatewayResponseHeaders } from "@/lib/gateway-request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Same-origin boundary to the absorption ledger. The `state` discriminator is
 * passed through untouched: an unconfigured store, an unreachable one and an
 * empty one are three different sentences on the pane, and flattening them
 * into an empty list is the defect the field exists to prevent.
 */
export async function GET(request: Request) {
  const context = gatewayRequestContext(request, "H2");
  const incoming = new URL(request.url).searchParams;
  const forwarded = new URLSearchParams();
  for (const key of ["limit"]) {
    const value = incoming.get(key);
    if (value) forwarded.set(key, value);
  }
  const query = forwarded.toString();
  const result = await callGateway<FindingsRead>(
    `/api/research/diffusion/findings${query ? `?${query}` : ""}`,
    {
      subject: "the measured relationships, positive and null alike",
      validate: isFindingsRead,
      context,
    },
  );
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
