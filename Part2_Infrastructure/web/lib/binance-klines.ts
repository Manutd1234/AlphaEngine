/**
 * Binance public klines — the crypto OHLCV fetcher.
 *
 * Extracted out of `marketdata.ts` to break an import cycle, and the cycle is
 * worth naming because it is the shape of the bug this extraction is part of
 * fixing. `marketdata.loadBars` now routes equities through the provider
 * registry; the registry's binance adapter is a thin wrapper over this
 * function; so marketdata -> registry -> binance -> marketdata. ESM tolerates
 * that when every use is deferred behind a function call, which is true here
 * today and is exactly the kind of thing that stops being true silently.
 *
 * Everything below moved verbatim. `loadBars` and `syntheticBars` stayed
 * behind, because they are the policy and this is the transport.
 */

import { HostPreference } from "./host-preference";
import { recordUpstream } from "./observability";
import { Bar } from "./types";

const BINANCE_HOSTS = [
  "https://api.binance.com",
  "https://data-api.binance.vision", // public market-data mirror, no auth
];

/**
 * Which host last answered.
 *
 * Same reasoning as `lib/venues/types.ts`: a region-blocked primary fails on
 * *every* request, not occasionally, so a fixed order makes each klines page
 * pay a full failed round trip before the mirror answers. In production
 * `api.binance.com` returns HTTP 451 from the serverless region while the
 * mirror serves normally.
 *
 * The memo used to be a bare `let` here and a second bare `let` in the Bybit
 * transport, each with its own hand-written reordering expression, because the
 * venue module that already had one is in the client bundle and this one is
 * server-only, so neither could import the other. `HostPreference` has no
 * imports at all, which is what lets all three share the implementation without
 * dragging a server module into the browser.
 */
const hostPreference = new HostPreference(BINANCE_HOSTS);

/**
 * Timeouts, because a *stalled* upstream is worse than a dead one.
 *
 * A refused connection fails in milliseconds and we fall through to the next
 * host. A host that completes the TCP handshake and then sends nothing has no
 * bound other than undici's 300s header timeout — across two hosts and a
 * sequential pagination loop that is ~10 minutes, far past any serverless
 * limit. The function is killed before the synthetic fallback can run, so the
 * caller gets a platform 504 with no JSON body instead of a degraded result.
 *
 * Two bounds are needed: per-request (a single stalled socket) and overall
 * (many slow-but-not-stalled requests in the pagination loop).
 */
const FETCH_TIMEOUT_MS = 8_000;
const OVERALL_BUDGET_MS = 20_000;

async function withTimeout(
  run: (signal: AbortSignal) => Promise<Response>,
  ms = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchBinanceKlines(
  symbol: string,
  interval: string,
  bars: number,
): Promise<Bar[]> {
  let lastError: unknown = null;
  const startedAt = Date.now();

  for (const host of hostPreference.ordered()) {
    try {
      const out: Bar[] = [];
      let endTime: number | undefined;

      while (out.length < bars) {
        if (Date.now() - startedAt > OVERALL_BUDGET_MS) {
          throw new Error(`klines pagination exceeded ${OVERALL_BUDGET_MS}ms budget`);
        }
        const limit = Math.min(1000, bars - out.length);
        const params = new URLSearchParams({
          symbol: symbol.toUpperCase(),
          interval,
          limit: String(limit),
        });
        if (endTime) params.set("endTime", String(endTime));

        const url = `${host}/api/v3/klines?${params}`;
        const pageStartedAt = Date.now();
        let res: Response;
        try {
          res = await withTimeout((signal) =>
            fetch(url, {
              signal,
              // Cache identical grids at the edge for a minute — a sweep does not
              // need second-fresh history, and it keeps us inside the rate limit.
              next: { revalidate: 60 },
            }),
          );
        } catch (err) {
          // A stalled host is the failure this file's timeouts exist for, so it
          // is the one the telemetry must not be silent about. Without this the
          // health matrix reports a 0% error rate for `venue:binance` while
          // every klines request is burning its full 8s and falling back to
          // synthetic bars.
          const message = err instanceof Error ? err.message : String(err);
          const timedOut = err instanceof Error && err.name === "AbortError";
          recordUpstream({
            provider: "binance",
            url,
            status: null,
            ms: Date.now() - pageStartedAt,
            ok: false,
            error: timedOut ? `timed out after ${FETCH_TIMEOUT_MS}ms` : message,
            latencyKey: "venue:binance",
          });
          throw err;
        }
        if (!res.ok) {
          // Reported per page, not per call to this function: a sweep that
          // paginates six times and fails on the fifth is six upstream calls,
          // and a trace that collapses them cannot show which page broke.
          recordUpstream({
            provider: "binance",
            url,
            status: res.status,
            ms: Date.now() - pageStartedAt,
            ok: false,
            error: `HTTP ${res.status}`,
            latencyKey: "venue:binance",
          });
          throw new Error(`${host} responded ${res.status}`);
        }

        let chunk: unknown[][];
        try {
          chunk = (await res.json()) as unknown[][];
        } catch (err) {
          // HTTP 200 carrying a non-JSON body — a captive portal, a CDN
          // interstitial, a region block served as HTML. Reported rather than
          // swallowed, because it is indistinguishable from a healthy host in
          // every other signal we collect.
          recordUpstream({
            provider: "binance",
            url,
            status: res.status,
            ms: Date.now() - pageStartedAt,
            ok: false,
            error: "expected JSON, got a non-JSON body",
            latencyKey: "venue:binance",
          });
          throw err;
        }
        recordUpstream({
          provider: "binance",
          url,
          status: res.status,
          ms: Date.now() - pageStartedAt,
          ok: true,
          payload: chunk,
          latencyKey: "venue:binance",
        });
        if (!chunk.length) break;

        const parsed: Bar[] = chunk.map((k) => ({
          t: Number(k[0]),
          o: Number(k[1]),
          h: Number(k[2]),
          l: Number(k[3]),
          c: Number(k[4]),
          v: Number(k[5]),
        }));
        out.unshift(...parsed);
        endTime = parsed[0].t - 1;
        if (chunk.length < limit) break;
      }

      if (out.length >= Math.min(bars, 200)) {
        hostPreference.remember(host);
        return out.slice(-bars);
      }
      lastError = new Error(`only ${out.length} bars available`);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("klines fetch failed");
}
