/**
 * Route-level glue: parameter parsing and one error shape for every provider route.
 *
 * The error shape matters more than it looks. When a request fails, the useful
 * question is never "did it fail" — it is *which providers were asked, and what
 * did each one say*. `failure()` puts the whole attempt list in the body, so a
 * 503 from this API is diagnosable from the response alone: no key set, quota
 * spent, breaker open, or a genuine upstream error with its message attached.
 */

import { NextResponse } from "next/server";

import { redact } from "../observability";
import { isValidSymbol } from "./registry";
import { Attempt, NotApplicableError, Priority, ProviderError } from "./types";

export function parseSymbols(raw: string | null, max = 8): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const s = part.trim().toUpperCase();
    if (s && isValidSymbol(s)) seen.add(s);
    if (seen.size >= max) break;
  }
  return [...seen];
}

/**
 * Callers declare intent so the quota ledger can ration.
 *
 * Defaults to `background`, which is the safe default in exactly the way that
 * matters: an auto-refreshing panel that forgets to pass the flag gets fenced
 * out of the reserve rather than silently spending a person's remaining budget.
 * Being wrong in this direction costs a refresh; the other way costs the month.
 */
export function parsePriority(raw: string | null): Priority {
  return raw === "interactive" ? "interactive" : "background";
}

export function parseProvider(raw: string | null): string | null {
  return raw && /^[a-z]+$/.test(raw) ? raw : null;
}

interface WithAttempts {
  attempts?: Attempt[];
}

export function failure(err: unknown): NextResponse {
  if (err instanceof NotApplicableError) {
    // Refused before dispatch: the capability does not apply to the symbol's
    // asset class. Nothing upstream was asked, so there is no attempt list.
    return NextResponse.json(
      {
        error: err.message,
        provider: err.provider,
        reason: "not_applicable",
        capability: err.capability,
        symbol: err.symbol,
        asset: err.asset,
        applicable: err.applicable,
        attempts: [],
        hint: err.applicable.includes("equity") ? "Try an equity ticker such as AAPL." : undefined,
      },
      { status: err.status ?? 422 },
    );
  }
  if (err instanceof ProviderError) {
    const attempts = (err as ProviderError & WithAttempts).attempts ?? [];
    // 503 rather than 502: every configured provider declined or failed, which
    // is a capacity/configuration condition on our side of the boundary, and it
    // is the status a client should retry on.
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 503;
    return NextResponse.json(
      {
        // A provider message can quote an upstream error body verbatim, and two
        // of these vendors put the API key in the URL that such a body echoes
        // back. Redaction belongs on the way out of the process, not at a call
        // site someone will forget.
        error: redact(err.message),
        provider: err.provider,
        attempts,
        // `.every` on an empty list is vacuously true, and an adapter-level
        // rejection (bad URL, unsupported interval) carries no attempts — the
        // length check keeps those from being mislabelled as a key problem.
        hint:
          attempts.length > 0 && attempts.every((a) => a.reason === "not_configured")
            ? "No provider is configured for this capability — see GET /api/providers."
            : undefined,
      },
      { status },
    );
  }
  return NextResponse.json(
    { error: err instanceof Error ? err.message : "unknown error" },
    { status: 500 },
  );
}

/**
 * Cache headers derived from the provider layer's own TTL.
 *
 * `s-maxage` lets Vercel's edge absorb repeat requests that would otherwise
 * reach a function, miss the per-instance memory cache (instances do not share
 * one) and spend real quota. `stale-while-revalidate` means a quota-exhausted
 * window still serves the last good answer rather than an error.
 */
export function cacheHeaders(ttlSeconds: number): HeadersInit {
  return {
    "cache-control": `public, s-maxage=${ttlSeconds}, stale-while-revalidate=${ttlSeconds * 4}`,
  };
}
