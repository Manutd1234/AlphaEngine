import { NextRequest, NextResponse } from "next/server";

import { buildTcaReport, fetchBooks, type Side } from "@/lib/venues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/tca?symbol=BTCUSDT&side=BUY&notional=100000
 *
 * Prices a target order against the live ladders of every venue and returns the
 * cross-venue routing split that minimises blended cost. Mirrors the gateway's
 * `/api/tca` exactly, so the two cannot disagree about execution cost.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const symbol = (params.get("symbol") ?? "BTCUSDT").toUpperCase();
  const side = ((params.get("side") ?? "BUY").toUpperCase() === "SELL" ? "SELL" : "BUY") as Side;
  const notional = Math.min(50_000_000, Math.max(100, Number(params.get("notional") ?? 100_000)));

  if (!/^[A-Z0-9]{5,20}$/.test(symbol)) {
    return NextResponse.json({ error: "invalid symbol" }, { status: 400 });
  }
  if (!Number.isFinite(notional)) {
    return NextResponse.json({ error: "invalid notional" }, { status: 400 });
  }

  const books = await fetchBooks(symbol, 500);
  const report = buildTcaReport(symbol, side, notional, books);

  if (!report.perVenue.length) {
    return NextResponse.json(
      { error: `no live book for ${symbol}`, venues: books.map((b) => ({ venue: b.venue, error: b.error })) },
      { status: 503 },
    );
  }
  return NextResponse.json(report);
}
