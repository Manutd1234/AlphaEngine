import { NextRequest, NextResponse } from "next/server";

import { clampInt } from "@/lib/params";
import { cacheHeaders, failure, parsePriority, parseProvider, parseSymbols } from "@/lib/providers/http";
import { getNews } from "@/lib/providers/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/news?symbols=AAPL,MSFT&limit=20[&provider=tiingo]
 *
 * Headlines from whichever news provider is configured, normalised to one shape.
 * `sentiment` is null everywhere except Alpha Vantage — a provider that does not
 * score sentiment reports null rather than 0, because "neutral" and "not
 * measured" must not render as the same bar.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const symbols = parseSymbols(params.get("symbols") ?? params.get("symbol"), 6);
  const limit = clampInt(params.get("limit"), 1, 50, 20);

  try {
    const result = await getNews(symbols, limit, {
      priority: parsePriority(params.get("priority")),
      provider: parseProvider(params.get("provider")),
      env: process.env,
    });
    // Newest first regardless of which provider answered — Massive sorts by
    // relevance and FMP by insertion, so an unsorted merge would read as random.
    const items = [...result.data].sort(
      (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
    );
    return NextResponse.json(
      { symbols, count: items.length, items, provenance: result.provenance, attempts: result.attempts },
      { headers: cacheHeaders(180, result.provenance.synthetic === true) },
    );
  } catch (err) {
    return failure(err);
  }
}
