import { NextRequest, NextResponse } from "next/server";

import { runSweep } from "@/lib/engine";
import { loadBars } from "@/lib/marketdata";
import { DEFAULT_REQUEST, INTERVALS, SweepRequest } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const STRATEGIES = new Set(["ma_cross", "donchian", "rsi_reversion"]);
const SYMBOL_RE = /^[A-Z0-9]{5,20}$/;

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
  };
}

export async function POST(request: NextRequest) {
  try {
    const req = sanitise((await request.json()) as Partial<SweepRequest>);
    const { bars, source, warnings } = await loadBars(req.symbol, req.interval, req.bars);
    const result = runSweep(bars, req, source, warnings);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
