import { NextRequest, NextResponse } from "next/server";

import { loadBars } from "@/lib/marketdata";
import { clampInt, parseEnum, parseSymbol } from "@/lib/params";
import { INTERVALS } from "@/lib/types";

export const runtime = "nodejs";

/** Raw candles, for callers that want the price series without a sweep. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  // This route previously accepted anything: `bars=abc` produced NaN, both the
  // fetch loop and the synthetic generator ran zero iterations, and it returned
  // 200 with an empty series and "live market data unreachable" in 3.7ms without
  // contacting anyone. It was also the only route with no symbol/interval check.
  const symbol = parseSymbol(params.get("symbol"));
  if (!symbol) {
    return NextResponse.json({ error: "invalid symbol" }, { status: 400 });
  }
  const interval = parseEnum(params.get("interval"), INTERVALS, "4h");
  if (!interval) {
    return NextResponse.json(
      { error: `invalid interval; expected one of ${INTERVALS.join(", ")}` },
      { status: 400 },
    );
  }
  const bars = clampInt(params.get("bars"), 50, 5000, 1000);

  try {
    const { bars: data, source, warnings } = await loadBars(symbol, interval, bars);
    return NextResponse.json({ symbol, interval, source, warnings, bars: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
