import { NextRequest, NextResponse } from "next/server";

import { parsePriority } from "@/lib/providers/http";
import { buildSystemHealthSnapshot } from "@/lib/system-health-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/system/health[?priority=interactive|background]
 *
 * Everything the systems console needs in one request: provider readiness with
 * breaker shape and latency percentiles, the ranked failover chain per
 * capability with the node a request would actually land on, quota consumption,
 * cache hit accounting, active simulated outages, and the operator guard's mode.
 *
 * `priority` changes the answer and that is the point. A background poll is
 * fenced out of each provider's quota reserve, so the chain a scheduled refresh
 * would take is not always the chain an operator's click would take — and the
 * failover graph is worth very little if it only ever shows one of them.
 *
 * This is a superset of `GET /api/providers`, which still exists unchanged. No
 * credential material is returned here either: env variable *names* only, and
 * every free-text detail has been through the redactor on its way out.
 *
 * The payload itself is built in `lib/system-health-snapshot.ts`, shared with
 * the operator-actions route so an action's response can carry the snapshot of
 * the instance that applied it.
 */
export async function GET(request: NextRequest) {
  const priority = parsePriority(request.nextUrl.searchParams.get("priority"));
  const snapshot = await buildSystemHealthSnapshot(priority);
  return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
}
