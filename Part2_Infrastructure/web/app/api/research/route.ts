import { NextRequest, NextResponse } from "next/server";

import { clampInt } from "@/lib/params";
import { assertPublicUrl } from "@/lib/providers/firecrawl";
import { cacheHeaders, failure, parsePriority, parseProvider } from "@/lib/providers/http";
import { scrapeUrl, searchWeb } from "@/lib/providers/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/research?q=<query>&limit=5   — search the open web, return readable text
 * GET /api/research?url=<url>           — fetch one page as markdown
 *
 * The non-schema half of research: exchange notices, regulatory filings, protocol
 * announcements — the material that has not been normalised into anyone's price
 * API yet, and where most of the edge in "alternative data" actually lives.
 *
 * Two limits are enforced here rather than in the adapter, because this is the
 * boundary where untrusted input arrives:
 *
 *  - `limit` is capped at 10. Firecrawl bills credits per result and a free
 *    tier is 1,000/month, so an unbounded `limit` is an unbounded bill.
 *  - `url` must be public HTTP(S). Firecrawl's infrastructure does the fetching,
 *    not ours, so this is not a classic SSRF against our own network — but a
 *    route that will retrieve any URL a caller names should still refuse
 *    loopback, RFC-1918 and link-local targets rather than delegate that
 *    judgement entirely to a third party's egress rules.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const url = params.get("url");
  const query = params.get("q") ?? params.get("query");
  const opts = {
    priority: parsePriority(params.get("priority")),
    provider: parseProvider(params.get("provider")),
    env: process.env,
  };

  if (!url && !query) {
    return NextResponse.json(
      { error: "provide either ?q=<search query> or ?url=<page to read>" },
      { status: 400 },
    );
  }

  try {
    if (url) {
      // Validated here at the edge, not only inside the adapter: a loopback or
      // metadata-endpoint URL must 400 as a bad request even when no scrape
      // provider is configured — "not configured" would misreport a rejected
      // target as a missing key.
      assertPublicUrl(url);
      const result = await scrapeUrl(url, opts);
      return NextResponse.json(
        { mode: "scrape", ...result },
        { headers: cacheHeaders(3_600) },
      );
    }

    const limit = clampInt(params.get("limit"), 1, 10, 5);
    const result = await searchWeb(query!.slice(0, 300), limit, opts);
    return NextResponse.json(
      {
        mode: "search",
        query: query!.slice(0, 300),
        count: result.data.length,
        ...result,
      },
      { headers: cacheHeaders(900, result.provenance.synthetic === true) },
    );
  } catch (err) {
    return failure(err);
  }
}
