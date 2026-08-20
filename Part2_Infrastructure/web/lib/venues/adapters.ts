import { bandImbalance, depthWithinBps, spreadBps } from "./book-maths";
import { BINANCE_HOSTS, BYBIT_HOSTS, Level, VenueBook, VenueName, getJson, orderedHosts, rememberHost } from "./types";

// --------------------------------------------------------------------------- //
// Venue adapters
// --------------------------------------------------------------------------- //
function finalise(
  venue: VenueName,
  symbol: string,
  bids: Level[],
  asks: Level[],
  latencyMs: number,
): VenueBook {
  bids.sort((a, b) => b[0] - a[0]);
  asks.sort((a, b) => a[0] - b[0]);
  const bestBid = bids.length ? bids[0][0] : null;
  const bestAsk = asks.length ? asks[0][0] : null;
  const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : null;
  const db = depthWithinBps(bids, mid, "bid");
  const da = depthWithinBps(asks, mid, "ask");
  return {
    venue,
    symbol,
    ok: true,
    latencyMs,
    bids,
    asks,
    bestBid,
    bestAsk,
    mid,
    spreadBps: spreadBps(bestBid, bestAsk),
    depthUsdBid: db,
    depthUsdAsk: da,
    imbalance: bandImbalance(bids, asks, mid),
  };
}

export function failed(venue: VenueName, symbol: string, error: string, latencyMs: number): VenueBook {
  return {
    venue,
    symbol,
    ok: false,
    error,
    latencyMs,
    bids: [],
    asks: [],
    bestBid: null,
    bestAsk: null,
    mid: null,
    spreadBps: null,
    depthUsdBid: 0,
    depthUsdAsk: 0,
    imbalance: null,
  };
}

export async function fetchBinanceBook(symbol: string, limit = 100): Promise<VenueBook> {
  const t0 = Date.now();
  let lastError = "unreachable";
  for (const host of orderedHosts("binance", BINANCE_HOSTS)) {
    try {
      const d = (await getJson(
        `${host}/api/v3/depth?symbol=${symbol.toUpperCase()}&limit=${limit}`,
      )) as { bids: [string, string][]; asks: [string, string][] };
      rememberHost("binance", BINANCE_HOSTS, host);
      return finalise(
        "BINANCE",
        symbol,
        d.bids.map(([p, q]) => [Number(p), Number(q)] as Level),
        d.asks.map(([p, q]) => [Number(p), Number(q)] as Level),
        Date.now() - t0,
      );
    } catch (err) {
      lastError = (err as Error).message;
    }
  }
  return failed("BINANCE", symbol, lastError, Date.now() - t0);
}

export async function fetchBybitBook(symbol: string, limit = 50): Promise<VenueBook> {
  const t0 = Date.now();
  let lastError = "unreachable";
  for (const host of orderedHosts("bybit", BYBIT_HOSTS)) {
    try {
      const d = (await getJson(
        `${host}/v5/market/orderbook?category=spot&symbol=${symbol.toUpperCase()}&limit=${Math.min(limit, 200)}`,
        0,
        "BYBIT",
      )) as { retCode: number; retMsg?: string; result?: { b: [string, string][]; a: [string, string][] } };
      // A non-zero retCode is an application-level refusal on an HTTP 200, so it
      // has to be treated as a failure of *this host* and retried on the next —
      // otherwise the mirror is never reached for the one class of error it
      // exists to route around.
      if (d.retCode !== 0 || !d.result) throw new Error(d.retMsg || `retCode ${d.retCode}`);
      rememberHost("bybit", BYBIT_HOSTS, host);
      return finalise(
        "BYBIT",
        symbol,
        d.result.b.map(([p, q]) => [Number(p), Number(q)] as Level),
        d.result.a.map(([p, q]) => [Number(p), Number(q)] as Level),
        Date.now() - t0,
      );
    } catch (err) {
      lastError = (err as Error).message;
    }
  }
  return failed("BYBIT", symbol, lastError, Date.now() - t0);
}

/** Both venues in parallel — a slow venue must not delay the fast one. */
export async function fetchBooks(symbol: string, limit = 100): Promise<VenueBook[]> {
  return Promise.all([fetchBinanceBook(symbol, limit), fetchBybitBook(symbol, limit)]);
}

export interface Ticker {
  symbol: string;
  venue: VenueName;
  last: number | null;
  changePct24h: number | null;
  high24h: number | null;
  low24h: number | null;
  volume24h: number | null;
  quoteVolume24h: number | null;
  error?: string;
}

export async function fetchBinanceTickers(symbols: readonly string[]): Promise<Ticker[]> {
  const query = encodeURIComponent(JSON.stringify(symbols.map((s) => s.toUpperCase())));
  let lastError = "unreachable";
  for (const host of orderedHosts("binance", BINANCE_HOSTS)) {
    try {
      const rows = (await getJson(`${host}/api/v3/ticker/24hr?symbols=${query}`, 5)) as Array<
        Record<string, string>
      >;
      rememberHost("binance", BINANCE_HOSTS, host);
      return rows.map((r) => ({
        symbol: r.symbol,
        venue: "BINANCE" as const,
        last: Number(r.lastPrice),
        changePct24h: Number(r.priceChangePercent) / 100,
        high24h: Number(r.highPrice),
        low24h: Number(r.lowPrice),
        volume24h: Number(r.volume),
        quoteVolume24h: Number(r.quoteVolume),
      }));
    } catch (err) {
      // Keep the reason. Binance 400s the WHOLE batch on one unknown symbol
      // (-1121), and the mirror returns the same 400 — so swallowing it reported
      // "unreachable" for six live instruments while the exchange was answering
      // pings in 0.11s. A delist or rename (MATIC -> POL is real precedent) would
      // silently blank every symbol for every caller.
      lastError = (err as Error).message;
    }
  }

  // Per-symbol retry, so one bad symbol cannot take the good ones down with it.
  if (symbols.length > 1) {
    const settled = await Promise.all(symbols.map((s) => fetchBinanceTickers([s])));
    return settled.flat();
  }

  return symbols.map((s) => ({
    symbol: s,
    venue: "BINANCE" as const,
    last: null,
    changePct24h: null,
    high24h: null,
    low24h: null,
    volume24h: null,
    quoteVolume24h: null,
    error: lastError,
  }));
}
