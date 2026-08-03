import { NextRequest, NextResponse } from "next/server";

import { loadBars } from "@/lib/marketdata";

export const runtime = "nodejs";

/** Raw candles, for callers that want the price series without a sweep. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const symbol = (params.get("symbol") ?? "BTCUSDT").toUpperCase();
  const interval = params.get("interval") ?? "4h";
  const bars = Math.min(5000, Math.max(50, Number(params.get("bars") ?? 1000)));

  try {
    const { bars: data, source, warnings } = await loadBars(symbol, interval, bars);
    return NextResponse.json({ symbol, interval, source, warnings, bars: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
