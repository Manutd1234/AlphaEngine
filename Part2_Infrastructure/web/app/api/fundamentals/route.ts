import { NextRequest, NextResponse } from "next/server";

import { cacheHeaders, failure, parsePriority, parseProvider, parseSymbols } from "@/lib/providers/http";
import { getFundamentals } from "@/lib/providers/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/fundamentals?symbol=AAPL[&provider=fmp]
 *
 * Company profile and valuation. Cached for a day at the edge because the
 * underlying facts change quarterly — spending a daily API allowance to
 * re-fetch a sector string is the kind of waste that leaves nothing in the
 * budget when it matters.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const [symbol] = parseSymbols(params.get("symbol") ?? params.get("symbols"), 1);
  if (!symbol) {
    return NextResponse.json({ error: "invalid or missing symbol" }, { status: 400 });
  }

  try {
    const result = await getFundamentals(symbol, {
      priority: parsePriority(params.get("priority")),
      provider: parseProvider(params.get("provider")),
      env: process.env,
    });
    return NextResponse.json(
      { symbol, ...result },
      { headers: cacheHeaders(86_400, result.provenance.synthetic === true) },
    );
  } catch (err) {
    return failure(err);
  }
}
