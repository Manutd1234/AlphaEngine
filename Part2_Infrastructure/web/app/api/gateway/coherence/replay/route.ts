import { NextResponse } from "next/server";

import { callGateway, failureBody } from "@/lib/gateway";
import { isCoherenceReplay } from "@/lib/coherence/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Same-origin, read-only boundary to the coherence engine on the gateway.
 * The gateway address and bearer token never cross into the browser bundle.
 *
 * Never cached: the tape grows on every poll, so a cached ablation is an answer
 * about a shorter history than the one the reader is being shown the span of.
 */
export async function GET(request: Request) {
  const incoming = new URL(request.url).searchParams;
  const forwarded = new URLSearchParams();
  for (const key of ["since_ts_ns", "limit"]) {
    const value = incoming.get(key);
    if (value) forwarded.set(key, value);
  }
  const query = forwarded.toString();
  const result = await callGateway(`/api/coherence/replay${query ? `?${query}` : ""}`, {
    subject: "the ablation harness over the recorded tape",
    validate: isCoherenceReplay,
  });

  if (!result.ok) {
    return NextResponse.json(failureBody(result.failure), { status: result.failure.status });
  }
  return NextResponse.json(result.data, { headers: { "Cache-Control": "no-store" } });
}
