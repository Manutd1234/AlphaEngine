/**
 * Massive (formerly Polygon.io) — aggregates, reference data and news.
 *
 * Rebranded from Polygon.io in October 2025; `api.polygon.io` still resolves and
 * the payload shapes are unchanged, so `MASSIVE_BASE_URL` lets an existing
 * Polygon deployment point at the legacy host without touching code.
 *
 * Ranked first for equity bars: the aggregates endpoint is the only one in this
 * registry that serves true minute/hour bars over a long history in a single
 * call. The free tier is 5 calls/minute and end-of-day only, which is why the
 * quota window here is per-minute — a burst limit needs a burst-shaped budget,
 * and a daily counter would let five parallel requests sail through and collect
 * five 429s.
 *
 * Quotes come from `/prev` rather than the snapshot endpoint: snapshots are a
 * paid entitlement, and an adapter that 403s on its primary path is worse than
 * one that answers with an honest previous close and says `delayed: true`.
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

const ID = "massive";

function assertOk(payload: unknown): Record<string, unknown> {
  const o = obj(payload);
  if (str(o["status"]) === "ERROR" || str(o["status"]) === "NOT_AUTHORIZED") {
    throw new ProviderError(ID, str(o["error"]) ?? str(o["message"]) ?? "error", 403, false);
  }
  return o;
}

function auth(ctx: FetchCtx): RequestInit {
  // Bearer rather than `?apiKey=`, so the credential is not in the request line.
  return { headers: { Authorization: `Bearer ${ctx.key}` } };
}

/** Crypto tickers are namespaced: BTCUSDT → X:BTCUSD. */
function ticker(symbol: string, asset: AssetClass): string {
  if (asset !== "crypto") return symbol.toUpperCase();
  const s = symbol.toUpperCase();
  return `X:${s.endsWith("USDT") ? `${s.slice(0, -4)}USD` : s}`;
}

const MULTIPLIER: Record<string, { mult: number; span: string; ms: number }> = {
  "15m": { mult: 15, span: "minute", ms: 9e5 },
  "1h": { mult: 1, span: "hour", ms: 36e5 },
  "4h": { mult: 4, span: "hour", ms: 144e5 },
  "1d": { mult: 1, span: "day", ms: 864e5 },
};

export const massive: Adapter = {
  meta: {
    id: ID,
    label: "Massive",
    docs: "https://massive.com/docs",
    capabilities: ["quote", "bars", "news", "fundamentals"],
    assets: ["equity", "crypto", "fx"],
    keyEnv: "MASSIVE_API_KEY",
    baseUrlEnv: "MASSIVE_BASE_URL",
    // A burst cap, not a volume cap: 5/minute on the free tier.
    quota: { calls: 5, window: "minute", reserve: 0.2 },
    // bars shifted 1 -> 2 when Bybit was inserted at the head of the crypto
    // chain. Every bars rank below Bybit moved up by exactly one, so the
    // relative order of the equity chain is unchanged and Massive is still
    // first for equities. Renumbered rather than tied: `candidatesFor` sorts,
    // and equal ranks resolve by position in the ADAPTERS array — a keyed
    // vendor and a keyless venue silently swapping places based on an import
    // list is not a decision anyone would find later.
    rank: { quote: 3, bars: 2, news: 3, fundamentals: 2 },
    signup: "Free key at massive.com — 5 requests/minute, end-of-day data.",
  },

  async quote(symbol: string, asset: AssetClass, ctx: FetchCtx): Promise<Quote> {
    const t = ticker(symbol, asset);
    const o = assertOk(
      await ctx.json(`${ctx.baseUrl}/v2/aggs/ticker/${encodeURIComponent(t)}/prev?adjusted=true`, auth(ctx)),
    );
    const r = obj(arr(o["results"])[0]);
    const close = num(r["c"]);
    if (close == null) throw new ProviderError(ID, `no prior session for ${symbol}`, 404, false);
    const open = num(r["o"]);
    return {
      symbol: symbol.toUpperCase(),
      price: close,
      change: open == null ? null : close - open,
      changePct: pctChange(close, open),
      open,
      high: num(r["h"]),
      low: num(r["l"]),
      prevClose: null,
      volume: num(r["v"]),
      currency: "USD",
      asOf: isoOrNow(r["t"]),
      delayed: true,
    };
  },

  async bars(
    symbol: string,
    asset: AssetClass,
    interval: string,
    limit: number,
    ctx: FetchCtx,
  ): Promise<OhlcvBar[]> {
    const spec = MULTIPLIER[interval];
    if (!spec) throw new ProviderError(ID, `interval ${interval} not offered`, 400, false);

    // 2.2x the span for the same reason as Tiingo: calendar time is not bar
    // count once weekends and holidays are in play.
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - spec.ms * limit * 2.2).toISOString().slice(0, 10);
    const q = new URLSearchParams({
      adjusted: "true",
      sort: "asc",
      limit: String(Math.min(50_000, limit * 3)),
    });

    const o = assertOk(
      await ctx.json(
        `${ctx.baseUrl}/v2/aggs/ticker/${encodeURIComponent(ticker(symbol, asset))}` +
          `/range/${spec.mult}/${spec.span}/${from}/${to}?${q}`,
        auth(ctx),
      ),
    );

    const bars: OhlcvBar[] = [];
    for (const row of arr(o["results"])) {
      const r = obj(row);
      const t = num(r["t"]);
      const c = num(r["c"]);
      if (t == null || c == null) continue;
      bars.push({
        t,
        o: num(r["o"]) ?? c,
        h: num(r["h"]) ?? c,
        l: num(r["l"]) ?? c,
        c,
        v: num(r["v"]) ?? 0,
      });
    }
    return bars.slice(-limit);
  },

  async fundamentals(symbol: string, ctx: FetchCtx): Promise<Fundamentals> {
    const o = assertOk(
      await ctx.json(`${ctx.baseUrl}/v3/reference/tickers/${encodeURIComponent(symbol)}`, auth(ctx)),
    );
    const r = obj(o["results"]);
    if (!str(r["ticker"])) throw new ProviderError(ID, `no reference row for ${symbol}`, 404, false);
    return {
      symbol,
      name: str(r["name"]),
      exchange: str(r["primary_exchange"]),
      sector: str(r["sic_description"]),
      industry: str(r["sic_description"]),
      currency: str(r["currency_name"])?.toUpperCase() ?? null,
      marketCap: num(r["market_cap"]),
      // Reference data carries no valuation ratios; null rather than a
      // computed-from-nothing placeholder.
      peRatio: null,
      eps: null,
      beta: null,
      dividendYield: null,
      sharesOutstanding: num(r["share_class_shares_outstanding"]) ?? num(r["weighted_shares_outstanding"]),
      description: str(r["description"]),
    };
  },

  async news(symbols: string[], limit: number, ctx: FetchCtx): Promise<NewsItem[]> {
    const q = new URLSearchParams({ limit: String(Math.min(1_000, Math.max(1, limit))) });
    if (symbols.length) q.set("ticker", symbols[0].toUpperCase());

    const o = assertOk(await ctx.json(`${ctx.baseUrl}/v2/reference/news?${q}`, auth(ctx)));
    return arr(o["results"])
      .map((row): NewsItem | null => {
        const n = obj(row);
        const url = str(n["article_url"]);
        const title = str(n["title"]);
        if (!url || !title) return null;
        return {
          id: str(n["id"]) ?? url,
          title,
          url,
          source: str(obj(n["publisher"])["name"]) ?? "Massive",
          publishedAt: isoOrNow(n["published_utc"]),
          summary: str(n["description"]),
          tickers: arr(n["tickers"]).map(String),
          sentiment: null,
        };
      })
      .filter((n): n is NewsItem => n !== null);
  },
};

/** Exported for the tests: the ticker namespacing is easy to get wrong. */
export const _ticker = ticker;
export const _iso = iso;
