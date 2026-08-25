import { NextResponse } from "next/server";

import { callGateway, failureBody } from "@/lib/gateway";
import { isEventsRead, type EventsRead } from "@/components/coherence/diffusion/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Same-origin boundary to the absorption ledger. The `state` discriminator is
 * passed through untouched: an unconfigured store, an unreachable one and an
 * empty one are three different sentences on the pane, and flattening them
 * into an empty list is the defect the field exists to prevent.
 */
export async function GET(request: Request) {
  const incoming = new URL(request.url).searchParams;
  const forwarded = new URLSearchParams();
  for (const key of ["limit", "kind", "symbol"]) {
    const value = incoming.get(key);
    if (value) forwarded.set(key, value);
  }
  const query = forwarded.toString();
  const result = await callGateway<EventsRead>(
    `/api/research/diffusion/events${query ? `?${query}` : ""}`,
    {
      subject: "the announcement calendar the desk is watching",
      validate: isEventsRead,
    },
  );

  if (!result.ok) {
    return NextResponse.json(failureBody(result.failure), { status: result.failure.status });
  }
  return NextResponse.json(result.data, { headers: { "Cache-Control": "no-store" } });
}
