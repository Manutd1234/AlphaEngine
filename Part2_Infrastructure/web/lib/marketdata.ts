/**
 * OHLCV loading for the serverless routes.
 *
 * Binance's public klines endpoint is called server-side rather than from the
 * browser: it avoids CORS entirely, keeps the per-IP rate limit pooled at the
 * function rather than spread across users' networks, and lets Vercel's CDN
 * cache identical requests.
 *
 * If it is unreachable (region-blocked, rate-limited, offline preview) we fall
 * back to a deterministic synthetic series so the portal still demonstrates the
 * research workflow. Every response says which one it used, and the UI shows a
 * banner — synthetic data is never passed off as market data.
 */

import { recordUpstream } from "./observability";
import { Bar, BARS_PER_YEAR } from "./types";

const BINANCE_HOSTS = [
  "https://api.binance.com",
  "https://data-api.binance.vision", // public market-data mirror, no auth
];

/**
 * Index of the host that last answered.
 *
 * Same reasoning as `lib/venues.ts`: a region-blocked primary fails on *every*
 * request, not occasionally, so a fixed order makes each klines page pay a full
 * failed round trip before the mirror answers. In production `api.binance.com`
 * returns HTTP 451 from the serverless region while the mirror serves normally.
 * Kept local rather than shared because these two modules must not import each
 * other — `venues.ts` is in the client bundle and this one is server-only.
 */
let preferredBinanceHost = 0;

function binanceHosts(): string[] {
  return preferredBinanceHost === 0
    ? [...BINANCE_HOSTS]
    : [BINANCE_HOSTS[preferredBinanceHost], ...BINANCE_HOSTS.filter((_, i) => i !== preferredBinanceHost)];
}

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

  for (const host of binanceHosts()) {
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
        preferredBinanceHost = Math.max(0, BINANCE_HOSTS.indexOf(host));
        return out.slice(-bars);
      }
      lastError = new Error(`only ${out.length} bars available`);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("klines fetch failed");
}

/** Deterministic GBM with a regime shift, seeded off the symbol so the same
 *  request always reproduces the same series and results stay comparable. */
export function syntheticBars(symbol: string, interval: string, bars: number): Bar[] {
  let seed = 0;
  for (let i = 0; i < symbol.length; i++) seed = (seed * 31 + symbol.charCodeAt(i)) >>> 0;

  // Mulberry32 — small, fast, deterministic.
  let state = seed || 1;
  const rand = () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => {
    const u = Math.max(rand(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };

  const anchor: Record<string, number> =
    { BTCUSDT: 68000, ETHUSDT: 3500, SOLUSDT: 160, BNBUSDT: 600, XRPUSDT: 0.6 };
  const ann = BARS_PER_YEAR[interval] ?? 8760;
  const vol = 0.6 / Math.sqrt(ann);
  const drift = 0.25 / ann;

  const stepMs =
    { "15m": 9e5, "1h": 36e5, "4h": 144e5, "1d": 864e5 }[interval] ?? 36e5;
  const now = Date.now();

  const out: Bar[] = [];
  let price = anchor[symbol.toUpperCase()] ?? 100;
  for (let i = 0; i < bars; i++) {
    const mu = i < bars / 2 ? drift : -drift * 0.6;
    const ret = gauss() * vol + mu + Math.sin(i / 90) * vol * 0.4;
    const open = price;
    price *= Math.exp(ret);
    const noise = Math.abs(gauss()) * vol * 0.5;
    out.push({
      t: now - (bars - i) * stepMs,
      o: open,
      h: price * (1 + noise),
      l: price * (1 - noise),
      c: price,
      v: 1e6 * (0.5 + rand()),
    });
  }
  return out;
}

export async function loadBars(
  symbol: string,
  interval: string,
  bars: number,
): Promise<{ bars: Bar[]; source: "binance" | "synthetic"; warnings: string[] }> {
  try {
    return { bars: await fetchBinanceKlines(symbol, interval, bars), source: "binance", warnings: [] };
  } catch (err) {
    return {
      bars: syntheticBars(symbol, interval, bars),
      source: "synthetic",
      warnings: [
        `Could not load live market data (${(err as Error).message}). ` +
          `This run uses a deterministic synthetic price series — the workflow is real, the prices are not.`,
      ],
    };
  }
}
