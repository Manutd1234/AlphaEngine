import { NextRequest, NextResponse } from "next/server";

import { cacheHeaders, failure, parsePriority, parseProvider, parseSymbols } from "@/lib/providers/http";
import { classify, consensusQuote, getQuote } from "@/lib/providers/registry";
import type { Attempt } from "@/lib/providers/types";
import { clampFloat } from "@/lib/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/quote?symbols=AAPL,BTCUSDT[&consensus=1][&tolerance=50][&provider=tiingo]
 *
 * Without `consensus`, each symbol is answered by the highest-ranked provider
 * that is configured, under quota and not circuit-broken — one call per symbol.
 *
 * With `consensus=1`, every configured price source is queried for each symbol
 * and the response carries each leg's price, its deviation from the median in
 * bps, and how stale its print is relative to the freshest. That is the check a
 * desk actually needs: an outage announces itself, a feed quietly serving
 * Friday's close does not.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const symbols = parseSymbols(params.get("symbols") ?? params.get("symbol"), 8);
  if (!symbols.length) {
    return NextResponse.json(
      { error: "no valid symbols; expected e.g. ?symbols=AAPL,BTCUSDT" },
      { status: 400 },
    );
  }

  const priority = parsePriority(params.get("priority"));
  const provider = parseProvider(params.get("provider"));
  const wantConsensus = params.get("consensus") === "1";
  const tolerance = clampFloat(params.get("tolerance"), 1, 1_000, 50);

  try {
    if (wantConsensus) {
      const results = await Promise.all(
        symbols.map((s) => consensusQuote(s, tolerance, { priority, env: process.env })),
      );
      return NextResponse.json(
        { fetchedAt: new Date().toISOString(), mode: "consensus", quotes: results },
        { headers: cacheHeaders(15) },
      );
    }

    // Partial success is the right outcome for a multi-symbol request: one bad
    // ticker must not blank the row of good ones next to it on the screen.
    const settled = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const r = await getQuote(symbol, { priority, provider, env: process.env });
          return { symbol, asset: classify(symbol), ...r };
        } catch (err) {
          return {
            symbol,
            asset: classify(symbol),
            error: err instanceof Error ? err.message : "failed",
            // The per-symbol catch used to drop these, so a partial failure said
            // "no provider could serve quote" and nothing else — the one place
            // in the API where the skip list, which is the whole diagnostic, was
            // thrown away. `failure()` has always carried it on the whole-request
            // path; this makes the per-symbol path agree.
            attempts: (err as { attempts?: Attempt[] }).attempts ?? [],
          };
        }
      }),
    );
    const synthetic = settled.some(
      (row) => "provenance" in row && row.provenance.synthetic === true,
    );

    return NextResponse.json(
      { fetchedAt: new Date().toISOString(), mode: "single", quotes: settled },
      { headers: cacheHeaders(15, synthetic) },
    );
  } catch (err) {
    return failure(err);
  }
}
