import { NextRequest, NextResponse } from "next/server";

import { gatewayBase, gatewayHeaders } from "@/lib/gateway";
import { authorise } from "@/lib/operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/gateway/data/work-items/{id}
 *
 * A versioned edit. The gateway refuses a stale version with 409 and the
 * current row; that answer is passed through as-is, because the board must
 * show what the row now says rather than pretend its own edit landed.
 * `callGateway` folds every non-2xx into one failure shape, so this route
 * forwards by hand — the 409 body is the whole point.
 */

const STATUSES = new Set(["intake", "ready", "progress", "resolved"]);
const PRIORITIES = new Set(["P0", "P1", "P2", "P3"]);
const ID = /^(REQ|TKT|BUG)-\d{3,6}$/;
const TIMEOUT_MS = 8_000;

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const rejection = authorise(request.headers.get("authorization"));
  if (rejection) {
    const { status, ...body } = rejection;
    return NextResponse.json(body, { status });
  }
  const { id } = await context.params;
  if (!ID.test(id)) {
    return NextResponse.json({ code: "invalid_id", error: "Work item ids look like BUG-091." }, { status: 400 });
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ code: "invalid_body", error: "Request body must be valid JSON." }, { status: 400 });
  }
  const input = (raw ?? {}) as Record<string, unknown>;
  const version = typeof input.version === "number" && Number.isInteger(input.version) && input.version >= 1 ? input.version : null;
  if (version === null) {
    return NextResponse.json({ code: "invalid_body", error: "A positive integer version is required." }, { status: 400 });
  }
  const patch: Record<string, unknown> = { version };
  if (typeof input.status === "string" && STATUSES.has(input.status)) patch.status = input.status;
  if (typeof input.priority === "string" && PRIORITIES.has(input.priority)) patch.priority = input.priority;
  for (const [key, max] of [["owner", 40], ["title", 120], ["summary", 400], ["area", 48]] as const) {
    const value = input[key];
    if (typeof value === "string" && value.length <= max) patch[key] = value;
  }

  const base = gatewayBase();
  if (!base) {
    return NextResponse.json(
      { code: "gateway_not_configured", error: "No risk gateway is configured for this deployment.", status: 503 },
      { status: 503 },
    );
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(new URL(`/api/data/work-items/${encodeURIComponent(id)}`, base), {
      method: "PATCH",
      cache: "no-store",
      signal: controller.signal,
      headers: gatewayHeaders(),
      body: JSON.stringify(patch),
    });
    const body = await response.json().catch(() => null);
    if (response.status === 409) {
      // The current row rides along: the board replaces its optimistic edit.
      return NextResponse.json(
        { code: "version_conflict", error: "This item was changed elsewhere; showing the current version.", current: (body as { current?: unknown })?.current ?? null },
        { status: 409 },
      );
    }
    if (response.status === 404) {
      return NextResponse.json({ code: "not_found", error: `No work item ${id} on the gateway.` }, { status: 404 });
    }
    if (!response.ok) {
      const authFailed = response.status === 401 || response.status === 403;
      return NextResponse.json(
        {
          code: authFailed ? "gateway_auth_failed" : "gateway_rejected",
          error: authFailed ? "The risk gateway rejected this server's credential." : `The risk gateway responded with HTTP ${response.status}.`,
        },
        { status: 502 },
      );
    }
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const timedOut = controller.signal.aborted;
    return NextResponse.json(
      {
        code: timedOut ? "gateway_timeout" : "gateway_unreachable",
        error: timedOut ? `The gateway did not answer within ${TIMEOUT_MS / 1000}s.` : (error as Error).message,
      },
      { status: 504 },
    );
  } finally {
    clearTimeout(timer);
  }
}
