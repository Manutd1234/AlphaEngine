import { NextRequest, NextResponse } from "next/server";

import { callGateway, failureBody } from "@/lib/gateway";
import { authorise } from "@/lib/operator";
import { INTERVALS } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/gateway/data/jobs?limit=n      — recent replay and backfill jobs (the queue's memory)
 * POST /api/gateway/data/jobs              — submit one: {kind:"replay"|"backfill", …} (operator-gated)
 *
 * Replay re-runs a capability through this workspace's own validated fetch
 * path (the gateway calls `/api/system/inspect?refresh=1` back here);
 * backfill fetches bars for a date range, contract-checks them and merges
 * them into the gateway's bar cache. Both are gateway jobs; this route only
 * validates and forwards, and the gateway token never reaches the browser.
 */

const CAPABILITIES = new Set(["quote", "bars", "news", "fundamentals"]);
const SYMBOL = /^[A-Za-z0-9.\-]{1,20}$/;
const TIMEOUT_MS = 8_000;

export async function GET(request: NextRequest) {
  const asked = Number(request.nextUrl.searchParams.get("limit") ?? 25);
  const limit = Number.isFinite(asked) ? Math.min(Math.max(Math.trunc(asked), 1), 100) : 25;
  const result = await callGateway<{ jobs: unknown[] }>(`/api/data/jobs?limit=${limit}`, {
    subject: "the replay and backfill job list",
    validate: (payload) => typeof payload === "object" && payload !== null && Array.isArray((payload as { jobs?: unknown }).jobs),
  });
  if (!result.ok) return NextResponse.json(failureBody(result.failure), { status: result.failure.status });
  return NextResponse.json(result.data, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const rejection = authorise(request.headers.get("authorization"));
  if (rejection) {
    const { status, ...body } = rejection;
    return NextResponse.json(body, { status });
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ code: "invalid_body", error: "Request body must be valid JSON." }, { status: 400 });
  }
  const input = (raw ?? {}) as Record<string, unknown>;
  const symbol = typeof input.symbol === "string" && SYMBOL.test(input.symbol) ? input.symbol.toUpperCase() : null;
  if (!symbol) {
    return NextResponse.json({ code: "invalid_body", error: "A symbol such as BTCUSDT or AAPL is required." }, { status: 400 });
  }
  const interval = typeof input.interval === "string" && (INTERVALS as readonly string[]).includes(input.interval) ? input.interval : null;

  if (input.kind === "replay") {
    const capability = typeof input.capability === "string" && CAPABILITIES.has(input.capability) ? input.capability : "quote";
    const bars = typeof input.bars === "number" && Number.isFinite(input.bars) ? Math.min(1000, Math.max(10, Math.trunc(input.bars))) : 120;
    const result = await callGateway<Record<string, unknown>>("/api/data/replay", {
      method: "POST",
      body: { symbol, capability, interval: interval ?? "4h", bars },
      timeoutMs: TIMEOUT_MS,
      subject: "the replay job",
      validate: (payload) => typeof payload === "object" && payload !== null && typeof (payload as { job_id?: unknown }).job_id === "string",
    });
    if (!result.ok) return NextResponse.json(failureBody(result.failure), { status: result.failure.status });
    return NextResponse.json(result.data, { status: 202, headers: { "Cache-Control": "no-store" } });
  }

  if (input.kind === "backfill") {
    const from = typeof input.from_at === "string" && Number.isFinite(Date.parse(input.from_at)) ? new Date(input.from_at) : null;
    const to = typeof input.to_at === "string" && Number.isFinite(Date.parse(input.to_at)) ? new Date(input.to_at) : null;
    if (!interval || !from || !to || from >= to) {
      return NextResponse.json(
        { code: "invalid_body", error: "A backfill needs an interval and a from_at before to_at (ISO-8601)." },
        { status: 400 },
      );
    }
    const result = await callGateway<Record<string, unknown>>("/api/data/backfill", {
      method: "POST",
      body: { symbol, interval, from_at: from.toISOString(), to_at: to.toISOString() },
      timeoutMs: TIMEOUT_MS,
      subject: "the backfill job",
      validate: (payload) => typeof payload === "object" && payload !== null && typeof (payload as { job_id?: unknown }).job_id === "string",
    });
    if (!result.ok) return NextResponse.json(failureBody(result.failure), { status: result.failure.status });
    return NextResponse.json(result.data, { status: 202, headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json({ code: "invalid_body", error: 'kind must be "replay" or "backfill".' }, { status: 400 });
}
