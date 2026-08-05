import { NextRequest, NextResponse } from "next/server";

import { callGateway, failureBody } from "@/lib/gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/gateway/portfolio/history?limit=n
 *
 * The equity curve as the gateway's risk monitor persisted it, plus the period
 * returns derived from it.
 *
 * `/api/gateway/portfolio` is a snapshot and cannot answer "what did the book
 * do this month" — that is history, not state. Before this existed the curve
 * lived only in whichever browser tab happened to be open, so closing the tab
 * destroyed the record of how a drawdown built.
 */

export async function GET(request: NextRequest) {
  const asked = Number(request.nextUrl.searchParams.get("limit") ?? 400);
  const limit = Number.isFinite(asked) ? Math.min(Math.max(Math.trunc(asked), 1), 2000) : 400;

  const result = await callGateway<{ points?: unknown[] }>(`/api/portfolio/history?limit=${limit}`, {
    subject: "the equity history",
    // An empty history is a valid answer from a gateway that started five
    // minutes ago; only a payload with no points *array* is malformed.
    validate: (payload) =>
      typeof payload === "object" && payload !== null && Array.isArray((payload as { points?: unknown }).points),
  });

  if (!result.ok) {
    return NextResponse.json(failureBody(result.failure), { status: result.failure.status });
  }
  return NextResponse.json(result.data, { headers: { "Cache-Control": "no-store" } });
}
