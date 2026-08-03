import { NextResponse } from "next/server";

import { SYMBOLS } from "@/lib/venues";
import { INTERVALS, STRATEGY_LABELS, PARAM_MEANING, MAX_COMBOS } from "@/lib/types";

export const runtime = "nodejs";

/** GET /api/markets — everything a client needs to drive the other endpoints. */
export async function GET() {
  return NextResponse.json({
    symbols: SYMBOLS,
    venues: ["BINANCE", "BYBIT"],
    intervals: INTERVALS,
    strategies: Object.entries(STRATEGY_LABELS).map(([key, label]) => ({
      key,
      label,
      params: PARAM_MEANING[key as keyof typeof PARAM_MEANING],
    })),
    limits: { maxCombos: MAX_COMBOS, maxBars: 5000 },
    endpoints: {
      "GET /api/markets": "this document",
      "GET /api/ticker?symbols=": "last price and 24h stats",
      "GET /api/depth?symbol=&limit=&depth=": "live L2 books per venue + consolidated ladder",
      "GET /api/tca?symbol=&side=&notional=": "VWAP, slippage and cross-venue smart route",
      "GET /api/ohlcv?symbol=&interval=&bars=": "historical candles",
      "POST /api/backtest": "parameter sweep with deflated Sharpe and walk-forward",
    },
    streaming: {
      note:
        "Serverless functions cannot hold a WebSocket subscription open, so tick-by-tick " +
        "L2 is streamed to the browser directly from the exchanges' public feeds.",
      binance: "wss://stream.binance.com:9443/stream?streams=<sym>@depth20@100ms",
      bybit: "wss://stream.bybit.com/v5/public/spot  (subscribe orderbook.50.<SYM>)",
    },
  });
}
