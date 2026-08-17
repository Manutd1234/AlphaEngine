/**
 * Tiingo — IEX intraday quotes, EOD/intraday bars, crypto, and a deep news archive.
 *
 * The most useful of the free tiers here for price work: real IEX prints rather
 * than a delayed composite, and crypto alongside equities from one credential.
 * News is a paid add-on on most plans, so `news` is declared but expected to
 * 403 — the registry treats that as an ordinary failover, which is why the
 * capability is declared rather than omitted.
 *
 * Auth goes in the `Authorization: Token …` header rather than the query string,
 * so credentials never appear in a URL that could be logged by an intermediary.
 */

import { arr, iso, isoOrNow, num, obj, pctChange, str } from "./parse";
import { classify } from "./symbols";
import {
  Adapter,
  AssetClass,
  FetchCtx,
  NewsItem,
  OhlcvBar,
  ProviderError,
  Quote,
} from "./types";

const ID = "tiingo";

function auth(ctx: FetchCtx): RequestInit {
  return { headers: { Authorization: `Token ${ctx.key}` } };
}

/** `BTCUSDT` → `btcusd`: Tiingo names crypto pairs without the stablecoin `T`. */
function cryptoTicker(symbol: string): string {
  const s = symbol.toLowerCase();
  return s.endsWith("usdt") ? `${s.slice(0, -4)}usd` : s;
}

const RESAMPLE: Record<string, string> = {
  "15m": "15min",
  "1h": "1hour",
  "4h": "4hour",
  "1d": "1day",
};

/** How far back to ask for, so `limit` bars actually come back. */
function startDate(interval: string, limit: number): string {
  const stepMs = { "15m": 9e5, "1h": 36e5, "4h": 144e5, "1d": 864e5 }[interval] ?? 864e5;
  // 2.2x the span: weekends and holidays mean calendar time and bar count are
  // not the same thing for equities, and asking for exactly `limit` steps back
  // reliably returns short.
  const span = stepMs * limit * 2.2;
  return new Date(Date.now() - span).toISOString().slice(0, 10);
}

export const tiingo: Adapter = {
  meta: {
    id: ID,
    label: "Tiingo",
    docs: "https://www.tiingo.com/documentation/general/overview",
    capabilities: ["quote", "bars", "news"],
    assets: ["equity", "crypto"],
    keyEnv: "TIINGO_API_KEY",
    baseUrlEnv: "TIINGO_BASE_URL",
    quota: { calls: 1_000, window: "day", reserve: 0.15 },
    // bars 2 -> 3: see the note in massive.ts. Relative order preserved.
    // news 1 -> 2 (2026-08-17): the free plan answers 403 for it, and OpenBB
    // now leads; a licensed key would still be asked before Alpha Vantage.
    rank: { quote: 2, bars: 3, news: 2 },
    signup: "Free key at tiingo.com — 1,000 requests/day, personal use.",
  },

  async quote(symbol: string, asset: AssetClass, ctx: FetchCtx): Promise<Quote> {
    if (asset === "crypto") {
      const ticker = cryptoTicker(symbol);
      const rows = arr(
        await ctx.json(
          `${ctx.baseUrl}/tiingo/crypto/top?tickers=${encodeURIComponent(ticker)}`,
          auth(ctx),
        ),
      );
      const top = obj(rows[0]);
      const book = obj(arr(top["topOfBookData"])[0]);
      const price = num(book["lastPrice"]) ?? num(book["midPrice"]);
      if (price == null) throw new ProviderError(ID, `no crypto quote for ${symbol}`, 404, false);
      return {
        symbol,
        price,
        change: null,
        changePct: null,
        open: null,
        high: null,
        low: null,
        prevClose: null,
        volume: num(book["lastSizeNotional"]),
        currency: (str(top["quoteCurrency"]) ?? "usd").toUpperCase(),
        asOf: isoOrNow(book["lastSaleTimestamp"] ?? book["quoteTimestamp"]),
        delayed: false,
      };
    }

    const rows = arr(
      await ctx.json(`${ctx.baseUrl}/iex/?tickers=${encodeURIComponent(symbol)}`, auth(ctx)),
    );
    const r = obj(rows[0]);
    // `last` is null outside market hours; `tngoLast` and `prevClose` are not.
    // Falling back in that order is what keeps a weekend lookup answerable.
    const price = num(r["last"]) ?? num(r["tngoLast"]) ?? num(r["prevClose"]);
    if (price == null) throw new ProviderError(ID, `no quote for ${symbol}`, 404, false);
    const prevClose = num(r["prevClose"]);
    return {
      symbol: (str(r["ticker"]) ?? symbol).toUpperCase(),
      price,
      change: prevClose == null ? null : price - prevClose,
      changePct: pctChange(price, prevClose),
      open: num(r["open"]),
      high: num(r["high"]),
      low: num(r["low"]),
      prevClose,
      volume: num(r["volume"]),
      currency: "USD",
      asOf: isoOrNow(r["timestamp"]),
      delayed: false,
    };
  },

  async bars(
    symbol: string,
    asset: AssetClass,
    interval: string,
    limit: number,
    ctx: FetchCtx,
  ): Promise<OhlcvBar[]> {
    const freq = RESAMPLE[interval];
    if (!freq) throw new ProviderError(ID, `interval ${interval} not offered`, 400, false);
    const from = startDate(interval, limit);

    let rows: unknown[];
    if (asset === "crypto") {
      const payload = arr(
        await ctx.json(
          `${ctx.baseUrl}/tiingo/crypto/prices?tickers=${encodeURIComponent(
            cryptoTicker(symbol),
          )}&resampleFreq=${freq}&startDate=${from}`,
          auth(ctx),
        ),
      );
      rows = arr(obj(payload[0])["priceData"]);
    } else if (interval === "1d") {
      rows = arr(
        await ctx.json(
          `${ctx.baseUrl}/tiingo/daily/${encodeURIComponent(symbol)}/prices?startDate=${from}`,
          auth(ctx),
        ),
      );
    } else {
      rows = arr(
        await ctx.json(
          `${ctx.baseUrl}/iex/${encodeURIComponent(
            symbol,
          )}/prices?resampleFreq=${freq}&startDate=${from}&columns=open,high,low,close,volume`,
          auth(ctx),
        ),
      );
    }

    const bars: OhlcvBar[] = [];
    for (const row of rows) {
      const r = obj(row);
      const t = iso(r["date"]);
      // adjClose exists only on the daily endpoint. Preferring it means the
      // series is split- and dividend-consistent, so a backtest across a split
      // does not see a 7:1 gap that never traded.
      const c = num(r["adjClose"]) ?? num(r["close"]);
      if (t == null || c == null) continue;
      const adjusted = num(r["adjClose"]) != null;
      bars.push({
        t: Date.parse(t),
        o: (adjusted ? num(r["adjOpen"]) : null) ?? num(r["open"]) ?? c,
        h: (adjusted ? num(r["adjHigh"]) : null) ?? num(r["high"]) ?? c,
        l: (adjusted ? num(r["adjLow"]) : null) ?? num(r["low"]) ?? c,
        c,
        v: (adjusted ? num(r["adjVolume"]) : null) ?? num(r["volume"]) ?? 0,
      });
    }
    bars.sort((a, b) => a.t - b.t);
    return bars.slice(-limit);
  },

  async news(symbols: string[], limit: number, ctx: FetchCtx): Promise<NewsItem[]> {
    const q = new URLSearchParams({ limit: String(Math.min(100, Math.max(1, limit))) });
    // The same spelling the quote and bars paths use for a pair: `btcusd`.
    if (symbols.length) {
      q.set("tickers", symbols.map((s) => (classify(s) === "crypto" ? cryptoTicker(s) : s.toLowerCase())).join(","));
    }

    const rows = arr(await ctx.json(`${ctx.baseUrl}/tiingo/news?${q}`, auth(ctx)));
    return rows
      .map((row): NewsItem | null => {
        const n = obj(row);
        const url = str(n["url"]);
        const title = str(n["title"]);
        if (!url || !title) return null;
        return {
          id: str(n["id"]) ?? url,
          title,
          url,
          source: str(n["source"]) ?? "Tiingo",
          publishedAt: isoOrNow(n["publishedDate"]),
          summary: str(n["description"]),
          tickers: arr(n["tickers"])
            .map((t) => str(t)?.toUpperCase())
            .filter((t): t is string => Boolean(t)),
          // Tiingo does not score sentiment. null, not 0 — a neutral score and
          // an absent score are different facts and must not render alike.
          sentiment: null,
        };
      })
      .filter((n): n is NewsItem => n !== null);
  },
};
