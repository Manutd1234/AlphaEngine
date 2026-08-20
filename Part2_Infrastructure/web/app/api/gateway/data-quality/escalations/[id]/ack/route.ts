import { NextResponse, type NextRequest } from "next/server";

import { callGateway, failureBody } from "@/lib/gateway";
import { authorise } from "@/lib/operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/gateway/data-quality/escalations/{id}/ack — take an open escalation.
 *
 * The gateway route has existed since E2.5 with no caller anywhere in this app,
 * so an escalation could only be acknowledged from Telegram. The ledger showed
 * "Taken" and offered no way to take anything.
 *
 * Operator-gated like every other write. What that records is a CAPABILITY and
 * not a person — `trader_identity` resolves to `web:token` or `web:anonymous`,
 * which is why the panel says "taken from the desk" rather than naming anyone.
 * Only Telegram carries a real user id, and only its acknowledgements carry a
 * name.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const rejection = authorise(request.headers.get("authorization"));
  if (rejection) {
    const { status, ...body } = rejection;
    return NextResponse.json(body, { status });
  }

  const { id } = await context.params;
  // The gateway declares this an int; refusing a non-numeric id here saves a
  // round trip and keeps the 422 out of the panel's error surface.
  if (!/^\d{1,18}$/.test(id)) {
    return NextResponse.json(
      { code: "invalid_id", error: "An escalation id is a positive integer." },
      { status: 400 },
    );
  }

  const result = await callGateway<{ taken: boolean }>(
    `/api/data-quality/escalations/${id}/ack`,
    {
      method: "POST",
      body: {},
      subject: "the escalation acknowledgement",
      validate: (payload) =>
        typeof payload === "object" && payload !== null
        && typeof (payload as { taken?: unknown }).taken === "boolean",
    },
  );
  if (!result.ok) return NextResponse.json(failureBody(result.failure), { status: result.failure.status });
  return NextResponse.json(result.data, { headers: { "Cache-Control": "no-store" } });
}
