/**
 * Bybit — the second keyless venue, and the nearer of the two.
 *
 * Binance was the keyless baseline so that a fresh clone with no environment
 * configured still has live crypto data. That reasoning is unchanged; this adds
 * a second venue with the same property, which makes the crypto path the only
 * one in the registry with real failover that needs no credential at all.
 *
 * WHY IT OUTRANKS BINANCE FOR BARS
 *
 * Measured round trip to each venue's server clock — an endpoint no CDN edge
 * can answer from cache, so it reveals the origin rather than the nearest point
 * of presence:
 *
 *     api.bybit.com      origin   6.2 ms
 *     api.binance.com    origin  72.7 ms
 *
 * Both TCP handshakes terminate ~1.5 ms away at a Singapore edge and are
 * indistinguishable; the origins are 11.7x apart. From the Vercel serverless
 * region the gap measures ~8x (Bybit 9-11 ms, Binance 77-90 ms over five
 * consecutive production calls). `tools/colocation_probe.py` reproduces both.
 *
 * WHY BARS ONLY, AND NOT QUOTES
 *
 * Scope, stated rather than implied. Bybit exposes `/v5/market/tickers` and it
 * would work here, but the quote path is one call where the bars path is up to
 * five paginated ones, so the latency argument that justifies this file barely
 * applies to quotes. Adding a capability because it is possible, rather than
 * because it is worth it, is how a registry accumulates adapters nobody has
 * measured. Binance keeps `quote: 0` and is unchanged.
 *
 * Deliberately NOT a change to execution. `venues.ts` still walks the merged
 * cross-venue ladder by price, and Bybit's spot book is thinner than Binance's
 * on most pairs — nearer is not deeper, and this file makes no claim about
 * where an order should route.
 */

import { fetchBybitKlines } from "../bybit-klines";
import { Adapter, AssetClass, FetchCtx, OhlcvBar } from "./types";

const ID = "bybit";

export const bybit: Adapter = {
  meta: {
    id: ID,
    label: "Bybit (public)",
    docs: "https://bybit-exchange.github.io/docs/v5/market/kline",
    capabilities: ["bars"],
    assets: ["crypto"],
    // Keyless, exactly like Binance: `isConfigured` treats an empty string as
    // always available.
    keyEnv: "",
    // Bybit meters by IP over a rolling window rather than by a daily call
    // budget, so there is no honest number to put here. Left unmetered rather
    // than modelled wrongly — the same choice the Binance adapter makes, and
    // for the same reason.
    quota: null,
    // Ahead of Binance on bars, and only on bars. The ordering is the measured
    // latency and nothing else.
    rank: { bars: 0 },
    signup: "No key required — public market data.",
  },

  async bars(
    symbol: string,
    _asset: AssetClass,
    interval: string,
    limit: number,
    _ctx: FetchCtx,
  ): Promise<OhlcvBar[]> {
    const bars = await fetchBybitKlines(symbol, interval, limit);
    return bars.map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
  },
};
