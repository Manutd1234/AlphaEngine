import { NextRequest, NextResponse } from "next/server";

import {
  SYMBOLS,
  DEPTH_BAND_BPS,
  bandImbalance,
  consolidatedMid,
  depthWithinBps,
  fetchBooks,
  spreadBps,
  type Level,
} from "@/lib/venues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // a cached order book is a wrong order book

/**
 * GET /api/depth?symbol=BTCUSDT&limit=100
 *
 * Live L2 snapshots from every venue plus the consolidated (merged) ladder.
 * Levels are returned with cumulative notional already computed so the client
 * can draw depth without re-walking the book.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const symbol = (params.get("symbol") ?? "BTCUSDT").toUpperCase();
  const limit = Math.min(500, Math.max(5, Number(params.get("limit") ?? 100)));
  const depth = Math.min(50, Math.max(5, Number(params.get("depth") ?? 20)));

  if (!/^[A-Z0-9]{5,20}$/.test(symbol)) {
    return NextResponse.json({ error: "invalid symbol" }, { status: 400 });
  }

  const t0 = Date.now();
  const books = await fetchBooks(symbol, limit);
  const live = books.filter((b) => b.ok && b.mid !== null);

  // Merge every venue's levels into one ladder, keyed by price.
  const mergeSide = (side: "bids" | "asks"): Level[] => {
    const acc = new Map<number, number>();
    for (const b of live) for (const [p, q] of b[side]) acc.set(p, (acc.get(p) ?? 0) + q);
    const rows = [...acc.entries()] as Level[];
    rows.sort((a, z) => (side === "bids" ? z[0] - a[0] : a[0] - z[0]));
    return rows;
  };

  const withCum = (levels: Level[]) => {
    let cum = 0;
    return levels.slice(0, depth).map(([price, size]) => {
      const notional = price * size;
      cum += notional;
      return { price, size, notional, cumNotional: cum };
    });
  };

  const mergedBids = mergeSide("bids");
  const mergedAsks = mergeSide("asks");
  const cmid = consolidatedMid(live);

  return NextResponse.json({
    symbol,
    fetchedAt: new Date().toISOString(),
    elapsedMs: Date.now() - t0,
    venuesOnline: live.map((b) => b.venue),
    consolidated: {
      mid: cmid,
      bestBid: mergedBids[0]?.[0] ?? null,
      bestAsk: mergedAsks[0]?.[0] ?? null,
      // Across venues, best-bid can genuinely exceed best-ask for tens of
      // milliseconds. A negative spread here is real, not a bug — it is exactly
      // the signal a cross-venue desk watches for.
      spreadBps: spreadBps(mergedBids[0]?.[0] ?? null, mergedAsks[0]?.[0] ?? null),
      bids: withCum(mergedBids),
      asks: withCum(mergedAsks),
      depthUsdBid: depthWithinBps(mergedBids, cmid, "bid"),
      depthUsdAsk: depthWithinBps(mergedAsks, cmid, "ask"),
      imbalance: bandImbalance(mergedBids, mergedAsks, cmid),
      depthBandBps: DEPTH_BAND_BPS,
    },
    venues: books.map((b) => ({
      venue: b.venue,
      ok: b.ok,
      error: b.error ?? null,
      latencyMs: b.latencyMs,
      bestBid: b.bestBid,
      bestAsk: b.bestAsk,
      mid: b.mid,
      spreadBps: b.spreadBps,
      depthUsdBid: b.depthUsdBid,
      depthUsdAsk: b.depthUsdAsk,
      imbalance: b.imbalance,
      bids: withCum(b.bids),
      asks: withCum(b.asks),
    })),
    availableSymbols: SYMBOLS,
  });
}
