/**
 * Live market data — venue adapters and execution-cost maths.
 * ===========================================================
 *
 * A TypeScript port of Module A from the Python gateway
 * (`Part2_Infrastructure/modules/tca_engine.py`), reduced to what a serverless
 * function can actually do.
 *
 * What lives where, and why
 * -------------------------
 * A serverless function cannot hold a WebSocket subscription open between
 * invocations, so the *streaming* L2 book stays on the always-on gateway. What a
 * function does well is a **snapshot**: fetch each venue's REST order book,
 * merge the ladders, and price a target order across them. That is what these
 * routes serve, and it is genuinely live — every call hits the exchange.
 *
 * For tick-by-tick updates the browser connects straight to the exchanges'
 * public WebSocket feeds (see `lib/livebook.ts`), which needs no backend at all.
 *
 * The arithmetic is identical to the gateway's, so a slippage number from this
 * portal and one from the gateway agree.
 *
 * The what-if extras — `smartRoute`'s optional `opts` (venue include-list,
 * blended-slippage cap) and `passiveQuote` — are client-side presentation aids
 * with no Python counterpart. They narrow or annotate the same maths; they
 * route nothing, and the gateway's pre-trade gates remain the only authority
 * on what may be sent. With `opts` omitted the walk is the parity path.
 */

import { recordUpstream } from "./observability";

export type Side = "BUY" | "SELL";
export type VenueName = "BINANCE" | "BYBIT";

/** [price, size] — size is in base units. */
export type Level = [number, number];

export interface VenueBook {
  venue: VenueName;
  symbol: string;
  ok: boolean;
  error?: string;
  latencyMs: number;
  bids: Level[];
  asks: Level[];
  bestBid: number | null;
  bestAsk: number | null;
  mid: number | null;
  spreadBps: number | null;
  depthUsdBid: number;
  depthUsdAsk: number;
  imbalance: number | null;
}

export interface ExecutionEstimate {
  venue: string;
  fillable: boolean;
  filledNotional: number;
  filledQty: number;
  vwap: number | null;
  mid: number | null;
  slippageBps: number | null;
  levelsConsumed: number;
  worstPrice: number | null;
}

export interface RoutingLeg {
  venue: string;
  notional: number;
  qty: number;
  vwap: number;
  sharePct: number;
}

export interface TcaReport {
  symbol: string;
  side: Side;
  targetNotional: number;
  generatedAt: string;
  consolidatedMid: number | null;
  perVenue: ExecutionEstimate[];
  bestSingleVenue: string | null;
  smartRoute: RoutingLeg[];
  smartRouteVwap: number | null;
  smartRouteSlippageBps: number | null;
  savingVsWorstBps: number | null;
  savingVsWorstUsd: number | null;
  venuesOnline: string[];
  /** Cross-venue touch check. `null` when fewer than two venues answered. */
  dislocation: Dislocation | null;
}

/**
 * The state of the consolidated touch across venues.
 *
 * Reported even when nothing is crossed, which is the point: a detector that
 * returns nothing on the healthy case leaves a caller unable to tell "no
 * opportunity" from "the feed is down", and those demand opposite responses.
 */
export interface Dislocation {
  symbol: string;
  /** True only when one venue's bid is strictly above another's ask. */
  crossed: boolean;
  /** Venue showing the low offer. `null` unless crossed. */
  buyVenue: string | null;
  /** Venue showing the high bid. `null` unless crossed. */
  sellVenue: string | null;
  buyPrice: number | null;
  sellPrice: number | null;
  /** Gross edge before fees, per base unit. */
  edgeUsdPerUnit: number;
  edgeBps: number;
  /** The smaller of the two resting sizes — both legs have to fill. */
  executableSize: number;
  executableNotional: number;
  /** Gross edge on the executable size. Fees are not deducted; see `note`. */
  grossEdgeUsd: number;
  note: string;
}

export const SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "ADAUSDT",
  "DOGEUSDT",
  "AVAXUSDT",
  "LINKUSDT",
  "DOTUSDT",
  "LTCUSDT",
  "TRXUSDT",
] as const;

const BINANCE_HOSTS = ["https://api.binance.com", "https://data-api.binance.vision"];

/**
 * Bybit's primary and its documented alternate domain.
 *
 * Binance has had host failover since the beginning; Bybit had a single host,
 * and that asymmetry stayed invisible until the systems console started
 * measuring per-venue error rates. In production Bybit answers **HTTP 403** to
 * every request from the serverless region — a 100% error rate — while the same
 * call from a laptop succeeds in 62ms. One venue silently dropping out turns
 * "consolidated cross-venue depth" into single-venue depth, and the routing
 * numbers built on it into a single-venue quote wearing a cross-venue label.
 */
const BYBIT_HOSTS = ["https://api.bybit.com", "https://api.bytick.com"];

const FETCH_TIMEOUT_MS = 8_000;

/**
 * Which host in a list last answered, remembered per process.
 *
 * When a region is blocked the primary does not fail *sometimes* — it fails
 * every single time, so every request pays a full failed round trip before the
 * mirror answers. Measured in production that was a 50% error rate on Binance
 * and roughly double the latency on every depth, ticker and klines call.
 *
 * Starting from the last host that worked removes that. It is a *preference*,
 * not a pin: the loop still walks the whole list, so if the remembered host
 * starts failing the next one is tried and the memo is rewritten. Per-instance
 * and non-durable, exactly like the quota ledger — a cold start simply pays the
 * discovery cost once more.
 */
const preferredHost = new Map<string, number>();

function orderedHosts(key: string, hosts: readonly string[]): readonly string[] {
  const first = preferredHost.get(key) ?? 0;
  if (first === 0 || first >= hosts.length) return hosts;
  return [hosts[first], ...hosts.filter((_, i) => i !== first)];
}

function rememberHost(key: string, hosts: readonly string[], host: string): void {
  const index = hosts.indexOf(host);
  if (index >= 0) preferredHost.set(key, index);
}

/**
 * `venue` is reported to the telemetry kernel, not sent to the exchange.
 *
 * These two clients are the one part of the data plane the provider registry
 * does not sit in front of — `/api/depth` and `/api/tca` call them directly,
 * because an order-book snapshot has no failover story to tell. That makes this
 * function the only place their latency and failures can be observed, so it is
 * the place that reports them. The latency key is prefixed `venue:` to keep a
 * direct one-hop measurement out of the same percentile as a registry dispatch.
 */
async function getJson(url: string, revalidate = 0, venue: VenueName = "BINANCE"): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const startedAt = Date.now();
  const provider = venue.toLowerCase();
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      ...(revalidate > 0 ? { next: { revalidate } } : { cache: "no-store" }),
    });
    if (!res.ok) {
      recordUpstream({
        provider,
        url,
        status: res.status,
        ms: Date.now() - startedAt,
        ok: false,
        error: `HTTP ${res.status}`,
        latencyKey: `venue:${provider}`,
      });
      throw new Error(`HTTP ${res.status}`);
    }
    const payload = await res.json();
    recordUpstream({
      provider,
      url,
      status: res.status,
      ms: Date.now() - startedAt,
      ok: true,
      payload,
      latencyKey: `venue:${provider}`,
    });
    return payload;
  } catch (err) {
    // An HTTP error already reported above and is rethrown as a plain Error; a
    // transport failure never reached that branch. Distinguishing them here
    // keeps one failed request from appearing as two in the trace.
    if (!(err instanceof Error && /^HTTP \d+$/.test(err.message))) {
      recordUpstream({
        provider,
        url,
        status: null,
        ms: Date.now() - startedAt,
        ok: false,
        error: controller.signal.aborted ? `timed out after ${FETCH_TIMEOUT_MS}ms` : (err as Error).message,
        latencyKey: `venue:${provider}`,
      });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// --------------------------------------------------------------------------- //
// Book maths (identical semantics to the Python gateway)
// --------------------------------------------------------------------------- //
export function depthUsd(levels: Level[], depth = 20): number {
  return levels.slice(0, depth).reduce((acc, [p, q]) => acc + p * q, 0);
}

/** Default band for depth/imbalance measurement, in basis points either side of mid. */
export const DEPTH_BAND_BPS = 10;

/**
 * Notional resting within `bps` of mid.
 *
 * Counting "the top N levels" is not comparable across venues or symbols: N
 * levels of a merged two-venue book spans a far narrower price band than N
 * levels of one venue, and a fine-tick instrument packs more levels into the
 * same band than a coarse one. Depth inside a *price* band is invariant to both,
 * which is what makes bid-vs-ask and venue-vs-venue comparisons mean anything.
 */
export function depthWithinBps(
  levels: Level[],
  mid: number | null,
  side: "bid" | "ask",
  bps = DEPTH_BAND_BPS,
): number {
  if (!mid) return 0;
  const bound = side === "bid" ? mid * (1 - bps / 1e4) : mid * (1 + bps / 1e4);
  let total = 0;
  for (const [price, size] of levels) {
    if (side === "bid" ? price < bound : price > bound) break;
    total += price * size;
  }
  return total;
}

/** Depth imbalance inside the band: +1 all bid, -1 all ask, 0 balanced. */
export function bandImbalance(
  bids: Level[],
  asks: Level[],
  mid: number | null,
  bps = DEPTH_BAND_BPS,
): number | null {
  const b = depthWithinBps(bids, mid, "bid", bps);
  const a = depthWithinBps(asks, mid, "ask", bps);
  return b + a > 0 ? (b - a) / (b + a) : null;
}

export function spreadBps(bid: number | null, ask: number | null): number | null {
  if (!bid || !ask) return null;
  const mid = (bid + ask) / 2;
  return mid > 0 ? ((ask - bid) / mid) * 1e4 : null;
}

/**
 * Walk a ladder for `targetNotional` USD. A BUY consumes asks.
 *
 * Returns the volume-weighted average price actually achievable and the
 * slippage against mid in basis points — the number that decides whether a
 * signal's edge survives being executed.
 */
export function walkBook(
  levels: Level[],
  side: Side,
  targetNotional: number,
  mid: number | null,
  venue = "MERGED",
): ExecutionEstimate {
  let remaining = targetNotional;
  let filledNotional = 0;
  let filledQty = 0;
  let consumed = 0;
  let worst: number | null = null;

  for (const [price, size] of levels) {
    if (remaining <= 1e-9) break;
    const take = Math.min(price * size, remaining);
    if (take <= 0) continue;
    filledNotional += take;
    filledQty += take / price;
    remaining -= take;
    consumed += 1;
    worst = price;
  }

  const vwap = filledQty > 0 ? filledNotional / filledQty : null;
  let slippageBps: number | null = null;
  if (vwap && mid) {
    slippageBps = side === "BUY" ? ((vwap - mid) / mid) * 1e4 : ((mid - vwap) / mid) * 1e4;
  }

  return {
    venue,
    fillable: remaining <= 1e-6,
    filledNotional: Math.round(filledNotional * 100) / 100,
    filledQty,
    vwap,
    mid,
    slippageBps,
    levelsConsumed: consumed,
    worstPrice: worst,
  };
}

/**
 * Depth-weighted mid across venues.
 *
 * A single venue's mid is unstable when that venue is thin; weighting by
 * top-of-book depth gives a reference price that does not jump when one book
 * momentarily crosses.
 */
export function consolidatedMid(books: VenueBook[]): number | null {
  let num = 0;
  let den = 0;
  for (const b of books) {
    if (!b.mid) continue;
    const w = Math.max(1, depthUsd(b.bids, 5) + depthUsd(b.asks, 5));
    num += b.mid * w;
    den += w;
  }
  return den ? num / den : null;
}

/**
 * What-if constraints for the routing probe. Client-side presentation aids
 * with NO Python counterpart: they narrow or annotate the same maths, they
 * route nothing, and the gateway's pre-trade gates stay the only authority
 * on what may be sent.
 */
export interface SmartRouteOptions {
  /** Cap on BLENDED slippage vs `mid`, in bps. Needs a resolvable mid. */
  maxSlippageBps?: number;
  /** Include-list of venue names. Omitted = every book routes; [] = none. */
  venues?: string[];
  /** Reference price for the cap. Defaults to consolidatedMid(books). */
  mid?: number | null;
}

export interface SmartRouteResult {
  legs: RoutingLeg[];
  vwap: number | null;
  /** Sum of leg notionals — equals the request unless something stopped the walk. */
  filledNotional: number;
  /** Present only when filledNotional < requested. */
  cappedBy?: "slippage" | "liquidity";
}

/**
 * Greedy price-time allocation across the *merged* ladder.
 *
 * The consolidated book is every venue's levels sorted by price; walking it
 * yields the lowest achievable blended VWAP, and the per-venue split of that
 * walk is the routing instruction.
 *
 * With no `opts` the walk is the historical one, byte for byte — the Python
 * parity claim covers exactly that path. The slippage cap answers "what is
 * the largest notional routable with blended slippage ≤ cap": a boundary
 * level is partially consumed via the closed form (BUY, running notional N
 * and qty Q against bound vmax): t = p·(vmax·Q − N)/(p − vmax). A cap with
 * no resolvable mid routes nothing — enforcing a cap without a reference
 * price would be a lie.
 */
export function smartRoute(
  books: VenueBook[],
  side: Side,
  notional: number,
  opts?: SmartRouteOptions,
): SmartRouteResult {
  const usable = opts?.venues ? books.filter((b) => opts.venues!.includes(b.venue)) : books;

  const capActive = Number.isFinite(opts?.maxSlippageBps);
  let bound: number | null = null;
  if (capActive) {
    const mid = opts?.mid ?? consolidatedMid(usable);
    if (mid == null) return { legs: [], vwap: null, filledNotional: 0, cappedBy: "slippage" };
    const capFrac = (opts!.maxSlippageBps as number) / 1e4;
    bound = side === "BUY" ? mid * (1 + capFrac) : mid * (1 - capFrac);
  }

  const merged: Array<[number, number, string]> = [];
  for (const b of usable) {
    const levels = side === "BUY" ? b.asks : b.bids;
    for (const [p, q] of levels) merged.push([p, q, b.venue]);
  }
  merged.sort((a, z) => (side === "BUY" ? a[0] - z[0] : z[0] - a[0]));

  let remaining = notional;
  let runN = 0;
  let runQ = 0;
  let cappedBySlippage = false;
  const perVenue = new Map<string, { notional: number; qty: number }>();
  for (const [price, size, venue] of merged) {
    if (remaining <= 1e-9) break;
    let take = Math.min(price * size, remaining);
    if (bound != null) {
      const inside = side === "BUY" ? price <= bound : price >= bound;
      if (!inside) {
        // Partial take up to where the blend meets the bound; the ladder is
        // sorted, so every later level is worse and the walk ends here.
        const t = side === "BUY"
          ? (price * (bound * runQ - runN)) / (price - bound)
          : (price * (runN - bound * runQ)) / (bound - price);
        const allowed = Math.max(0, t);
        if (allowed < take) {
          take = allowed;
          cappedBySlippage = true;
        }
      }
    }
    if (take > 0) {
      const slot = perVenue.get(venue) ?? { notional: 0, qty: 0 };
      slot.notional += take;
      slot.qty += take / price;
      perVenue.set(venue, slot);
      runN += take;
      runQ += take / price;
      remaining -= take;
    }
    if (cappedBySlippage) break;
  }

  const totalNotional = [...perVenue.values()].reduce((a, v) => a + v.notional, 0);
  const totalQty = [...perVenue.values()].reduce((a, v) => a + v.qty, 0);
  const cappedBy: SmartRouteResult["cappedBy"] = remaining > 1e-6
    ? (cappedBySlippage ? "slippage" : "liquidity")
    : undefined;
  if (totalQty <= 0) {
    return { legs: [], vwap: null, filledNotional: 0, ...(cappedBy ? { cappedBy } : {}) };
  }

  const legs = [...perVenue.entries()]
    .sort((a, z) => z[1].notional - a[1].notional)
    .map(([venue, v]) => ({
      venue,
      notional: Math.round(v.notional * 100) / 100,
      qty: v.qty,
      vwap: v.notional / v.qty,
      sharePct: Math.round((v.notional / totalNotional) * 10000) / 100,
    }));

  return {
    legs,
    vwap: totalNotional / totalQty,
    filledNotional: Math.round(totalNotional * 100) / 100,
    ...(cappedBy ? { cappedBy } : {}),
  };
}

export interface PassiveQuote {
  venue: string;
  /** The touch you would join: best bid for a BUY, best ask for a SELL. */
  price: number;
  /** Half-spread earned vs mid IF the resting order fills. Positive = earned. */
  spreadCaptureBps: number | null;
}

/**
 * The passive alternative to crossing: join the touch and wait. No queue
 * position, no adverse-selection model, no fill guarantee — this is a price
 * "if filled", full stop, and the UI must say so beside it.
 */
export function passiveQuote(
  books: VenueBook[],
  side: Side,
  mid: number | null,
): PassiveQuote | null {
  let best: { venue: string; price: number } | null = null;
  for (const b of books) {
    const touch = side === "BUY" ? b.bids[0]?.[0] : b.asks[0]?.[0];
    if (touch == null) continue;
    if (!best || (side === "BUY" ? touch > best.price : touch < best.price)) {
      best = { venue: b.venue, price: touch };
    }
  }
  if (!best) return null;
  const spreadCaptureBps = mid
    ? (side === "BUY" ? ((mid - best.price) / mid) : ((best.price - mid) / mid)) * 1e4
    : null;
  return { venue: best.venue, price: best.price, spreadCaptureBps };
}

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

function failed(venue: VenueName, symbol: string, error: string, latencyMs: number): VenueBook {
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

// --------------------------------------------------------------------------- //
// Report
// --------------------------------------------------------------------------- //
/**
 * Is the consolidated book crossed?
 *
 * The routing engine already asks which single venue fills a given order best.
 * This asks a different question the same two books can answer for free: is one
 * venue's *bid* above another's *ask* right now — a price that cannot persist,
 * because it pays to buy on one and sell on the other simultaneously.
 *
 * Three things this refuses to do, each because the naive version misleads:
 *
 *  - **It will not call a single venue's own spread a dislocation.** If the same
 *    venue holds both the high bid and the low ask, that is a bid-ask spread,
 *    which every book has and none of which is free money.
 *  - **It sizes to `min(bid size, ask size)`, never the larger or the sum.**
 *    Both legs have to fill for the edge to be real, so the tradeable size is
 *    whichever leg runs out first.
 *  - **It reports gross, and says so.** Two taker fees and the transfer between
 *    venues routinely exceed a few basis points of edge. Presenting a gross
 *    number as profit is the single most common way this analysis lies.
 *
 * Mirrors `quant_risk.find_dislocation` in the Python gateway.
 */
export function findDislocation(books: VenueBook[], symbol: string): Dislocation | null {
  const live = books.filter((b) => b.ok && b.bestBid !== null && b.bestAsk !== null);
  if (live.length < 2) return null; // one venue cannot cross itself

  const topBid = live.reduce((a, b) => (b.bestBid! > a.bestBid! ? b : a));
  const topAsk = live.reduce((a, b) => (b.bestAsk! < a.bestAsk! ? b : a));

  const base = {
    symbol: symbol.toUpperCase(),
    buyVenue: null,
    sellVenue: null,
    buyPrice: null,
    sellPrice: null,
    edgeUsdPerUnit: 0,
    edgeBps: 0,
    executableSize: 0,
    executableNotional: 0,
    grossEdgeUsd: 0,
  };

  if (topBid.venue === topAsk.venue) {
    return {
      ...base,
      crossed: false,
      note: `${topBid.venue} holds both sides of the touch — that is its own spread, not a cross-venue dislocation.`,
    };
  }

  const bid = topBid.bestBid!;
  const ask = topAsk.bestAsk!;
  const mid = (bid + ask) / 2;

  if (bid <= ask || mid <= 0) {
    return {
      ...base,
      crossed: false,
      note: `Touch spans ${topAsk.venue} (ask) and ${topBid.venue} (bid) without crossing — the normal state of a working market.`,
    };
  }

  // Both legs must fill, so the size is whichever runs out first.
  const askSize = topAsk.asks[0]?.[1] ?? 0;
  const bidSize = topBid.bids[0]?.[1] ?? 0;
  const size = Math.min(askSize, bidSize);
  const edge = bid - ask;

  return {
    symbol: symbol.toUpperCase(),
    crossed: true,
    buyVenue: topAsk.venue,
    sellVenue: topBid.venue,
    buyPrice: ask,
    sellPrice: bid,
    edgeUsdPerUnit: edge,
    edgeBps: (edge / mid) * 1e4,
    executableSize: size,
    executableNotional: size * mid,
    grossEdgeUsd: edge * size,
    note: `Buy ${topAsk.venue} at ${ask}, sell ${topBid.venue} at ${bid}. Gross of fees — two taker legs and the transfer routinely cost more than this.`,
  };
}

export function buildTcaReport(
  symbol: string,
  side: Side,
  notional: number,
  books: VenueBook[],
): TcaReport {
  const live = books.filter((b) => b.ok && b.mid !== null);
  const cmid = consolidatedMid(live);

  const perVenue = live.map((b) =>
    walkBook(side === "BUY" ? b.asks : b.bids, side, notional, b.mid, b.venue),
  );
  const { legs, vwap } = smartRoute(live, side, notional);

  let blendedSlip: number | null = null;
  if (vwap && cmid) {
    blendedSlip = side === "BUY" ? ((vwap - cmid) / cmid) * 1e4 : ((cmid - vwap) / cmid) * 1e4;
  }

  const fillable = perVenue.filter((e) => e.fillable && e.vwap !== null);
  let bestSingleVenue: string | null = null;
  let savingBps: number | null = null;
  let savingUsd: number | null = null;

  if (fillable.length) {
    // Ties keep the FIRST element, matching Python's min()/max(). Written as
    // `a.vwap < b.vwap ? a : b` the later element wins a tie, so the two
    // implementations named different venues on the ~20% of probes that tie.
    const cmp = (a: ExecutionEstimate, b: ExecutionEstimate) =>
      side === "BUY" ? (b.vwap! < a.vwap! ? b : a) : b.vwap! > a.vwap! ? b : a;
    const inv = (a: ExecutionEstimate, b: ExecutionEstimate) =>
      side === "BUY" ? (b.vwap! > a.vwap! ? b : a) : b.vwap! < a.vwap! ? b : a;
    const best = fillable.reduce(cmp);
    const worst = fillable.reduce(inv);
    bestSingleVenue = best.venue;
    if (vwap && worst.vwap) {
      const diff = side === "BUY" ? worst.vwap - vwap : vwap - worst.vwap;
      savingBps = (diff / worst.vwap) * 1e4;
      savingUsd = (diff / worst.vwap) * notional;
    }
  }

  return {
    symbol: symbol.toUpperCase(),
    side,
    targetNotional: notional,
    generatedAt: new Date().toISOString(),
    consolidatedMid: cmid,
    perVenue,
    bestSingleVenue,
    smartRoute: legs,
    smartRouteVwap: vwap,
    smartRouteSlippageBps: blendedSlip,
    savingVsWorstBps: savingBps,
    savingVsWorstUsd: savingUsd,
    venuesOnline: live.map((b) => b.venue),
    dislocation: findDislocation(books, symbol),
  };
}
