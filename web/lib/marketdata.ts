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

import { Bar, BARS_PER_YEAR } from "./types";

const BINANCE_HOSTS = [
  "https://api.binance.com",
  "https://data-api.binance.vision", // public market-data mirror, no auth
];

export async function fetchBinanceKlines(
  symbol: string,
  interval: string,
  bars: number,
): Promise<Bar[]> {
  let lastError: unknown = null;

  for (const host of BINANCE_HOSTS) {
    try {
      const out: Bar[] = [];
      let endTime: number | undefined;

      while (out.length < bars) {
        const limit = Math.min(1000, bars - out.length);
        const params = new URLSearchParams({
          symbol: symbol.toUpperCase(),
          interval,
          limit: String(limit),
        });
        if (endTime) params.set("endTime", String(endTime));

        const res = await fetch(`${host}/api/v3/klines?${params}`, {
          // Cache identical grids at the edge for a minute — a sweep does not
          // need second-fresh history, and it keeps us inside the rate limit.
          next: { revalidate: 60 },
        });
        if (!res.ok) throw new Error(`${host} responded ${res.status}`);

        const chunk = (await res.json()) as unknown[][];
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

      if (out.length >= Math.min(bars, 200)) return out.slice(-bars);
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
        `Live market data unreachable (${(err as Error).message}). ` +
          `This run uses a deterministic synthetic price series — the workflow is real, the prices are not.`,
      ],
    };
  }
}
