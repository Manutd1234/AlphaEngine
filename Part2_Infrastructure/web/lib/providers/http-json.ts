/**
 * One HTTP call to a vendor, with timeout, bounded retry and error normalisation.
 * ==============================================================================
 *
 * ── Why this is its own file, and what must never leave it ──────────────────
 * `httpJson` is the ONLY place in the provider layer where a raw vendor body
 * exists. Between `JSON.parse` and the adapter normalising the result there is
 * one expression holding what the vendor actually sent; a few frames later
 * `dispatch` has a `Quote` or a `Bar[]` and the original is gone.
 *
 * That is why `recordRawBody` is called from inside the success path here and
 * nowhere else. Moving the raw contract check out to the dispatch site does not
 * fail — it silently starts checking the NORMALISED object, reports green
 * against a shape the vendor never sent, and hands `quarantinePayload` a
 * sanitised sample. That was a real defect in this file, fixed once already,
 * and `tests/provider-fetch-path.test.ts` pins the call site so it cannot come
 * back by accident.
 *
 * ── Errors carry no credential and no host ──────────────────────────────────
 * Every `ProviderError` raised below is built from a status line, a timeout
 * figure or a truncated body — never from `url`, which for Alpha Vantage and
 * FMP carries the API key in its query string. The one body that is quoted is
 * capped and passes `redact()` at the dispatch site before it is stored.
 */

import { recordUpstream } from "../observability";
// Side-effecting import: installs the AsyncLocalStorage-backed capture resolver
// that `recordUpstream` consults. Server-only, and this module is server-only.
import "./trace";
import { recordRawBody } from "./raw-sink";
import { ProviderError } from "./types";

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_ATTEMPTS = 3;

/** Statuses where trying again can plausibly change the answer. */
function isRetryable(status: number): boolean {
  // 401/403 are credential problems and 404 is a bad symbol: retrying those
  // burns quota to receive the identical error. 429 is retryable only because
  // we back off — see the delay below.
  return status === 429 || status === 408 || (status >= 500 && status < 600);
}

function backoffMs(attempt: number): number {
  // Full jitter. Several providers share an upstream CDN; synchronised retries
  // from a fan-out would arrive as a burst and re-trigger the same 429.
  const ceiling = Math.min(2_000, 250 * 2 ** attempt);
  return Math.random() * ceiling;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One HTTP call with timeout, bounded retry and error normalisation.
 *
 * Returns parsed JSON. Non-JSON bodies are an error rather than a silent
 * `undefined`: several of these vendors answer an auth failure with an HTML
 * error page and HTTP 200, and `res.json()` on that throws a SyntaxError whose
 * message ("Unexpected token '<'") tells an operator nothing.
 */
export async function httpJson(
  provider: string,
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  let last: ProviderError | null = null;
  // OpenBB already enforces its own seven-second worker bound. Retrying the
  // gateway request here would leave multiple non-cancellable Python provider
  // threads running after the caller has moved on, so it gets one bounded
  // attempt and normal registry failover handles the next source.
  const maxAttempts = provider === "openbb" ? 1 : MAX_ATTEMPTS;
  const effectiveTimeoutMs = provider === "openbb" ? Math.min(timeoutMs, 7_500) : timeoutMs;
  const method = (init.method ?? "GET").toUpperCase();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await sleep(backoffMs(attempt));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs);
    const startedAt = Date.now();
    // Every attempt reports exactly once. A retried request is three upstream
    // calls and the inspector shows three, because "it worked" and "it worked on
    // the third try" are different facts about a provider — and the second one
    // is invisible in a per-request latency figure that only counts the winner.
    let reported = false;
    const report = (
      ok: boolean,
      status: number | null,
      extra: { error?: string; payload?: unknown } = {},
    ) => {
      reported = true;
      recordUpstream({ provider, method, url, status, ms: Date.now() - startedAt, ok, ...extra });
    };

    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: { accept: "application/json", ...(init.headers ?? {}) },
        cache: "no-store",
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        report(false, res.status, { error: `HTTP ${res.status}` });
        last = new ProviderError(
          provider,
          `HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
          res.status,
          isRetryable(res.status),
        );
        if (!last.retryable) throw last;
        continue;
      }

      const text = await res.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        report(false, res.status, { error: "expected JSON, got a non-JSON body" });
        // Explicitly `failed`: a 2xx that will not parse is the vendor not
        // answering, whatever the status line says.
        throw new ProviderError(
          provider,
          `expected JSON, got ${text.slice(0, 120)}`,
          res.status,
          false,
          "failed",
        );
      }
      // Reporting sits outside the parse guard on purpose: a fault in the
      // telemetry path must not be caught and re-labelled as a malformed vendor
      // response, which is exactly the misdiagnosis this console exists to end.
      report(true, res.status, { payload: parsed });
      recordRawBody(provider, parsed);  // the only point the RAW body exists
      return parsed;
    } catch (err) {
      if (err instanceof ProviderError) {
        if (!err.retryable) throw err;
        last = err;
        continue;
      }
      // AbortError and network failures: both worth one more try.
      const msg = err instanceof Error ? err.message : String(err);
      const timedOut = err instanceof Error && err.name === "AbortError";
      if (!reported) {
        report(false, null, { error: timedOut ? `timed out after ${effectiveTimeoutMs}ms` : msg });
      }
      last = new ProviderError(
        provider,
        timedOut ? `timed out after ${effectiveTimeoutMs}ms` : msg,
        null,
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  throw last ?? new ProviderError(provider, "request failed");
}
