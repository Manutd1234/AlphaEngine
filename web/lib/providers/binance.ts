/**
 * Binance — the keyless baseline.
 *
 * Every other provider in this registry needs a credential, which means a fresh
 * clone with no environment configured would have nothing to show. That is a bad
 * property for a system whose whole claim is reliability: "works once you supply
 * seven API keys" is not a working system, it is a promise of one.
 *
 * So the crypto path is served by Binance's public market-data endpoints, which
 * need no key and no signup. Clone, deploy, and quotes, bars and depth are live
 * immediately; adding keys extends coverage to equities, fundamentals, news and
 * the open web rather than switching anything on.
 *
 * It is a thin wrapper over the existing `venues`/`marketdata` code rather than
 * a reimplementation — that module already handles host failover, the whole-batch
 * 400 on an unknown symbol, and the pagination budget.
 */

import { fetchBinanceKlines } from "../marketdata";
import { fetchBinanceTickers } from "../venues";
import { pctChange } from "./parse";
import { Adapter, AssetClass, FetchCtx, OhlcvBar, ProviderError, Quote } from "./types";

const ID = "binance";

export const binance: Adapter = {
  meta: {
    id: ID,
    label: "Binance (public)",
    docs: "https://developers.binance.com/docs/binance-spot-api-docs",
    capabilities: ["quote", "bars"],
    assets: ["crypto"],
    // Empty means keyless: `isConfigured` treats it as always available.
    keyEnv: "",
    // Weight-based, not call-based, and generous enough that a dashboard cannot
    // realistically exhaust it. Left unmetered rather than modelled wrongly.
    quota: null,
    rank: { quote: 0, bars: 0 },
    signup: "No key required — public market data.",
  },

  async quote(symbol: string, _asset: AssetClass, _ctx: FetchCtx): Promise<Quote> {
    const [t] = await fetchBinanceTickers([symbol]);
    if (!t || t.last == null) {
      throw new ProviderError(ID, t?.error ?? `no ticker for ${symbol}`, 404, true);
    }
    // `changePct24h` is stored as a fraction upstream; this interface is percent.
    const changePct = t.changePct24h == null ? null : t.changePct24h * 100;
    const prevClose =
      changePct == null || changePct === -100 ? null : t.last / (1 + changePct / 100);
    return {
      symbol: t.symbol,
      price: t.last,
      change: prevClose == null ? null : t.last - prevClose,
      changePct: changePct ?? pctChange(t.last, prevClose),
      open: prevClose,
      high: t.high24h,
      low: t.low24h,
      prevClose,
      volume: t.volume24h,
      // The quote asset, not a fiat currency — USDT is not USD and the label
      // should not pretend otherwise on a screen a trader reads.
      currency: symbol.toUpperCase().endsWith("USDT") ? "USDT" : "USD",
      asOf: new Date().toISOString(),
      delayed: false,
    };
  },

  async bars(
    symbol: string,
    _asset: AssetClass,
    interval: string,
    limit: number,
    _ctx: FetchCtx,
  ): Promise<OhlcvBar[]> {
    const bars = await fetchBinanceKlines(symbol, interval, limit);
    return bars.map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
  },
};
