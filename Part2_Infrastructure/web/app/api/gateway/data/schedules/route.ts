import { NextResponse } from "next/server";

import { callGateway, failureBody } from "@/lib/gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/gateway/data/schedules — the gateway's configured replay/backfill
 * schedule (`DATA_SCHEDULES`), valid entries and invalid ones with their
 * error, and when each last ran. Read-only.
 */
export async function GET() {
  const result = await callGateway<{ schedules: unknown[] }>("/api/data/schedules", {
    subject: "the replay and backfill schedule",
    validate: (payload) => typeof payload === "object" && payload !== null && Array.isArray((payload as { schedules?: unknown }).schedules),
  });
  if (!result.ok) return NextResponse.json(failureBody(result.failure), { status: result.failure.status });
  return NextResponse.json(result.data, { headers: { "Cache-Control": "no-store" } });
}
