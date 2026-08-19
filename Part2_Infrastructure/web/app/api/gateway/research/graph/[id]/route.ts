import { NextResponse } from "next/server";

import { callGateway, failureBody } from "@/lib/gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/gateway/research/graph/[id] — what is CONNECTED to one research
 * document, as opposed to what resembles it.
 *
 * `state: "unavailable"` passes through untouched. "Connected to nothing" and
 * "the graph could not be walked" are different answers, and only the panel can
 * render them differently — which it cannot do if this proxy flattens both into
 * an empty array.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const depth = Number(new URL(request.url).searchParams.get("depth") ?? 2);
  const bounded = Math.max(1, Math.min(4, Number.isFinite(depth) ? depth : 2));
  const result = await callGateway<{ state: string; connected: unknown[] }>(
    `/api/research/graph/${encodeURIComponent(id)}?max_depth=${bounded}`,
    {
      subject: "the research graph",
      validate: (payload) =>
        typeof payload === "object" && payload !== null
        && Array.isArray((payload as { connected?: unknown }).connected)
        && typeof (payload as { state?: unknown }).state === "string",
    },
  );
  if (!result.ok) return NextResponse.json(failureBody(result.failure), { status: result.failure.status });
  return NextResponse.json(result.data, { headers: { "Cache-Control": "no-store" } });
}
