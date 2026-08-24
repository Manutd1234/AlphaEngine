import { NextResponse } from "next/server";

import { callGateway, failureBody } from "@/lib/gateway";
import { isCoherenceCalibrationHistory } from "@/lib/coherence/types-lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Same-origin, read-only boundary to the settled-score tape on the gateway.
 * The gateway address and bearer token never cross into the browser bundle.
 *
 * A sibling of `../route.ts` rather than a query on it, because they answer
 * different questions off different reads: that one scores whatever has settled
 * and returns one moment, this one returns the recorded series. It is also the
 * cheaper of the two — no harvest, no venue call, just the tape — so it carries
 * the default deadline where its neighbour needs 25 seconds.
 *
 * Never cached: this reads a tape that grows on the recorder's own cadence.
 */
export async function GET(request: Request) {
  const incoming = new URL(request.url).searchParams;
  const forwarded = new URLSearchParams();
  for (const key of ["since_ts_ns", "limit"]) {
    const value = incoming.get(key);
    if (value) forwarded.set(key, value);
  }
  const query = forwarded.toString();
  const result = await callGateway(`/api/coherence/calibration/history${query ? `?${query}` : ""}`, {
    subject: "the settled score over time",
    validate: isCoherenceCalibrationHistory,
  });

  if (!result.ok) {
    return NextResponse.json(failureBody(result.failure), { status: result.failure.status });
  }
  return NextResponse.json(result.data, { headers: { "Cache-Control": "no-store" } });
}
