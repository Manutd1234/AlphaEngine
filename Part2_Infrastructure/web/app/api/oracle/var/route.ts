import { NextRequest, NextResponse } from "next/server";

import { withOracle } from "@/lib/oracle/client";
import {
  DEFAULT_SIMULATIONS,
  MAX_SIMULATIONS,
  MONTE_CARLO_SQL,
} from "@/lib/oracle/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/oracle/var — 99% Value at Risk from an in-database Monte Carlo.
 *
 * This exists to be a SECOND opinion, not a replacement. `lib/portfolio-risk.ts`
 * already computes VaR client-side from the covariance model; the Risk tab shows
 * both, because two independent implementations of the same quantity is the only
 * cheap check on either — the same reason the repo carries a Python/TypeScript
 * engine parity suite. When they disagree, the disagreement is the finding.
 *
 * The two numbers are NOT interchangeable and the panel must not present them as
 * one figure with two sources: this is a terminal-value GBM VaR over a horizon,
 * the client-side one is a one-day parametric/historical VaR on the current
 * book. They answer adjacent questions.
 *
 * **Bounds are enforced here and again in PL/SQL.** A public endpoint that lets
 * a caller choose how much database CPU to spend is a way to take the instance
 * down from an anonymous request; the procedure caps independently because this
 * file is the one an attacker cannot edit but a future contributor can.
 */

interface VarBinds {
  var_99: number;
  expected: number;
  paths_used: number;
}

function clampFloat(value: unknown, lo: number, hi: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "invalid_json", error: "Body must be JSON" }, { status: 400 });
  }
  const record = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;

  const equity = clampFloat(record.equity, 1, 1e12, 1_000_000);
  const mu = clampFloat(record.mu, -5, 5, 0.08);
  const sigma = clampFloat(record.sigma, 0, 10, 0.45);
  const days = Math.round(clampFloat(record.days, 1, 3650, 1));
  const simulations = Math.round(
    clampFloat(record.simulations, 100, MAX_SIMULATIONS, DEFAULT_SIMULATIONS),
  );

  const startedAt = Date.now();
  const result = await withOracle("The in-database Monte Carlo", async (connection) => {
    const oracledb = (await import("oracledb")).default;
    const execution = await connection.execute<VarBinds>(MONTE_CARLO_SQL, {
      initial_equity: equity,
      mu,
      sigma,
      days,
      simulations,
      var_99: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      expected: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      paths_used: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
    });
    return execution.outBinds as unknown as VarBinds;
  });

  if (!result.ok) {
    return NextResponse.json(
      { state: "unavailable", ...result.failure },
      { status: result.failure.status },
    );
  }

  return NextResponse.json(
    {
      state: "ok",
      backend: "oracle",
      var99: result.data.var_99,
      expectedEquity: result.data.expected,
      // Echoed rather than assumed: the procedure clamps independently, so the
      // number of paths actually simulated is not necessarily what was asked
      // for, and a VaR reported without its sample size is not reproducible.
      pathsUsed: result.data.paths_used,
      assumptions: { equity, mu, sigma, days, horizon: `${days}d`, model: "GBM terminal value" },
      computedInMs: Date.now() - startedAt,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
