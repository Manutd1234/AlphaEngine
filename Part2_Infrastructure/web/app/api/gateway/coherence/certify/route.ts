import { NextResponse } from "next/server";

import { callGateway, failureBody } from "@/lib/gateway";
import { isCoherenceCertificate } from "@/lib/coherence/types";

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
  for (const key of ["event_ticker", "max_contracts"]) {
    const value = incoming.get(key);
    if (value) forwarded.set(key, value);
  }
  const query = forwarded.toString();
  const result = await callGateway(`/api/coherence/certify${query ? `?${query}` : ""}`, {
    subject: "a coherence certificate",
    // A deadline that matches what this route does. It reads the live exchange
    // — two round trips per event family, concurrently — so it is legitimately
    // slower than a route that serves from a store: measured 4.6s for two
    // families and 6.4s for four. The shared 8s default cut it off often enough
    // that the panel sat on a timeout while the same call, made by hand,
    // returned fine.
    timeoutMs: 25_000,
    validate: isCoherenceCertificate,
  });

  if (!result.ok) {
    return NextResponse.json(failureBody(result.failure), { status: result.failure.status });
  }
  return NextResponse.json(result.data, { headers: { "Cache-Control": "no-store" } });
}
