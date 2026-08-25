import { NextResponse } from "next/server";

import { callGateway, failureBody } from "@/lib/gateway";
import { isCoherenceFeeCurve } from "@/lib/coherence/types-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Same-origin, read-only boundary to the fee curve.
 * The gateway address and bearer token never cross into the browser bundle.
 *
 * A sibling of `../route.ts`, which works ONE case through. This returns the
 * whole curve, computed by the same kernel — the alternative was computing it
 * in the browser, which would be a third implementation of arithmetic the
 * gateway is this codebase's reference for.
 *
 * The cheapest read behind this boundary: pure arithmetic, no venue call and no
 * tape. It still carries `no-store`, because the schedule it prices from is
 * read from the deployment's own configuration and a cached curve would
 * survive a change to it.
 */
export async function GET(request: Request) {
  const incoming = new URL(request.url).searchParams;
  const forwarded = new URLSearchParams();
  for (const key of ["contracts_fp", "fills", "series"]) {
    const value = incoming.get(key);
    if (value) forwarded.set(key, value);
  }
  const query = forwarded.toString();
  const result = await callGateway(`/api/coherence/fees/curve${query ? `?${query}` : ""}`, {
    subject: "the fee at every price",
    validate: isCoherenceFeeCurve,
  });

  if (!result.ok) {
    return NextResponse.json(failureBody(result.failure), { status: result.failure.status });
  }
  return NextResponse.json(result.data, { headers: { "Cache-Control": "no-store" } });
}
