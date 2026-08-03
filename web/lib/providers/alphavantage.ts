/**
 * Alpha Vantage — quotes, bars, fundamentals, news with sentiment.
 *
 * The one thing to know about this vendor: **it reports failure with HTTP 200.**
 * An exhausted quota, a bad key and an unknown symbol all come back as a
 * well-formed JSON object with a `Note` / `Information` / `Error Message` key
 * and a success status line. Code that checks `res.ok` and then reads
 * `json["Global Quote"]` gets `undefined`, coerces to `NaN`, and renders a chart
 * with a missing point — the failure arrives as data. `assertOk` below is the
 * only reason this adapter is trustworthy, and it runs before any field access.
 *
 * Ranked last for every capability it shares with another provider: 25 calls a
 * day is a fallback tier by arithmetic, whatever the data quality.
 */

import { arr, iso, isoOrNow, num, obj, pctChange, str } from "./parse";
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

const ID = "alphavantage";

/** Throws on the 200-OK error envelopes before any field is read. */
function assertOk(payload: unknown): Record<string, unknown> {
  const o = obj(payload);
  const note = str(o["Note"]) ?? str(o["Information"]);
  if (note) {
    // Their quota message is prose, not a code. Matching on "rate limit" is
    // fragile, so we treat every advisory as fatal-for-this-call and let the
    // registry fail over — a wrong guess costs one failover, not a wrong number.
    throw new ProviderError(ID, note.slice(0, 180), 429, false);
  }
  const err = str(o["Error Message"]);
  if (err) throw new ProviderError(ID, err.slice(0, 180), 400, false);
  return o;
}

function query(ctx: FetchCtx, params: Record<string, string>): string {
  const q = new URLSearchParams({ ...params, apikey: ctx.key });
  return `${ctx.baseUrl}/query?${q}`;
}

/** App interval → Alpha Vantage function + interval. */
function series(interval: string): { fn: string; interval?: string; key: string } {
  switch (interval) {
    case "1d":
      return { fn: "TIME_SERIES_DAILY", key: "Time Series (Daily)" };
    case "1h":
      return { fn: "TIME_SERIES_INTRADAY", interval: "60min", key: "Time Series (60min)" };
    case "15m":
      return { fn: "TIME_SERIES_INTRADAY", interval: "15min", key: "Time Series (15min)" };
    default:
      // 4h has no Alpha Vantage equivalent. Resampling 60min bars here would be
      // silently lossy across session boundaries, so we decline and let the
      // registry route to a provider that serves the interval natively.
      throw new ProviderError(ID, `interval ${interval} not offered`, 400, false);
  }
}

export const alphavantage: Adapter = {
  meta: {
    id: ID,
    label: "Alpha Vantage",
    docs: "https://www.alphavantage.co/documentation/",
    capabilities: ["quote", "bars", "fundamentals", "news"],
    assets: ["equity", "crypto", "fx"],
    keyEnv: "ALPHAVANTAGE_API_KEY",
    baseUrlEnv: "ALPHAVANTAGE_BASE_URL",
    quota: { calls: 25, window: "day", reserve: 0.4 },
    // A 40% reserve on 25 calls leaves 10 for a person. Higher than the others
    // because the allowance is so small that a single auto-refreshing panel
    // would otherwise own the whole day.
    rank: { quote: 5, bars: 5, fundamentals: 3, news: 2 },
    signup: "Free key at alphavantage.co/support/#api-key — 25 requests/day.",
  },

  async quote(symbol: string, _asset: AssetClass, ctx: FetchCtx): Promise<Quote> {
    const o = assertOk(await ctx.json(query(ctx, { function: "GLOBAL_QUOTE", symbol })));
    const g = obj(o["Global Quote"]);
    const price = num(g["05. price"]);
    if (price == null) {
      throw new ProviderError(ID, `no quote for ${symbol}`, 404, false);
    }
    const prevClose = num(g["08. previous close"]);
    return {
      symbol: str(g["01. symbol"]) ?? symbol,
      price,
      change: num(g["09. change"]),
      changePct: num(g["10. change percent"]) ?? pctChange(price, prevClose),
      open: num(g["02. open"]),
      high: num(g["03. high"]),
      low: num(g["04. low"]),
      prevClose,
      volume: num(g["06. volume"]),
      currency: "USD",
      // `latest trading day` is a date, so an intraday quote stamps to midnight.
      // That is the vendor's actual resolution and we do not invent precision.
      asOf: isoOrNow(g["07. latest trading day"]),
      delayed: true,
    };
  },

  async bars(
    symbol: string,
    _asset: AssetClass,
    interval: string,
    limit: number,
    ctx: FetchCtx,
  ): Promise<OhlcvBar[]> {
    const spec = series(interval);
    const params: Record<string, string> = {
      function: spec.fn,
      symbol,
      outputsize: limit > 100 ? "full" : "compact",
    };
    if (spec.interval) params.interval = spec.interval;

    const o = assertOk(await ctx.json(query(ctx, params)));
    const table = obj(o[spec.key]);
    const bars: OhlcvBar[] = [];
    for (const [stamp, row] of Object.entries(table)) {
      const r = obj(row);
      const t = iso(stamp);
      const c = num(r["4. close"]);
      if (t == null || c == null) continue;
      bars.push({
        t: Date.parse(t),
        o: num(r["1. open"]) ?? c,
        h: num(r["2. high"]) ?? c,
        l: num(r["3. low"]) ?? c,
        c,
        v: num(r["5. volume"]) ?? 0,
      });
    }
    // The vendor returns newest-first; every consumer here assumes ascending.
    bars.sort((a, b) => a.t - b.t);
    return bars.slice(-limit);
  },

  async fundamentals(symbol: string, ctx: FetchCtx): Promise<Fundamentals> {
    const o = assertOk(await ctx.json(query(ctx, { function: "OVERVIEW", symbol })));
    if (!str(o["Symbol"])) throw new ProviderError(ID, `no profile for ${symbol}`, 404, false);
    return {
      symbol,
      name: str(o["Name"]),
      exchange: str(o["Exchange"]),
      sector: str(o["Sector"]),
      industry: str(o["Industry"]),
      currency: str(o["Currency"]),
      marketCap: num(o["MarketCapitalization"]),
      peRatio: num(o["PERatio"]),
      eps: num(o["EPS"]),
      beta: num(o["Beta"]),
      // Sent as a fraction (0.0052); every other provider here sends percent.
      dividendYield: (() => {
        const y = num(o["DividendYield"]);
        return y == null ? null : y * 100;
      })(),
      sharesOutstanding: num(o["SharesOutstanding"]),
      description: str(o["Description"]),
    };
  },

  async news(symbols: string[], limit: number, ctx: FetchCtx): Promise<NewsItem[]> {
    const params: Record<string, string> = {
      function: "NEWS_SENTIMENT",
      limit: String(Math.min(1000, Math.max(1, limit))),
    };
    if (symbols.length) params.tickers = symbols.join(",");

    const o = assertOk(await ctx.json(query(ctx, params)));
    return arr(o["feed"])
      .map((item): NewsItem | null => {
        const n = obj(item);
        const url = str(n["url"]);
        const title = str(n["title"]);
        if (!url || !title) return null;
        return {
          id: url,
          title,
          url,
          source: str(n["source"]) ?? "Alpha Vantage",
          publishedAt: isoOrNow(n["time_published"]),
          summary: str(n["summary"]),
          tickers: arr(n["ticker_sentiment"])
            .map((t) => str(obj(t)["ticker"]))
            .filter((t): t is string => Boolean(t)),
          sentiment: num(n["overall_sentiment_score"]),
        };
      })
      .filter((n): n is NewsItem => n !== null)
      .slice(0, limit);
  },
};
