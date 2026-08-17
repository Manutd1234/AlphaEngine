import { NextRequest, NextResponse } from "next/server";

import { callGateway, failureBody } from "@/lib/gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/gateway/data/quality?limit=n[&provider=][&capability=][&severity=][&since=]
 *
 * Older findings than the health snapshot's ledger view carries — the
 * gateway's durable, cross-instance data-quality ledger, read through the
 * same server-side credential the audit feed uses. Read-only; the browser
 * never holds the gateway token.
 */

const SEVERITIES = new Set(["fatal", "warn", "drift", "clean"]);
const NAME = /^[a-z0-9_.-]{1,64}$/i;

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const asked = Number(params.get("limit") ?? 100);
  const limit = Number.isFinite(asked) ? Math.min(Math.max(Math.trunc(asked), 1), 500) : 100;
  const query = new URLSearchParams({ limit: String(limit) });

  const provider = params.get("provider");
  if (provider && NAME.test(provider)) query.set("provider", provider);
  const capability = params.get("capability");
  if (capability && NAME.test(capability)) query.set("capability", capability);
  const severity = params.get("severity");
  if (severity && SEVERITIES.has(severity)) query.set("severity", severity);
  const since = params.get("since");
  if (since && Number.isFinite(Date.parse(since))) query.set("since", new Date(since).toISOString());

  const result = await callGateway<{ findings: unknown[]; total: number }>(
    `/api/data-quality/findings?${query}`,
    {
      subject: "the data-quality ledger",
      validate: (payload) =>
        typeof payload === "object" && payload !== null
        && Array.isArray((payload as { findings?: unknown }).findings),
    },
  );

  if (!result.ok) {
    return NextResponse.json(failureBody(result.failure), { status: result.failure.status });
  }

  return NextResponse.json(result.data, { headers: { "Cache-Control": "no-store" } });
}
