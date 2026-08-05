import { NextResponse } from "next/server";

import { callGateway, failureBody } from "@/lib/gateway";
import { isPortfolioPayload } from "@/lib/portfolio-payload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Same-origin, read-only boundary to the authoritative FastAPI risk gateway.
 * The gateway address and bearer token never cross into the browser bundle.
 *
 * This used to carry its own hand-rolled copy of the URL/timeout/classification
 * logic and had drifted two private failure codes away from the shared
 * vocabulary in lib/gateway.ts — which meant the portfolio card and the blotter
 * could describe the same absent gateway in different words. One boundary now.
 */
export async function GET() {
  const result = await callGateway("/api/portfolio", {
    subject: "the portfolio book",
    validate: isPortfolioPayload,
  });

  if (!result.ok) {
    return NextResponse.json(failureBody(result.failure), { status: result.failure.status });
  }
  return NextResponse.json(result.data, { headers: { "Cache-Control": "no-store" } });
}
