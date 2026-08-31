import { NextResponse } from "next/server";

import { callGateway, failureBody } from "@/lib/gateway";
import { isCoherenceBookHistory } from "@/lib/coherence/types-history";
import { gatewayRequestContext, gatewayResponseHeaders } from "@/lib/gateway-request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Same-origin, read-only boundary to one market's recorded quotes.
 * The gateway address and bearer token never cross into the browser bundle.
 *
 * A sibling of `../route.ts` rather than a flag on it, for the reason the
 * settled-score tape is a sibling of the scorecard: that one asks the VENUE what
 * a market is quoted at now, this one asks this deployment's own DuckDB what it
 * has been quoted at. Different source, different failure modes, and only one of
 * them can be answered while Kalshi is unreachable.
 *
 * `ticker` IS FORWARDED AND THE OTHERS ARE OPTIONAL, which is the one difference
 * from its neighbours' allow-lists: without it the gateway has no market to
 * answer about, and forwarding a fixed set rather than the whole query string is
 * what stops a crafted parameter reaching the gateway through this boundary.
 *
 * Never cached: the tape grows on the recorder's own cadence.
 */
export async function GET(request: Request) {
  const context = gatewayRequestContext(request, "H2");
  const incoming = new URL(request.url).searchParams;
  const forwarded = new URLSearchParams();
  for (const key of ["ticker", "since_ts_ns", "limit"]) {
    const value = incoming.get(key);
    if (value) forwarded.set(key, value);
  }
  const query = forwarded.toString();
  const result = await callGateway(`/api/coherence/books/history${query ? `?${query}` : ""}`, {
    subject: "one market's recorded quotes",
    validate: isCoherenceBookHistory,
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
