import { NextResponse } from "next/server";

import { callGateway, failureBody } from "@/lib/gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RUN_ID = /^[A-Za-z0-9_.-]{1,64}$/;

/**
 * GET /api/gateway/research/ml/runs/{runId} — one run with its evidence.
 *
 * The list route carries the headline figures; this carries the two things
 * that decide whether those figures mean anything — the feature spec the model
 * was fitted on, and each fold's purge and embargo. An out-of-sample Sharpe
 * from an unpurged fold is not out of sample, so a capsule that cannot show
 * the purge is a capsule that cannot support its own numbers.
 *
 * The gateway answers 503 when no corpus is configured and 404 for a run that
 * does not exist, and those pass through as themselves: "there is no store" and
 * "there is no such run" are different facts and the panel says which.
 */
export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  if (!RUN_ID.test(runId)) {
    return NextResponse.json(
      { code: "invalid_id", error: "That is not a run id." },
      { status: 400 },
    );
  }
  const result = await callGateway<{ id: string }>(
    `/api/research/ml/runs/${encodeURIComponent(runId)}`,
    {
      subject: "the supervised run detail",
      validate: (payload) =>
        typeof payload === "object" && payload !== null
        && typeof (payload as { id?: unknown }).id === "string",
    },
  );
  if (!result.ok) return NextResponse.json(failureBody(result.failure), { status: result.failure.status });
  return NextResponse.json(result.data, { headers: { "Cache-Control": "no-store" } });
}
