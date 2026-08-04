import { NextRequest, NextResponse } from "next/server";

import { eventCursor, eventsSince, instanceId } from "@/lib/observability";
import { clampInt } from "@/lib/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/system/events?since=<seq>&limit=200
 *
 * The structured trace behind every dispatch decision — cache hits, ranked
 * skips with their reason, provider successes and failures, breaker
 * transitions, quota thresholds and operator actions.
 *
 * **Cursored by sequence number, not by timestamp.** Several of these events
 * routinely land inside the same millisecond, so a time cursor either drops one
 * or replays it; a monotonic sequence does neither. A client sends back the
 * `latest` it last saw and gets exactly what it has not seen.
 *
 * The response also carries `oldest`, which is the lowest sequence still in the
 * ring. A client whose cursor is below it has fallen behind and lost lines — it
 * can say so, rather than rendering a log with a silent hole in the middle.
 *
 * Polled rather than streamed on purpose. An SSE connection pins a client to one
 * serverless instance, and this instance's ring is the only one it can ever see;
 * a poll degrades honestly instead, and `instance` is echoed so a client that
 * lands somewhere else notices the discontinuity.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const since = clampInt(params.get("since"), 0, Number.MAX_SAFE_INTEGER, 0);
  const limit = clampInt(params.get("limit"), 1, 500, 200);

  const cursor = eventCursor();
  const events = eventsSince(since, limit);

  return NextResponse.json(
    {
      fetchedAt: new Date().toISOString(),
      instance: instanceId,
      cursor,
      // True when the caller's cursor predates the ring — lines existed that it
      // will never receive, and a log viewer must be able to mark the gap.
      dropped: since > 0 && cursor.oldest > since + 1,
      events,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
