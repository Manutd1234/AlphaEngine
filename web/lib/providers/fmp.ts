/**
 * Financial Modeling Prep — quotes, EOD history, company profile, news.
 *
 * Ranked first for fundamentals: it is the only provider here that serves a
 * complete profile — sector, valuation ratios, share count and description — in
 * one call, where Alpha Vantage costs a quarter of its daily allowance for the
 * same row and Massive's reference endpoint has no ratios at all.
 *
 * Uses the `/stable/` API rather than the legacy `/api/v3/` paths. v3 still
 * answers for older keys but new keys are provisioned against `/stable/` only,
 * so a v3 integration fails on exactly the keys a reviewer would create today.
 */

import { arr, isoOrNow, num, obj, pctChange, str } from "./parse";
import {
  Adapter,
  AssetClass,
  FetchCtx,
  Fundamentals,
  NewsItem,
  OhlcvBar,
  ProviderError,
  Quote,
} from "./types";

const ID = "fmp";

function assertOk(payload: unknown): unknown {
  const o = obj(payload);
  const err = str(o["Error Message"]) ?? str(o["error"]);
  if (err) throw new ProviderError(ID, err.slice(0, 180), 400, false);
  return payload;
}

function url(ctx: FetchCtx, path: string, params: Record<string, string>): string {
  const q = new URLSearchParams({ ...params, apikey: ctx.key });
  return `${ctx.baseUrl}/stable/${path}?${q}`;
}

export const fmp: Adapter = {
  meta: {
    id: ID,
    label: "Financial Modeling Prep",
    docs: "https://site.financialmodelingprep.com/developer/docs/stable",
    capabilities: ["quote", "bars", "fundamentals", "news"],
    assets: ["equity", "crypto"],
    keyEnv: "FMP_API_KEY",
    baseUrlEnv: "FMP_BASE_URL",
    quota: { calls: 250, window: "day", reserve: 0.2 },
    rank: { quote: 1, bars: 3, fundamentals: 1, news: 4 },
    signup: "Free key at financialmodelingprep.com — 250 requests/day.",
  },

  async quote(symbol: string, _asset: AssetClass, ctx: FetchCtx): Promise<Quote> {
    const rows = arr(assertOk(await ctx.json(url(ctx, "quote", { symbol }))));
    const r = obj(rows[0]);
    const price = num(r["price"]);
    if (price == null) throw new ProviderError(ID, `no quote for ${symbol}`, 404, false);
    const prevClose = num(r["previousClose"]);
    return {
      symbol: (str(r["symbol"]) ?? symbol).toUpperCase(),
      price,
      change: num(r["change"]) ?? (prevClose == null ? null : price - prevClose),
      changePct: num(r["changePercentage"]) ?? pctChange(price, prevClose),
      open: num(r["open"]),
      high: num(r["dayHigh"]),
      low: num(r["dayLow"]),
      prevClose,
      volume: num(r["volume"]),
      currency: "USD",
      asOf: isoOrNow(r["timestamp"]),
      delayed: false,
    };
  },

  async bars(
    symbol: string,
    _asset: AssetClass,
    interval: string,
    limit: number,
    ctx: FetchCtx,
  ): Promise<OhlcvBar[]> {
    if (interval !== "1d") {
      // Intraday history is a paid entitlement. Declining is cheaper than
      // spending a call to be told so, and the registry has three other
      // providers that serve intraday for free.
      throw new ProviderError(ID, `interval ${interval} requires a paid plan`, 402, false);
    }
    const from = new Date(Date.now() - 864e5 * limit * 1.6).toISOString().slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);
    const rows = arr(
      assertOk(await ctx.json(url(ctx, "historical-price-eod/full", { symbol, from, to }))),
    );

    const bars: OhlcvBar[] = [];
    for (const row of rows) {
      const r = obj(row);
      const c = num(r["close"]);
      const t = isoOrNow(r["date"]);
      if (c == null) continue;
      bars.push({
        t: Date.parse(t),
        o: num(r["open"]) ?? c,
        h: num(r["high"]) ?? c,
        l: num(r["low"]) ?? c,
        c,
        v: num(r["volume"]) ?? 0,
      });
    }
    bars.sort((a, b) => a.t - b.t);
    return bars.slice(-limit);
  },

  async fundamentals(symbol: string, ctx: FetchCtx): Promise<Fundamentals> {
    const rows = arr(assertOk(await ctx.json(url(ctx, "profile", { symbol }))));
    const r = obj(rows[0]);
    if (!str(r["symbol"])) throw new ProviderError(ID, `no profile for ${symbol}`, 404, false);
    const price = num(r["price"]);
    const lastDividend = num(r["lastDividend"]);
    return {
      symbol,
      name: str(r["companyName"]),
      exchange: str(r["exchangeFullName"]) ?? str(r["exchange"]),
      sector: str(r["sector"]),
      industry: str(r["industry"]),
      currency: str(r["currency"]),
      marketCap: num(r["marketCap"]),
      // The profile row carries no P/E. Deriving one from marketCap and a net
      // income we do not have would be a fabricated ratio, so it stays null and
      // the registry can merge in a provider that actually reports it.
      peRatio: null,
      eps: null,
      beta: num(r["beta"]),
      dividendYield:
        lastDividend == null || price == null || price === 0 ? null : (lastDividend / price) * 100,
      sharesOutstanding: null,
      description: str(r["description"]),
    };
  },

  async news(symbols: string[], limit: number, ctx: FetchCtx): Promise<NewsItem[]> {
    const params: Record<string, string> = { limit: String(Math.min(250, Math.max(1, limit))) };
    if (symbols.length) params.symbols = symbols.join(",").toUpperCase();

    const rows = arr(assertOk(await ctx.json(url(ctx, "news/stock", params))));
    return rows
      .map((row): NewsItem | null => {
        const n = obj(row);
        const url_ = str(n["url"]);
        const title = str(n["title"]);
        if (!url_ || !title) return null;
        const symbol = str(n["symbol"]);
        return {
          id: url_,
          title,
          url: url_,
          source: str(n["publisher"]) ?? str(n["site"]) ?? "FMP",
          publishedAt: isoOrNow(n["publishedDate"]),
          summary: str(n["text"])?.slice(0, 400) ?? null,
          tickers: symbol ? [symbol.toUpperCase()] : [],
          sentiment: null,
        };
      })
      .filter((n): n is NewsItem => n !== null);
  },
};
