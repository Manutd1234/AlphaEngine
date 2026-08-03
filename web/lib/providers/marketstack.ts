/**
 * Marketstack — end-of-day and intraday OHLCV across 70+ global exchanges.
 *
 * Its reason to exist in this stack is coverage: the other price providers here
 * are US-centric, and Marketstack is the one that answers for a London or Tokyo
 * listing. Its cost is a 100-call **monthly** allowance on the free plan, which
 * is the single tightest budget in the registry — roughly three calls a day. It
 * is ranked last for bars for that reason and carries the largest reserve, so
 * automated polling can never be the thing that spends it.
 *
 * Two vendor quirks are handled explicitly:
 *
 *  - **Errors arrive as HTTP 200** with an `error` object in the body, same class
 *    of trap as Alpha Vantage.
 *  - **Free plans are HTTP-only.** We default to HTTPS and require an explicit
 *    `MARKETSTACK_BASE_URL=http://…` to opt down. Auto-downgrading transport
 *    inside a catch block would make a security decision on the operator's
 *    behalf, silently, in the failure path — exactly where nobody looks.
 */

import { arr, iso, isoOrNow, num, obj, pctChange, str } from "./parse";
import { Adapter, AssetClass, FetchCtx, OhlcvBar, ProviderError, Quote } from "./types";

const ID = "marketstack";

function assertOk(payload: unknown): Record<string, unknown> {
  const o = obj(payload);
  const err = obj(o["error"]);
  if (Object.keys(err).length) {
    const code = str(err["code"]) ?? "error";
    const message = str(err["message"]) ?? JSON.stringify(err).slice(0, 160);
    // usage_limit_reached is a monthly wall — retrying cannot help and would
    // only add latency to every subsequent failover.
    throw new ProviderError(ID, `${code}: ${message}`, code.includes("limit") ? 429 : 400, false);
  }
  return o;
}

function url(ctx: FetchCtx, path: string, params: Record<string, string>): string {
  const q = new URLSearchParams({ ...params, access_key: ctx.key });
  return `${ctx.baseUrl}/${path}?${q}`;
}

const INTRADAY: Record<string, string> = { "15m": "15min", "1h": "1hour", "4h": "3hour" };

export const marketstack: Adapter = {
  meta: {
    id: ID,
    label: "Marketstack",
    docs: "https://marketstack.com/documentation_v2",
    capabilities: ["quote", "bars"],
    assets: ["equity"],
    keyEnv: "MARKETSTACK_API_KEY",
    baseUrlEnv: "MARKETSTACK_BASE_URL",
    // 100 per *month*. Half is reserved: at three calls a day, an auto-refresh
    // loop that spent even the first half in a morning would leave nothing.
    quota: { calls: 100, window: "month", reserve: 0.5 },
    rank: { quote: 4, bars: 4 },
    signup: "Free key at marketstack.com — 100 requests/month, EOD only, HTTP-only transport.",
  },

  async quote(symbol: string, _asset: AssetClass, ctx: FetchCtx): Promise<Quote> {
    const o = assertOk(await ctx.json(url(ctx, "eod/latest", { symbols: symbol })));
    const r = obj(arr(o["data"])[0]);
    const close = num(r["close"]);
    if (close == null) throw new ProviderError(ID, `no EOD row for ${symbol}`, 404, false);
    const open = num(r["open"]);
    return {
      symbol: (str(r["symbol"]) ?? symbol).toUpperCase(),
      price: close,
      // No previous close on this endpoint. Intraday change from the session's
      // own open is a different quantity from close-over-prior-close and is
      // labelled as such rather than passed off as the day change.
      change: open == null ? null : close - open,
      changePct: pctChange(close, open),
      open,
      high: num(r["high"]),
      low: num(r["low"]),
      prevClose: null,
      volume: num(r["volume"]),
      currency: "USD",
      asOf: isoOrNow(r["date"]),
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
    const capped = Math.min(1_000, Math.max(1, limit));
    const path = interval === "1d" ? "eod" : "intraday";
    const params: Record<string, string> = { symbols: symbol, limit: String(capped) };
    if (path === "intraday") {
      const iv = INTRADAY[interval];
      if (!iv) throw new ProviderError(ID, `interval ${interval} not offered`, 400, false);
      params.interval = iv;
    }

    const o = assertOk(await ctx.json(url(ctx, path, params)));
    const bars: OhlcvBar[] = [];
    for (const row of arr(o["data"])) {
      const r = obj(row);
      const t = iso(r["date"]);
      const c = num(r["close"]);
      if (t == null || c == null) continue;
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
    return bars;
  },
};
