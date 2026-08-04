import { NextRequest, NextResponse } from "next/server";

import { callGateway, failureBody } from "@/lib/gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/gateway/audit?feed=orders|events|backtests&limit=n
 *
 * Read-only window onto the gateway's append-only audit log, which is what the
 * blotter, the alert feed and the server-side experiment history all read.
 *
 * Why one route with a `feed` parameter rather than three: these are the same
 * request to the same store differing only in which table is read, and the
 * browser polls them together. Splitting them would triplicate the timeout,
 * credential and failure-classification logic for no separation of concern.
 *
 * The gateway's own auth still applies — the token is attached server-side and
 * never reaches the browser. There is deliberately no write path here.
 */

const FEEDS = {
  orders: { path: "/api/audit/orders", max: 500 },
  events: { path: "/api/audit/events", max: 500 },
  backtests: { path: "/api/audit/backtests", max: 200 },
} as const;

type Feed = keyof typeof FEEDS;

export async function GET(request: NextRequest) {
  const requested = request.nextUrl.searchParams.get("feed") ?? "orders";
  if (!(requested in FEEDS)) {
    return NextResponse.json(
      { code: "invalid_feed", error: `feed must be one of ${Object.keys(FEEDS).join(", ")}` },
      { status: 400 },
    );
  }
  const feed = FEEDS[requested as Feed];

  // Clamp rather than reject: a slider that asks for too much history is a UI
  // detail, not an operator error, and this route reads nothing sensitive
  // beyond what the gateway already gates.
  const asked = Number(request.nextUrl.searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(asked) ? Math.min(Math.max(Math.trunc(asked), 1), feed.max) : 50;

  const result = await callGateway<unknown[]>(`${feed.path}?limit=${limit}`, {
    validate: (payload) => Array.isArray(payload),
  });

  if (!result.ok) {
    return NextResponse.json(failureBody(result.failure), { status: result.failure.status });
  }

  return NextResponse.json(
    { feed: requested, limit, rows: result.data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
