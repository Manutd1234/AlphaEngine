import { NextResponse } from "next/server";

import { callGateway, failureBody } from "@/lib/gateway";
import { isCoherenceSettlementFeed } from "@/lib/coherence/types-lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Same-origin, read-only boundary to the coherence lab on the gateway.
 * The gateway address and bearer token never cross into the browser bundle.
 *
 * Never cached: every one of these reads a live venue or a growing tape.
 */
export async function GET(request: Request) {
  const incoming = new URL(request.url).searchParams;
  const forwarded = new URLSearchParams();
  for (const key of ["city"]) {
    const value = incoming.get(key);
    if (value) forwarded.set(key, value);
  }
  const query = forwarded.toString();
  const result = await callGateway(`/api/coherence/settlement${query ? `?${query}` : ""}`, {
    subject: "the index a contract settles against",
    validate: isCoherenceSettlementFeed,
    timeoutMs: 25_000,
  });

  if (!result.ok) {
    return NextResponse.json(failureBody(result.failure), { status: result.failure.status });
  }
  return NextResponse.json(result.data, { headers: { "Cache-Control": "no-store" } });
}
