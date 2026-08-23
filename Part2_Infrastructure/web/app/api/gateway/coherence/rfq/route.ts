import { NextResponse } from "next/server";

import { callGateway, failureBody } from "@/lib/gateway";
import { isCoherenceRfqPanel } from "@/lib/coherence/types-lab";

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
export async function GET() {
  const result = await callGateway("/api/coherence/rfq", {
    subject: "what the makers disagree about",
    validate: isCoherenceRfqPanel,
    timeoutMs: 25_000,
  });

  if (!result.ok) {
    return NextResponse.json(failureBody(result.failure), { status: result.failure.status });
  }
  return NextResponse.json(result.data, { headers: { "Cache-Control": "no-store" } });
}
