import { NextRequest, NextResponse } from "next/server";

import { callGateway, failureBody } from "@/lib/gateway";
import { authorise } from "@/lib/operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/gateway/data/work-items         — the persisted queue, every browser sees the same list
 * POST /api/gateway/data/work-items         — create one item (operator-gated, like every other write)
 *
 * The Data tab's work queue lives in the gateway's data-operations SQLite
 * file: versioned rows created by authenticated writes, with audit-logged
 * mutations. Reads are open like the audit feed; writes go through the same
 * operator gate the risk controls use, and the gateway token never reaches
 * the browser.
 */

const KINDS = new Set(["request", "ticket", "bug"]);
const PRIORITIES = new Set(["P0", "P1", "P2", "P3"]);
const TIMEOUT_MS = 8_000;

interface WorkItemsPayload { backend: string; items: unknown[]; count: number }

export async function GET() {
  const result = await callGateway<WorkItemsPayload>("/api/data/work-items", {
    subject: "the work queue",
    validate: (payload) =>
      typeof payload === "object" && payload !== null && Array.isArray((payload as { items?: unknown }).items),
  });
  if (!result.ok) {
    return NextResponse.json(failureBody(result.failure), { status: result.failure.status });
  }
  return NextResponse.json(result.data, { headers: { "Cache-Control": "no-store" } });
}

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max ? value.trim() : null;
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
  const kind = typeof input.kind === "string" && KINDS.has(input.kind) ? input.kind : null;
  const priority = typeof input.priority === "string" && PRIORITIES.has(input.priority) ? input.priority : null;
  const title = text(input.title, 120);
  if (!kind || !priority || !title) {
    return NextResponse.json(
      { code: "invalid_body", error: "kind (request|ticket|bug), priority (P0–P3) and a title of up to 120 characters are required." },
      { status: 400 },
    );
  }
  const body: Record<string, unknown> = {
    kind,
    priority,
    title,
    summary: typeof input.summary === "string" ? input.summary.slice(0, 400) : "",
    owner: text(input.owner, 40) ?? "Unassigned",
    area: text(input.area, 48) ?? "Pipeline",
  };
  if (typeof input.sla_hours === "number" && Number.isFinite(input.sla_hours) && input.sla_hours >= 0) {
    body.sla_hours = Math.min(720, input.sla_hours);
  }

  const result = await callGateway<Record<string, unknown>>("/api/data/work-items", {
    method: "POST",
    body,
    timeoutMs: TIMEOUT_MS,
    subject: "the work queue",
    validate: (payload) => typeof payload === "object" && payload !== null && typeof (payload as { id?: unknown }).id === "string",
  });
  if (!result.ok) {
    return NextResponse.json(failureBody(result.failure), { status: result.failure.status });
  }
  return NextResponse.json(result.data, { status: 201, headers: { "Cache-Control": "no-store" } });
}
