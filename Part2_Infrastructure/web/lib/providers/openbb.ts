/**
 * OpenBB — the aggregator, reached through the independent Python service.
 *
 * OpenBB is not a hosted REST API like the other six. It is a Python package
 * that federates *other* vendors behind one schema (`obb.equity.price.quote`,
 * `obb.news.company`, `obb.equity.fundamental.*`). There is no endpoint for a
 * TypeScript process to call.
 *
 * Rather than reimplement its normalisation in TS — which would be a second,
 * silently diverging copy — the standalone OpenBB service exposes
 * `/api/research/openbb/*`, and this adapter is its client. The Python side is
 * where the OpenBB provider actually runs; see `OpenBB_Service/`.
 *
 * The consequence worth stating: this provider's availability is the service's
 * availability, not a shared portfolio gateway's. It is configured only when
 * `OPENBB_API_URL` points at that service, and it is ranked mid-pack — valuable because it can
 * reach vendors we have not integrated directly, but it adds a network hop and a
 * process we own to the failure surface, so it should not sit in front of a
 * provider we can call in one hop.
 */

import { arr, iso, isoOrNow, num, obj, str } from "./parse";
import { classify } from "./symbols";
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

function serviceRequest(ctx: FetchCtx, path: string, params: Record<string, string>): Promise<unknown> {
  // OpenBB is an independent, read-only market-data service. Never reuse the
  // portfolio gateway credential for it; each service has its own trust scope.
  const token = process.env.OPENBB_API_TOKEN?.trim();
  return ctx.json(endpoint(ctx, path, params), {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
}

function assertOk(payload: unknown): Record<string, unknown> {
  const o = obj(payload);
  // The service reports an OpenBB provider failure as {ok:false, error:"..."}
  // with HTTP 200, so that a missing downstream key is a *routing* signal here
  // rather than a 500 that the breaker would count against the service itself.
  if (o["ok"] === false) {
    const message = str(o["error"]) ?? "openbb call failed";
    // The service folds two different things into `ok:false`: a downstream
    // provider that timed out or is temporarily unavailable (the service's own
    // words, in provider.py) — a real failure worth the breaker — and "no
    // fundamentals / no news for this symbol", which is an answer. The words
    // are the only signal, so they are read here rather than guessed at by
    // status.
    const kind = /timed out|temporarily unavailable/i.test(message) ? "failed" : "no_data";
    throw new ProviderError(ID, message, 424, false, kind);
  }
  return o;
}

export const openbb: Adapter = {
  meta: {
    id: ID,
    label: "OpenBB",
    docs: "https://docs.openbb.co/platform",
    capabilities: ["quote", "bars", "news", "fundamentals"],
    assets: ["equity", "crypto"],
    // The URL is the configuration signal: unset means the service is not deployed.
    keyEnv: "OPENBB_API_URL",
    baseUrlEnv: "OPENBB_API_URL",
    // Whatever OpenBB's downstream limits are, they are the downstream's. We do
    // not model a budget we cannot observe.
    quota: null,
    // News first, measured on 2026-08-17: on the desk's keys Tiingo answers
    // 403 and FMP 402 (news is not in either plan), Massive documents news
    // for equities only, and Alpha Vantage — the one that does answer — has
    // twenty-five calls a day for every capability it backs. YFinance news
    // through this service is free, uncapped, and serves a pair as BTC-USD.
    // Alpha Vantage stays behind it as the fallback that carries sentiment.
    rank: { quote: 6, bars: 6, news: 1, fundamentals: 4 },
    signup: "Deploy OpenBB_Service and set OPENBB_API_URL to its stable HTTPS origin.",
  },

  async quote(symbol: string, asset: AssetClass, ctx: FetchCtx): Promise<Quote> {
    const o = assertOk(await serviceRequest(ctx, "quote", { symbol, asset }));
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
      await serviceRequest(ctx, "bars", { symbol, asset, interval, limit: String(limit) }),
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
    // The service maps a crypto pair to YFinance's `BTC-USD` only when told
    // the asset class; a bare `BTCUSDT` reaches Yahoo verbatim and finds
    // nothing.
    const asset = symbols.length ? classify(symbols[0]) : "equity";
    const o = assertOk(
      await serviceRequest(ctx, "news", { symbols: symbols.join(","), limit: String(limit), asset }),
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
    const o = assertOk(await serviceRequest(ctx, "fundamentals", { symbol }));
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
