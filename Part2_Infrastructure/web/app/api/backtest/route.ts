import { NextRequest, NextResponse } from "next/server";

import { runSweep } from "@/lib/engine";
import { loadBars } from "@/lib/marketdata";
import { seedFromString } from "@/lib/random";
import { DEFAULT_REQUEST, INTERVALS, SweepRequest } from "@/lib/types";
import { APP_COMMIT } from "@/lib/version";

export const runtime = "nodejs";
// No `maxDuration` override. A 74-combination sweep over 2000 bars runs in ~20ms,
// so nothing here needs an extended budget — and a value above the account's
// plan limit is rejected at build time, which is a deployment failure that
// cannot be reproduced locally.

const STRATEGIES = new Set(["ma_cross", "donchian", "rsi_reversion"]);
// Keep the research context aligned with the data workspace. Equity symbols
// may contain a class suffix (BRK.B) and short tickers must not silently fall
// back to BTCUSDT. The current research loader is crypto-first, so unsupported
// instruments return an explicitly labelled synthetic fallback instead.
const SYMBOL_RE = /^[A-Z0-9.\-]{1,20}$/;

function clamp(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

function clampFloat(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

/** Never trust the client with grid bounds — an unbounded sweep is a free way to
 *  burn the function's whole time budget. */
function sanitise(body: Partial<SweepRequest>): SweepRequest {
  const symbol = String(body.symbol ?? DEFAULT_REQUEST.symbol).toUpperCase();
  const interval = String(body.interval ?? DEFAULT_REQUEST.interval);
  const strategy = String(body.strategy ?? DEFAULT_REQUEST.strategy);

  const fastMin = clamp(body.fastMin, 2, 400, DEFAULT_REQUEST.fastMin);
  const fastMax = Math.max(fastMin + 1, clamp(body.fastMax, 3, 400, DEFAULT_REQUEST.fastMax));
  const slowMin = clamp(body.slowMin, 3, 800, DEFAULT_REQUEST.slowMin);
  const slowMax = Math.max(slowMin + 1, clamp(body.slowMax, 4, 800, DEFAULT_REQUEST.slowMax));

  return {
    symbol: SYMBOL_RE.test(symbol) ? symbol : DEFAULT_REQUEST.symbol,
    interval: (INTERVALS as readonly string[]).includes(interval) ? interval : DEFAULT_REQUEST.interval,
    bars: clamp(body.bars, 300, 5000, DEFAULT_REQUEST.bars),
    strategy: (STRATEGIES.has(strategy) ? strategy : DEFAULT_REQUEST.strategy) as SweepRequest["strategy"],
    fastMin,
    fastMax,
    fastStep: clamp(body.fastStep, 1, 100, DEFAULT_REQUEST.fastStep),
    slowMin,
    slowMax,
    slowStep: clamp(body.slowStep, 1, 200, DEFAULT_REQUEST.slowStep),
    feeBps: clampFloat(body.feeBps, 0, 100, DEFAULT_REQUEST.feeBps),
    slippageBps: clampFloat(body.slippageBps, 0, 100, DEFAULT_REQUEST.slippageBps),
    direction: body.direction === "long_short" ? "long_short" : "long_only",
    folds: clamp(body.folds, 2, 10, DEFAULT_REQUEST.folds),
    walkForward: body.walkForward !== false,

    // Microstructure frictions. Every one defaults to 0, which is what keeps an
    // unconfigured request arithmetically identical to the Python reference —
    // `clampFloat` returns the fallback for absent, non-numeric and non-finite
    // input alike, so a client that omits the whole group cannot accidentally
    // enable it. The upper bounds are deliberately generous: a researcher
    // stress-testing a strategy at an absurd participation rate is doing the
    // right thing, and the UI labels the result as a model either way.
    impactCoefficient: clampFloat(body.impactCoefficient, 0, 1, 0),
    orderNotional: clampFloat(body.orderNotional, 0, 1e10, 0),
    fundingBpsPer8h: clampFloat(body.fundingBpsPer8h, -50, 50, 0),
    borrowBpsAnnual: clampFloat(body.borrowBpsAnnual, 0, 5000, 0),
  };
}

export async function POST(request: NextRequest) {
  try {
    const req = sanitise((await request.json()) as Partial<SweepRequest>);
    const { bars, source, warnings } = await loadBars(req.symbol, req.interval, req.bars);
    const result = runSweep(bars, req, source, warnings);
    // Environment concerns stay out of the pure engine: the route stamps the
    // build identity and, for synthetic data, the generator seed.
    return NextResponse.json({
      ...result,
      commit: APP_COMMIT,
      syntheticSeed: source === "synthetic" ? seedFromString(req.symbol) : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
