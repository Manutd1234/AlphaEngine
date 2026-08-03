/**
 * OpenBB — the aggregator, reached over HTTP because it is a Python library.
 *
 * OpenBB is not a hosted REST API like the other six. It is a Python package
 * that federates *other* vendors behind one schema (`obb.equity.price.quote`,
 * `obb.news.company`, `obb.equity.fundamental.*`). There is no endpoint for a
 * TypeScript process to call.
 *
 * Rather than reimplement its normalisation in TS — which would be a second,
 * silently diverging copy — the AlphaEngine FastAPI gateway hosts it and exposes
 * `/api/research/openbb/*`, and this adapter is a client for that. The Python
 * side is where OpenBB actually runs; see
 * `Part2_Infrastructure/modules/research.py`.
 *
 * The consequence worth stating: this provider's availability is our gateway's
 * availability, not OpenBB's. It is configured only when `OPENBB_API_URL` points
 * at a reachable gateway, and it is ranked mid-pack — valuable because it can
 * reach vendors we have not integrated directly, but it adds a network hop and a
 * process we own to the failure surface, so it should not sit in front of a
 * provider we can call in one hop.
 */

import { arr, iso, isoOrNow, num, obj, str } from "./parse";
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

const ID = "openbb";

function endpoint(ctx: FetchCtx, path: string, params: Record<string, string>): string {
  const base = ctx.baseUrl.replace(/\/+$/, "");
  return `${base}/api/research/openbb/${path}?${new URLSearchParams(params)}`;
}

function assertOk(payload: unknown): Record<string, unknown> {
  const o = obj(payload);
  // The gateway reports an OpenBB provider failure as {ok:false, error:"..."}
  // with HTTP 200, so that a missing downstream key is a *routing* signal here
  // rather than a 500 that the breaker would count against the gateway itself.
  if (o["ok"] === false) {
    throw new ProviderError(ID, str(o["error"]) ?? "openbb call failed", 424, false);
  }
  return o;
}

export const openbb: Adapter = {
  meta: {
    id: ID,
    label: "OpenBB",
    docs: "https://docs.openbb.co/platform",
    capabilities: ["quote", "bars", "news", "fundamentals"],
    assets: ["equity", "crypto", "fx"],
    // The URL is the credential: unset means the gateway is not deployed.
    keyEnv: "OPENBB_API_URL",
    baseUrlEnv: "OPENBB_API_URL",
    // Whatever OpenBB's downstream limits are, they are the downstream's. We do
    // not model a budget we cannot observe.
    quota: null,
    rank: { quote: 6, bars: 6, news: 5, fundamentals: 4 },
    signup: "Set OPENBB_API_URL to an AlphaEngine gateway running `pip install openbb`.",
  },

  async quote(symbol: string, asset: AssetClass, ctx: FetchCtx): Promise<Quote> {
    const o = assertOk(await ctx.json(endpoint(ctx, "quote", { symbol, asset })));
    const r = obj(o["data"]);
    const price = num(r["price"]);
    if (price == null) throw new ProviderError(ID, `no quote for ${symbol}`, 404, false);
    return {
      symbol: str(r["symbol"]) ?? symbol,
      price,
      change: num(r["change"]),
      changePct: num(r["change_percent"]),
      open: num(r["open"]),
      high: num(r["high"]),
      low: num(r["low"]),
      prevClose: num(r["prev_close"]),
      volume: num(r["volume"]),
      currency: str(r["currency"]) ?? "USD",
      asOf: isoOrNow(r["as_of"]),
      delayed: Boolean(r["delayed"]),
    };
  },

  async bars(
    symbol: string,
    asset: AssetClass,
    interval: string,
    limit: number,
    ctx: FetchCtx,
  ): Promise<OhlcvBar[]> {
    const o = assertOk(
      await ctx.json(endpoint(ctx, "bars", { symbol, asset, interval, limit: String(limit) })),
    );
    const bars: OhlcvBar[] = [];
    for (const row of arr(o["data"])) {
      const r = obj(row);
      const t = iso(r["date"] ?? r["t"]);
      const c = num(r["close"] ?? r["c"]);
      if (t == null || c == null) continue;
      bars.push({
        t: Date.parse(t),
        o: num(r["open"] ?? r["o"]) ?? c,
        h: num(r["high"] ?? r["h"]) ?? c,
        l: num(r["low"] ?? r["l"]) ?? c,
        c,
        v: num(r["volume"] ?? r["v"]) ?? 0,
      });
    }
    bars.sort((a, b) => a.t - b.t);
    return bars.slice(-limit);
  },

  async news(symbols: string[], limit: number, ctx: FetchCtx): Promise<NewsItem[]> {
    const o = assertOk(
      await ctx.json(
        endpoint(ctx, "news", { symbols: symbols.join(","), limit: String(limit) }),
      ),
    );
    return arr(o["data"])
      .map((row): NewsItem | null => {
        const n = obj(row);
        const url = str(n["url"]);
        const title = str(n["title"]);
        if (!url || !title) return null;
        return {
          id: url,
          title,
          url,
          source: str(n["source"]) ?? "OpenBB",
          publishedAt: isoOrNow(n["date"]),
          summary: str(n["text"]),
          tickers: arr(n["symbols"]).map(String),
          sentiment: num(n["sentiment"]),
        };
      })
      .filter((n): n is NewsItem => n !== null);
  },

  async fundamentals(symbol: string, ctx: FetchCtx): Promise<Fundamentals> {
    const o = assertOk(await ctx.json(endpoint(ctx, "fundamentals", { symbol })));
    const r = obj(o["data"]);
    return {
      symbol,
      name: str(r["name"]),
      exchange: str(r["exchange"]),
      sector: str(r["sector"]),
      industry: str(r["industry"]),
      currency: str(r["currency"]),
      marketCap: num(r["market_cap"]),
      peRatio: num(r["pe_ratio"]),
      eps: num(r["eps"]),
      beta: num(r["beta"]),
      dividendYield: num(r["dividend_yield"]),
      sharesOutstanding: num(r["shares_outstanding"]),
      description: str(r["description"]),
    };
  },
};
