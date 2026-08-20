import { NextResponse } from "next/server";

import { callGateway, failureBody } from "@/lib/gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/gateway/research/ml/fit — queue one supervised walk-forward.
 *
 * The write half of the ML surface. Until this existed the desk had two GET
 * routes over `ml_runs` and no way to create one, so the Fitted models panel
 * could only ever report an empty corpus.
 *
 * The body is forwarded rather than rebuilt: the gateway's `MLFitRequest`
 * validates every bound (bars, folds, horizon, cost) and a second set of
 * limits here would be a second thing to keep in step with it. What this route
 * does own is the refusal to pass a body it cannot read as JSON, because that
 * is a client mistake and should not spend a gateway round trip.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "the fit request body is not JSON" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const result = await callGateway<{ job_id: string; poll: string }>("/api/research/ml/fit", {
    method: "POST",
    body,
    subject: "the supervised fit",
    validate: (payload) =>
      typeof payload === "object" && payload !== null
      && typeof (payload as { job_id?: unknown }).job_id === "string",
  });
  if (!result.ok) return NextResponse.json(failureBody(result.failure), { status: result.failure.status });
  return NextResponse.json(result.data, { headers: { "Cache-Control": "no-store" } });
}
