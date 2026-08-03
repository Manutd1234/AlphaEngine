import { NextResponse } from "next/server";

import { capabilityMatrix, providerStatus } from "@/lib/providers/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/providers — the data-supply control panel.
 *
 * For each upstream: whether it is configured, whether its circuit is open, how
 * much of its quota is spent in the current window, and which env var would
 * enable it. Plus, per capability, the ordered list of providers that could
 * serve it right now and the variables that are missing.
 *
 * This is deliberately a first-class endpoint rather than a debug page. On a
 * desk the question "why is this number stale" has to be answerable in one
 * request, and the honest answer is usually one of exactly four things: no key,
 * quota spent, breaker open, or upstream down. All four are here.
 *
 * **No credential material is returned** — only the *names* of the variables.
 * A status endpoint echoing "key: sk-abc…" as a convenience is how secrets get
 * into logs and screenshots.
 */
export async function GET() {
  const providers = providerStatus();
  const configured = providers.filter((p) => p.configured);

  return NextResponse.json({
    fetchedAt: new Date().toISOString(),
    summary: {
      configured: configured.length,
      total: providers.length,
      degraded: providers.filter((p) => p.configured && p.circuitOpen).map((p) => p.id),
      exhausted: providers
        .filter((p) => p.configured && p.quota && p.quota.remaining <= 0)
        .map((p) => p.id),
    },
    // State lives in the function instance's memory, so on a multi-instance
    // deployment these counters describe *this* instance. Said plainly in the
    // payload rather than buried in a README, because a reader comparing two
    // responses will otherwise think the numbers are wrong.
    scope: "per-instance (in-memory ledger; swap Store for Vercel KV to share)",
    capabilities: capabilityMatrix(),
    providers,
  });
}
