import { NextResponse } from "next/server";

import { callGateway, failureBody } from "@/lib/gateway";
import { isCoherenceFees } from "@/lib/coherence/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Same-origin, read-only boundary to the coherence engine on the gateway.
 * The gateway address and bearer token never cross into the browser bundle.
 *
 * Never cached: this is an argument about prices as they stand right now.
 */
export async function GET(request: Request) {
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
  });

  if (!result.ok) {
    return NextResponse.json(failureBody(result.failure), { status: result.failure.status });
  }
  return NextResponse.json(result.data, { headers: { "Cache-Control": "no-store" } });
}
