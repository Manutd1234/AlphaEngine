import { NextRequest, NextResponse } from "next/server";

import { redact, type UpstreamCall } from "@/lib/observability";
import { clampInt, parseEnum } from "@/lib/params";
import { parsePriority, parseSymbols } from "@/lib/providers/http";
import { applicableAssets, inapplicableReason, isApplicable } from "@/lib/providers/capabilities";
import {
  cacheKeys,
  candidatesFor,
  classify,
  getBars,
  getFundamentals,
  getNews,
  getQuote,
} from "@/lib/providers/registry";
import { store, TTL_MS } from "@/lib/providers/runtime";
import { capturedFrom, withCapture } from "@/lib/providers/trace";
import type { Attempt, Capability, Provenance, Sourced } from "@/lib/providers/types";
import { INTERVALS } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INSPECTABLE = ["quote", "bars", "news", "fundamentals"] as const;
type InspectableCapability = (typeof INSPECTABLE)[number];

interface LineageStage {
  stage: string;
  detail: string;
  /** Provider ids involved at this stage, when the stage is about providers. */
  providers?: string[];
}

/**
 * GET /api/system/inspect?symbol=BTCUSDT[&capability=quote|bars|news|fundamentals]
 *                        [&interval=4h][&bars=120][&priority=][&raw=1][&refresh=1]
 *
 * The pipeline debugger: one lookup, taken apart.
 *
 * `/api/quote` answers *what the price is*. This answers *how that number got
 * here* — which cache key was consulted and what was left on its TTL, which
 * providers were ranked ahead of the winner and why each was passed over, how
 * many HTTP calls that took, and, with `raw=1`, the vendor's own JSON before
 * normalisation. That last one is the difference between "the change field is
 * null" and "the vendor renamed it and our parser silently coerced it".
 *
 * Two flags change behaviour rather than presentation:
 *  - `refresh=1` evicts the cache entry first, so the trace shows a real
 *    network call instead of a hit. A debugger that a cached value can satisfy
 *    is not debugging anything.
 *  - `raw=1` retains upstream response bodies. They are size-bounded, sampled
 *    rather than truncated so the *shape* survives, and passed through the
 *    redactor — but they are still vendor payloads, so capture is opt-in.
 *
 * **A failed lookup is a successful inspection.** When every provider declines,
 * this still returns HTTP 200 with `ok: false` and the full attempt list, because
 * the trace is the product here and a 503 would throw away the answer the caller
 * came for.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const [symbol] = parseSymbols(params.get("symbol") ?? params.get("symbols"), 1);
  if (!symbol) {
    return NextResponse.json(
      { error: "no valid symbol; expected e.g. ?symbol=BTCUSDT" },
      { status: 400 },
    );
  }

  const capability = parseEnum<InspectableCapability>(
    params.get("capability"),
    INSPECTABLE,
    "quote",
  );
  if (!capability) {
    return NextResponse.json(
      { error: `capability must be one of ${INSPECTABLE.join(", ")}` },
      { status: 400 },
    );
  }

  const interval = parseEnum(params.get("interval"), INTERVALS, "4h") ?? "4h";
  const bars = clampInt(params.get("bars"), 10, 1_000, 120);
  const limit = clampInt(params.get("limit"), 1, 50, 8);
  const priority = parsePriority(params.get("priority"));
  const wantRaw = params.get("raw") === "1";
  const wantRefresh = params.get("refresh") === "1";

  const asset = classify(symbol);
  const cacheKey = keyFor(capability, symbol, interval, bars, limit);

  // The applicability gate, before the cache is even read. Fundamentals on a
  // crypto pair used to walk the whole equity chain — four vendors, four
  // "no issuer here" answers, one of them from Alpha Vantage's twenty-five a
  // day — and each answer was booked as a provider failure. Now the trace says
  // so in two stages and spends nothing; a refused lookup is still a
  // successful inspection, so this is HTTP 200 with `ok: false`.
  if (!isApplicable(capability, asset)) {
    const reason = inapplicableReason(capability, symbol, asset);
    return NextResponse.json(
      {
        fetchedAt: new Date().toISOString(),
        ok: false,
        reason: "not_applicable",
        symbol,
        asset,
        capability,
        applicable: applicableAssets(capability),
        totalMs: 0,
        cache: {
          key: cacheKey,
          state: "miss",
          configuredTtlMs: TTL_MS[capability],
          ttlRemainingMs: null,
          ageMs: 0,
          refreshed: false,
        },
        lineage: [
          {
            stage: "Request",
            detail: `${capability} for ${symbol}, classified as ${asset}, priority ${priority}`,
          },
          { stage: "Registry", detail: reason, providers: [] },
        ] satisfies LineageStage[],
        provenance: null,
        attempts: [],
        upstream: {
          captured: wantRaw,
          calls: [],
          note: "No HTTP call was made; the registry declined before dispatch.",
        },
        data: null,
        error: reason,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const chain = candidatesFor(capability, asset);

  if (wantRefresh) store.del(cacheKey);

  // Read the cache state *before* dispatch consumes it. Afterwards the entry
  // exists either way and "was this a hit" is no longer answerable.
  const ttlBefore = store.ttl(cacheKey);
  const wasCached = ttlBefore !== null;

  const startedAt = Date.now();
  let provenance: Provenance | null = null;
  let attempts: Attempt[] = [];
  let data: unknown = null;
  let upstream: UpstreamCall[] = [];
  let failure: string | null = null;

  try {
    const captured = await withCapture(wantRaw, () =>
      run(capability, symbol, interval, bars, limit, priority),
    );
    provenance = captured.result.provenance;
    attempts = captured.result.attempts;
    data = captured.result.data;
    upstream = captured.calls;
  } catch (err) {
    upstream = capturedFrom(err);
    attempts = (err as { attempts?: Attempt[] }).attempts ?? [];
    failure = redact(err instanceof Error ? err.message : String(err)).slice(0, 300);
  }

  const totalMs = Date.now() - startedAt;
  const ttlAfter = store.ttl(cacheKey);

  return NextResponse.json(
    {
      fetchedAt: new Date().toISOString(),
      ok: failure === null,
      symbol,
      asset,
      capability,
      totalMs,
      cache: {
        key: cacheKey,
        state: wasCached ? "hit" : "miss",
        configuredTtlMs: TTL_MS[capability],
        ttlRemainingMs: ttlAfter,
        // How long the served value had already been alive. Only meaningful on a
        // hit; on a miss the entry was written microseconds ago.
        ageMs: wasCached && ttlBefore !== null ? TTL_MS[capability] - ttlBefore : 0,
        refreshed: wantRefresh,
      },
      lineage: lineage({
        capability, symbol, asset, chain: chain.map((a) => a.meta.id),
        cacheKey, wasCached, provenance, attempts, upstream, priority,
      }),
      provenance,
      attempts,
      upstream: {
        captured: wantRaw,
        calls: upstream,
        note: wantRaw
          ? "Bodies are sampled, size-bounded and redacted. Long arrays keep a head sample and report how many elements were dropped."
          : "Add &raw=1 to retain vendor response bodies for this request.",
      },
      data,
      error: failure,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

function keyFor(
  capability: InspectableCapability,
  symbol: string,
  interval: string,
  bars: number,
  limit: number,
): string {
  switch (capability) {
    case "quote": return cacheKeys.quote(symbol, null);
    case "bars": return cacheKeys.bars(symbol, interval, bars, null);
    case "news": return cacheKeys.news([symbol], limit, null);
    case "fundamentals": return cacheKeys.fundamentals(symbol, null);
  }
}

function run(
  capability: InspectableCapability,
  symbol: string,
  interval: string,
  bars: number,
  limit: number,
  priority: "interactive" | "background",
): Promise<Sourced<unknown>> {
  const opts = { priority, env: process.env };
  switch (capability) {
    case "quote": return getQuote(symbol, opts);
    case "bars": return getBars(symbol, interval, bars, opts);
    case "news": return getNews([symbol], limit, opts);
    case "fundamentals": return getFundamentals(symbol, opts);
  }
}

/**
 * The route a value took, as an ordered list of stages.
 *
 * Assembled from what actually happened rather than from a diagram: the ranked
 * chain comes from the registry, the skips come from the attempt list dispatch
 * recorded, and the upstream count comes from the capture. Nothing here is
 * asserted that was not observed — a lineage view that describes the intended
 * architecture instead of the executed one is worse than none, because it looks
 * authoritative while disagreeing with reality.
 */
function lineage(input: {
  capability: Capability;
  symbol: string;
  asset: string;
  chain: string[];
  cacheKey: string;
  wasCached: boolean;
  provenance: Provenance | null;
  attempts: Attempt[];
  upstream: UpstreamCall[];
  priority: string;
}): LineageStage[] {
  const stages: LineageStage[] = [
    {
      stage: "Request",
      detail: `${input.capability} for ${input.symbol}, classified as ${input.asset}, priority ${input.priority}`,
    },
    {
      stage: "Registry",
      detail: input.chain.length
        ? `${input.chain.length} candidate${input.chain.length === 1 ? "" : "s"} ranked for ${input.capability}/${input.asset}`
        : `no adapter serves ${input.capability} for ${input.asset}`,
      providers: input.chain,
    },
    {
      stage: "Cache",
      detail: input.wasCached
        ? `hit on ${input.cacheKey} — no provider was contacted`
        : `miss on ${input.cacheKey}`,
    },
  ];

  if (!input.wasCached) {
    stages.push({
      stage: "Reliability policy",
      detail: input.attempts.length
        ? input.attempts.map((a) => `${a.provider}: ${a.reason}`).join(" · ")
        : "no provider was skipped — the top-ranked candidate was eligible",
      providers: input.attempts.map((a) => a.provider),
    });
    stages.push({
      stage: "Upstream",
      detail: input.upstream.length
        ? `${input.upstream.length} HTTP call${input.upstream.length === 1 ? "" : "s"}, ${input.upstream.filter((c) => !c.ok).length} failed`
        : "no HTTP call was captured for this request",
    });
  }

  if (input.provenance) {
    stages.push({
      stage: "Adapter",
      detail: `${input.provenance.label} answered in ${input.provenance.latencyMs}ms${input.provenance.delayed ? " (delayed/EOD tier)" : ""}`,
      providers: [input.provenance.provider],
    });
    stages.push({
      stage: "Normalised",
      detail: `coerced to the shared ${input.capability} shape; provenance attached, not folded into the data`,
    });
  }

  return stages;
}
