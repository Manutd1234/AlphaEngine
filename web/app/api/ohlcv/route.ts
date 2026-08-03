import { NextRequest, NextResponse } from "next/server";

import { loadBars } from "@/lib/marketdata";
import { clampInt, parseEnum } from "@/lib/params";
import { parsePriority, parseProvider, parseSymbols } from "@/lib/providers/http";
import { classify, getBars } from "@/lib/providers/registry";
import { INTERVALS } from "@/lib/types";

export const runtime = "nodejs";

/** Raw candles, for callers that want the price series without a sweep. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  // This route previously accepted anything: `bars=abc` produced NaN, both the
  // fetch loop and the synthetic generator ran zero iterations, and it returned
  // 200 with an empty series and "live market data unreachable" in 3.7ms without
  // contacting anyone. It was also the only route with no symbol/interval check.
  // Absent defaults to BTCUSDT (documented behaviour); present-but-invalid is
  // still a 400 rather than a silent fallback to a different instrument.
  const [symbol] = parseSymbols(params.get("symbol") ?? "BTCUSDT", 1);
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
  const asset = classify(symbol);

  try {
    // Crypto keeps the original Binance path: keyless, paginated to 5000 bars,
    // and with the synthetic fallback so the research workflow always runs.
    // Equities go through the provider registry (Massive → Tiingo → FMP →
    // Marketstack → Alpha Vantage) — an equity series has no keyless source, so
    // here failover is across vendors instead of down to synthetic data. An
    // equity backtest on invented prices would be a strategy result about
    // nothing, presented as one about AAPL.
    if (asset === "equity") {
      const r = await getBars(symbol, interval, bars, {
        priority: parsePriority(params.get("priority")),
        provider: parseProvider(params.get("provider")),
        env: process.env,
      });
      return NextResponse.json({
        symbol,
        interval,
        source: r.provenance.provider,
        warnings: r.provenance.delayed ? ["This provider serves delayed/end-of-day data."] : [],
        provenance: r.provenance,
        attempts: r.attempts,
        bars: r.data,
      });
    }

    const { bars: data, source, warnings } = await loadBars(symbol, interval, bars);
    return NextResponse.json({ symbol, interval, source, warnings, bars: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
