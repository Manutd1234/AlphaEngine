import { NextResponse } from "next/server";

import { callGateway, failureBody } from "@/lib/gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/gateway/research/ml/runs — supervised research runs, newest first.
 *
 * The gateway's `state` passes through untouched. It separates "no runs" from
 * "no corpus", and the panel is the one that must tell those apart — it can
 * only do that if this proxy refuses to flatten the distinction into an empty
 * list, which is the same rule `gateway/research/rag` follows.
 */
export async function GET(request: Request) {
  const limit = new URL(request.url).searchParams.get("limit") ?? "25";
  const bounded = Math.max(1, Math.min(100, Number(limit) || 25));
  const result = await callGateway<{ state: string; runs: unknown[] }>(
    `/api/research/ml/runs?limit=${bounded}`,
    {
      subject: "the supervised research runs",
      validate: (payload) =>
        typeof payload === "object" && payload !== null
        && Array.isArray((payload as { runs?: unknown }).runs)
        && typeof (payload as { state?: unknown }).state === "string",
    },
  );
  if (!result.ok) return NextResponse.json(failureBody(result.failure), { status: result.failure.status });
  return NextResponse.json(result.data, { headers: { "Cache-Control": "no-store" } });
}
