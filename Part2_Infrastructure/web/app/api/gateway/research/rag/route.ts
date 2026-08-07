import { NextRequest, NextResponse } from "next/server";

import { callGateway, failureBody } from "@/lib/gateway";
import { isResearchRagSearchResponse } from "@/lib/research-rag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/gateway/research/rag — similarity search over the desk's own
 * research corpus (backtests, execution summaries, risk incidents).
 *
 * Read-shaped despite the POST verb (a query body, no state change), so like
 * `gateway/audit` it is not operator-token-gated — the gateway's own auth
 * still applies server-side and the token never reaches the browser.
 *
 * The gateway's `state: "unavailable"` passes through untouched: the panel is
 * the one that must tell "found nothing" apart from "could not search", and
 * it can only do that if this proxy refuses to flatten the distinction.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "invalid_json", error: "Body must be JSON" }, { status: 400 });
  }

  const record = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const query = typeof record.query === "string" ? record.query.trim().slice(0, 2000) : "";
  if (!query) {
    return NextResponse.json({ code: "invalid_query", error: "query is required" }, { status: 400 });
  }
  const asked = Number(record.match_count ?? 3);
  const matchCount = Number.isFinite(asked) ? Math.min(Math.max(Math.trunc(asked), 1), 20) : 3;
  const kind = ["backtest_run", "execution_summary", "risk_incident"].includes(record.kind as string)
    ? (record.kind as string)
    : null;

  const result = await callGateway("/api/research/rag/search", {
    method: "POST",
    // A plain object: callGateway serialises. Pre-stringifying here sent a
    // quoted JSON *string* on the wire, which the Pydantic model cannot bind.
    body: { query, match_count: matchCount, kind },
    subject: "the research similarity index",
    validate: isResearchRagSearchResponse,
  });

  if (!result.ok) {
    return NextResponse.json(failureBody(result.failure), { status: result.failure.status });
  }
  return NextResponse.json(result.data, { headers: { "Cache-Control": "no-store" } });
}
