// Pre-trade sandbox gate + smart-order-router probe, at the edge.
//
// WHAT THIS IS, AND WHAT IT IS NOT
//
// This is the blueprint's Phase 2 function, and it is an explicitly-labelled
// SANDBOX. Every row it writes carries `decided_by = 'supabase_rpc'`, the same
// stamp `submit_alphaengine_order` uses, because two gates are not fifteen: the
// desk's decision comes from `modules/risk_proxy.py` and nothing here may ever
// be read as that. `public.desk_blotter` filters these rows out by default.
//
// SIX CORRECTIONS TO THE BLUEPRINT LISTING, each of which stops it working:
//
//  1. `import { Deno } from "https://deno.land/std@0.177.0/http/server.ts"` —
//     `Deno` is a runtime global and that module exports `serve`, not `Deno`.
//     As written the function does not boot. (See embed-research: no import.)
//
//  2. The listing's INSERT omits `decided_by`, which is NOT NULL in the
//     committed schema. Every insert it makes fails.
//
//  3. `blendedVwap = weightedSum / targetNotional` divides by the REQUESTED
//     notional. When the venues cannot fill the whole order the remainder is
//     unpriced, so the reported VWAP is understated — a better fill than
//     happened. Divides by filled notional here.
//
//  4. `allocations[0].venue` throws on a zero or negative target. Validated up
//     front instead.
//
//  5. Slippage was linear in size (`slipBps * alloc / 100_000`). This repo
//     models impact as square-root everywhere else (`k·√(order ÷ ADV)`, see
//     Controls.tsx), and two engines disagreeing about cost is worse than
//     either being approximate. Square-root here.
//
//  6. CORS was `*`. Narrowed to the deployed origins: this function writes
//     rows, and `--no-verify-jwt` already makes it publicly invocable.
//
// Deploy:
//   supabase functions deploy evaluate-order --no-verify-jwt
//
// `--no-verify-jwt` is deliberate and is why the auth check below is explicit:
// with the platform's JWT gate on, an unauthenticated call gets an opaque 401
// from the edge before this code runs, and the caller cannot tell "not signed
// in" from "function is down".

// Both production aliases, because both are live and both answer. Naming only
// one is how this list went stale: the deployment picked up a second address,
// nothing here failed, and a browser call from the new host would simply have
// been blocked with no clue as to why. localhost:3100 is here because :3000 is
// often already taken on a developer machine.
const ALLOWED_ORIGINS = new Set([
  "https://alphaengine-workspace.vercel.app",
  "https://developer-analyst-infra.vercel.app",
  "http://localhost:3000",
  "http://localhost:3100",
]);

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    // Echoed, never `*`. An unknown origin gets no CORS header at all, so the
    // browser blocks it — which is the desired answer for a writer endpoint.
    ...(origin && ALLOWED_ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    Vary: "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

/** Indicative depth. A sandbox says so rather than implying a live book. */
const VENUES = [
  { venue: "BINANCE", available: 17_500, price: 64_680.01, impactK: 0.15, adv: 900_000_000 },
  { venue: "BYBIT", available: 500_000, price: 64_682.0, impactK: 1.2, adv: 250_000_000 },
];

interface Allocation {
  venue: string;
  allocatedNotional: number;
  vwap: number;
  slippageBps: number;
}

/**
 * Square-root market impact: doubling size costs about 1.41×, not 2×.
 * Matches the backtester's cost model so the two never disagree about the same
 * order.
 */
function impactBps(k: number, notional: number, adv: number): number {
  if (notional <= 0 || adv <= 0) return 0;
  return k * Math.sqrt(notional / adv) * 100;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const headers = corsHeaders(origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers });
  }

  const t0 = performance.now();

  try {
    const { createClient } = await import("jsr:@supabase/supabase-js@2");
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", detail: "No Authorization header." }),
        { status: 401, headers },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Body must be JSON" }), { status: 400, headers });
    }

    const symbol = String(body.symbol ?? "").toUpperCase();
    const side = body.side === "SELL" ? "SELL" : "BUY";
    const targetNotional = Number(body.targetNotional);
    const strategyTag = String(body.strategyTag ?? "manual").slice(0, 64);

    // (4) Validate before any arithmetic that indexes into allocations.
    if (!/^[A-Z0-9.\-]{1,20}$/.test(symbol)) {
      return new Response(JSON.stringify({ error: "symbol is required" }), { status: 400, headers });
    }
    if (!Number.isFinite(targetNotional) || targetNotional <= 0) {
      return new Response(
        JSON.stringify({ error: "targetNotional must be a positive number" }),
        { status: 400, headers },
      );
    }

    // Limits come from the table, so a desk that has configured its own is
    // gated on those. The fallbacks equal config.py's, which
    // tests/test_supabase_schema.py already pins against the migration.
    const { data: limits } = await supabase
      .from("desk_risk_limits")
      .select("max_order_notional_usd, max_gross_exposure_usd")
      .eq("desk_symbol", symbol)
      .eq("is_active", true)
      .maybeSingle();

    const maxNotional = Number(limits?.max_order_notional_usd ?? 50_000);
    const maxFatFinger = Number(limits?.max_gross_exposure_usd ?? 500_000);

    // Two gates. Named from the engine's own vocabulary so the mirrored verdict
    // is a label the desk already uses, not an invented one.
    let verdict: string = "ACCEPTED";
    const rejectedBy: string[] = [];
    if (targetNotional > maxFatFinger) {
      verdict = "FAT_FINGER";
      rejectedBy.push("fat_finger");
    } else if (targetNotional > maxNotional) {
      verdict = "max_order_notional";
      rejectedBy.push("max_order_notional");
    }

    if (verdict !== "ACCEPTED") {
      const latencyMs = Number((performance.now() - t0).toFixed(3));
      await supabase.from("order_blotter").insert({
        decided_by: "supabase_rpc", // (2) NOT NULL in the committed schema
        symbol,
        side,
        notional: targetNotional,
        verdict,
        rejected_by: rejectedBy,
        status: "REJECTED",
        strategy_tag: strategyTag,
        source: "edge_sandbox",
        latency_ms: latencyMs, // measured, never the blueprint's hardcoded 0.19
      });
      return new Response(
        JSON.stringify({ verdict, status: "REJECTED", decidedBy: "supabase_rpc", latencyMs }),
        { status: 200, headers },
      );
    }

    // Smart-order-router probe.
    let remaining = targetNotional;
    const allocations: Allocation[] = [];
    let weightedSum = 0;
    let filled = 0;

    for (const venue of VENUES) {
      if (remaining <= 0) break;
      const allocated = Math.min(remaining, venue.available);
      const slippageBps = Number(impactBps(venue.impactK, allocated, venue.adv).toFixed(2)); // (5)
      const vwap = Number((venue.price * (1 + slippageBps / 10_000)).toFixed(2));
      allocations.push({ venue: venue.venue, allocatedNotional: allocated, vwap, slippageBps });
      weightedSum += vwap * allocated;
      filled += allocated;
      remaining -= allocated;
    }

    // (3) Divide by what was actually filled. An unfillable remainder is
    // reported as such rather than silently improving the average.
    const blendedVwap = filled > 0 ? Number((weightedSum / filled).toFixed(2)) : null;
    const latencyMs = Number((performance.now() - t0).toFixed(3));

    const { data: entry, error } = await supabase
      .from("order_blotter")
      .insert({
        decided_by: "supabase_rpc",
        symbol,
        side,
        notional: targetNotional,
        filled_notional: filled,
        fill_price: blendedVwap,
        venue: allocations.length > 1 ? "SMART_ROUTE" : allocations[0].venue,
        verdict: "ACCEPTED",
        status: remaining > 0 ? "PARTIAL" : "SENT",
        strategy_tag: strategyTag,
        source: "edge_sandbox",
        latency_ms: latencyMs,
      })
      .select("id")
      .single();

    if (error) {
      return new Response(
        JSON.stringify({ error: "Could not record the decision", detail: error.message }),
        { status: 500, headers },
      );
    }

    return new Response(
      JSON.stringify({
        orderId: entry.id,
        verdict: "ACCEPTED",
        status: remaining > 0 ? "PARTIAL" : "SENT",
        decidedBy: "supabase_rpc",
        sandbox: true,
        summary: {
          blendedVwap,
          filledNotional: filled,
          unfilledNotional: remaining,
          // In-function compute only. It excludes TLS, the PostgREST round
          // trips above and any cold start, so it is not an end-to-end number
          // and the blueprint's "< 1.0ms" acceptance criterion cannot be read
          // off it. Named accordingly.
          computeMs: latencyMs,
          allocations,
        },
      }),
      { status: 200, headers },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: corsHeaders(req.headers.get("Origin")) },
    );
  }
});
