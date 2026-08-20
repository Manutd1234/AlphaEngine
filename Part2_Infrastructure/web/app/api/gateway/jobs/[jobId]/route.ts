import { NextResponse } from "next/server";

import { callGateway, failureBody } from "@/lib/gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JOB_ID = /^[A-Za-z0-9_.\-]{1,64}$/;

/**
 * GET /api/gateway/jobs/{jobId} — one job's status, whatever kind it is.
 *
 * The gateway hands back `poll: "/api/jobs/{job_id}"` with every accepted job
 * and nothing here could reach it. The only job proxy was
 * `/api/gateway/data/jobs`, which takes a `limit` and returns a LIST filtered
 * to the `data.` kind prefix — so `FittedModels` polling it with `?job_id=…`
 * got the parameter ignored, read `payload.status` off a `{jobs: […]}` body,
 * found undefined, and span for its full sixty-second budget before giving up
 * on a fit that had in fact succeeded. An `ml.fit` job could never have
 * appeared in that list at all.
 */
export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  if (!JOB_ID.test(jobId)) {
    return NextResponse.json({ error: "that is not a job id" }, { status: 400 });
  }
  const result = await callGateway<{ status?: string }>(`/api/jobs/${encodeURIComponent(jobId)}`, {
    subject: "the job status",
    validate: (payload) => typeof payload === "object" && payload !== null,
  });
  if (!result.ok) return NextResponse.json(failureBody(result.failure), { status: result.failure.status });
  return NextResponse.json(result.data, { headers: { "Cache-Control": "no-store" } });
}
