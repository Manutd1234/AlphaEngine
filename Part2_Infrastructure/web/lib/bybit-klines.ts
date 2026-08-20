/**
 * Bybit public klines — the fast path for crypto OHLCV.
 *
 * WHY THIS EXISTS ALONGSIDE `binance-klines.ts`
 *
 * Measured, not assumed. `tools/colocation_probe.py` reports a round trip to
 * each venue's *server clock* — an endpoint no CDN edge can answer from cache,
 * so it reveals the origin rather than the nearest point of presence:
 *
 *     api.binance.com    connect  1.6 ms    origin  72.7 ms
 *     api.bybit.com      connect  1.5 ms    origin   6.2 ms
 *
 * Both handshakes terminate at a Singapore edge and look identical. Behind
 * them, Binance's origin is in Tokyo and Bybit's is not, and that is an 11.7x
 * difference on every bar this application loads. From the Vercel serverless
 * region the same asymmetry holds at ~8x (Bybit 9-11 ms, Binance 77-90 ms,
 * measured over five consecutive production calls).
 *
 * THE STALE FACT THIS REPLACES
 *
 * `venues.ts` carried a comment stating Bybit answers HTTP 403 to every request
 * from the serverless region — a 100% error rate. That was true when it was
 * written and is no longer: five consecutive production probes returned a book
 * from Bybit, faster than Binance every time. The comment has been corrected
 * rather than deleted, because "this venue was unusable from here" is worth
 * knowing had been true, and a fact that changed silently once can change back.
 *
 * WHAT THIS DOES NOT CLAIM
 *
 * Being nearer is not being better. Bybit's spot book is thinner than Binance's
 * on most pairs, so the venue that loads history fastest is not automatically
 * the venue an order should route to — `venues.ts` still walks the merged
 * ladder by price and is unchanged by any of this. This file affects where
 * *research bars* come from, which is a latency question, not an execution one.
 */

import { HostPreference } from "./host-preference";
import { recordUpstream } from "./observability";
import { Bar } from "./types";

/** Primary and the documented alternate, same pair `venues.ts` fails over. */
const BYBIT_HOSTS = [
  "https://api.bybit.com",
  "https://api.bytick.com",
];

/**
 * Bybit names intervals in minutes-as-a-number, Binance in `1h`/`4h` strings.
 *
 * An explicit table rather than a parser, and an unknown key THROWS rather than
 * defaulting. A silent default here is the worst available failure: asking for
 * `1d` and receiving `1m` bars returns a full, well-formed, plausible series
 * that is wrong by a factor of 1440, and every statistic downstream would be
 * computed on it without a single warning. Failing loudly sends the caller to
 * the Binance fallback, which does understand the interval.
 */
const INTERVAL_TO_BYBIT: Record<string, string> = {
  "1m": "1",
  "3m": "3",
  "5m": "5",
  "15m": "15",
  "30m": "30",
  "1h": "60",
  "2h": "120",
  "4h": "240",
  "6h": "360",
  "12h": "720",
  "1d": "D",
  "1w": "W",
  "1M": "M",
};

export function bybitInterval(interval: string): string {
  const mapped = INTERVAL_TO_BYBIT[interval];
  if (!mapped) throw new Error(`bybit does not expose the ${interval} interval`);
  return mapped;
}

/** Bybit's documented maximum for `/v5/market/kline`, verified live. */
const MAX_PAGE = 1000;

const FETCH_TIMEOUT_MS = 8_000;
const OVERALL_BUDGET_MS = 20_000;

/** Which host last answered, per process. The same owner the Binance path uses. */
const hostPreference = new HostPreference(BYBIT_HOSTS);

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

interface BybitKlineResponse {
  retCode: number;
  retMsg?: string;
  result?: { list?: string[][] };
}

/**
 * Parse one page, newest-first, into oldest-first `Bar`s.
 *
 * THE TRAP THIS FUNCTION EXISTS TO CONTAIN
 *
 * Binance returns klines ASCENDING (oldest first). Bybit returns them
 * DESCENDING (newest first) — verified live, not read from a doc. Every
 * indicator in `lib/engine.ts` reads `bars[i-1]` as the previous bar in time,
 * so handing it a reversed series does not crash, does not warn, and does not
 * produce obviously wrong output: it produces a complete backtest of every
 * strategy run backwards through history. That is the single most dangerous
 * defect this file could ship, and it would look exactly like a working feature.
 *
 * So the reversal happens here, once, at the transport boundary, and
 * `assertAscending` below re-checks the result rather than trusting this
 * comment to stay true.
 *
 * Bybit's row is `[start, open, high, low, close, volume, turnover]` — seven
 * fields against Binance's twelve. Only the first six are read, and they are
 * the same six in the same order.
 */
export function parseBybitPage(list: string[][]): Bar[] {
  const parsed = list.map((k) => ({
    t: Number(k[0]),
    o: Number(k[1]),
    h: Number(k[2]),
    l: Number(k[3]),
    c: Number(k[4]),
    v: Number(k[5]),
  }));
  // Sorted rather than reversed. `reverse()` is correct only if the venue's
  // ordering never changes; sorting is correct either way, costs nothing at
  // this size, and cannot be broken by Bybit shipping an ascending response.
  parsed.sort((a, b) => a.t - b.t);
  return parsed;
}

/**
 * Refuse to return a series that is not strictly increasing in time.
 *
 * Belt and braces over `parseBybitPage`'s sort, and deliberately not a warning:
 * a caller that receives bars has no way to detect this itself, and the
 * fallback to Binance is right there. Duplicate timestamps are caught too —
 * they arrive when a page boundary is computed wrongly, and they quietly
 * double-count a bar's return.
 */
function assertAscending(bars: Bar[], symbol: string): void {
  for (let i = 1; i < bars.length; i++) {
    if (bars[i].t <= bars[i - 1].t) {
      throw new Error(
        `bybit returned a non-monotonic series for ${symbol} at index ${i} `
          + `(${bars[i - 1].t} then ${bars[i].t}) — refusing to backtest on it`,
      );
    }
  }
}

/**
 * OHLCV from Bybit spot, oldest-first, at most `bars` rows.
 *
 * Pages backwards from now via `end`, exactly as the Binance path does: one
 * page is 1000 rows and a sweep asks for up to 5000. Verified live that
 * `end = oldest - 1` yields a contiguous, non-overlapping previous page.
 */
export async function fetchBybitKlines(
  symbol: string,
  interval: string,
  bars: number,
): Promise<Bar[]> {
  // Thrown before any network call — an unsupported interval is a caller error,
  // not an outage, and it must not be reported as one.
  const bybitIv = bybitInterval(interval);

  let lastError: unknown = null;
  const startedAt = Date.now();

  for (const host of hostPreference.ordered()) {
    try {
      const out: Bar[] = [];
      let end: number | undefined;

      while (out.length < bars) {
        if (Date.now() - startedAt > OVERALL_BUDGET_MS) {
          throw new Error(`bybit klines pagination exceeded ${OVERALL_BUDGET_MS}ms budget`);
        }
        const limit = Math.min(MAX_PAGE, bars - out.length);
        const params = new URLSearchParams({
          category: "spot",
          symbol: symbol.toUpperCase(),
          interval: bybitIv,
          limit: String(limit),
        });
        if (end) params.set("end", String(end));

        const url = `${host}/v5/market/kline?${params}`;
        const pageStartedAt = Date.now();
        let res: Response;
        try {
          res = await withTimeout((signal) =>
            fetch(url, {
              signal,
              // Same 60s edge cache as the Binance path: a sweep does not need
              // second-fresh history, and it keeps us inside the rate limit.
              next: { revalidate: 60 },
            }),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const timedOut = err instanceof Error && err.name === "AbortError";
          recordUpstream({
            provider: "bybit",
            url,
            status: null,
            ms: Date.now() - pageStartedAt,
            ok: false,
            error: timedOut ? `timed out after ${FETCH_TIMEOUT_MS}ms` : message,
            latencyKey: "venue:bybit",
          });
          throw err;
        }

        if (!res.ok) {
          recordUpstream({
            provider: "bybit",
            url,
            status: res.status,
            ms: Date.now() - pageStartedAt,
            ok: false,
            error: `HTTP ${res.status}`,
            latencyKey: "venue:bybit",
          });
          throw new Error(`${host} responded ${res.status}`);
        }

        let payload: BybitKlineResponse;
        try {
          payload = (await res.json()) as BybitKlineResponse;
        } catch (err) {
          recordUpstream({
            provider: "bybit",
            url,
            status: res.status,
            ms: Date.now() - pageStartedAt,
            ok: false,
            error: "expected JSON, got a non-JSON body",
            latencyKey: "venue:bybit",
          });
          throw err;
        }

        // Bybit signals application-level refusals on an HTTP 200, so a bare
        // `res.ok` check treats a rejection as a successful empty page. Same
        // reasoning as the `retCode` handling in `venues.ts`, and the same
        // consequence if omitted: the mirror host is never reached for the one
        // class of error it exists to route around.
        if (payload.retCode !== 0) {
          recordUpstream({
            provider: "bybit",
            url,
            status: res.status,
            ms: Date.now() - pageStartedAt,
            ok: false,
            error: payload.retMsg || `retCode ${payload.retCode}`,
            latencyKey: "venue:bybit",
          });
          throw new Error(payload.retMsg || `bybit retCode ${payload.retCode}`);
        }

        recordUpstream({
          provider: "bybit",
          url,
          status: res.status,
          ms: Date.now() - pageStartedAt,
          ok: true,
          payload: payload.result?.list,
          latencyKey: "venue:bybit",
        });

        const list = payload.result?.list ?? [];
        if (!list.length) break;

        const page = parseBybitPage(list);
        out.unshift(...page);
        end = page[0].t - 1;
        if (list.length < limit) break;
      }

      // The same floor the Binance path uses: a handful of bars is not a
      // backtest, and returning them would defeat the fallback.
      if (out.length >= Math.min(bars, 200)) {
        assertAscending(out, symbol);
        hostPreference.remember(host);
        return out.slice(-bars);
      }
      lastError = new Error(`only ${out.length} bars available`);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("bybit klines fetch failed");
}
