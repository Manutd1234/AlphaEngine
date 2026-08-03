import { NextRequest, NextResponse } from "next/server";

import { buildTcaReport, fetchBooks, type Side } from "@/lib/venues";
import { clampFloat, parseSymbol } from "@/lib/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/tca?symbol=BTCUSDT&side=BUY&notional=100000
 *
 * Prices a target order against the live ladders of every venue and returns the
 * cross-venue routing split that minimises blended cost.
 *
 * Uses the same arithmetic AND the same ladder depth as the gateway, so the two
 * agree on a given book. They can still differ by the age of the snapshot: this
 * route fetches on demand, the gateway holds a streaming book.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const symbol = parseSymbol(params.get("symbol"));
  if (!symbol) {
    return NextResponse.json({ error: "invalid symbol" }, { status: 400 });
  }
  const side = ((params.get("side") ?? "BUY").toUpperCase() === "SELL" ? "SELL" : "BUY") as Side;
  const notional = clampFloat(params.get("notional"), 100, 50_000_000, 100_000);

  // Match the depth the Live tab streams (Binance @depth20, Bybit orderbook.50)
  // and the gateway's own feed. Walking a 500-level REST ladder here made the
  // same $1M probe read "fillable" on this route and "not fillable" in the UI —
  // both correct, but answering different questions under one product.
  const books = await fetchBooks(symbol, 50);
  const report = buildTcaReport(symbol, side, notional, books);

  if (!report.perVenue.length) {
    return NextResponse.json(
      { error: `no live book for ${symbol}`, venues: books.map((b) => ({ venue: b.venue, error: b.error })) },
      { status: 503 },
    );
  }
  return NextResponse.json(report);
}
