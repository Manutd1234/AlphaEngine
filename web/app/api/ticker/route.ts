import { NextRequest, NextResponse } from "next/server";

import { SYMBOLS, fetchBinanceTickers } from "@/lib/venues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/ticker?symbols=BTCUSDT,ETHUSDT — last price and 24h stats. */
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("symbols");
  const requested = raw
    ? raw.split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9]{5,20}$/.test(s))
    : [...SYMBOLS];

  if (!requested.length) {
    return NextResponse.json({ error: "no valid symbols" }, { status: 400 });
  }

  const tickers = await fetchBinanceTickers(requested.slice(0, 20));
  return NextResponse.json({ fetchedAt: new Date().toISOString(), tickers });
}
