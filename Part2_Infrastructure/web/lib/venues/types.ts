import { HostPreference } from "../host-preference";
import { recordUpstream } from "../observability";
import { isApplicable } from "../providers/capabilities";
import { classify } from "../providers/symbols";
import type { AssetClass } from "../providers/types";
import { failed } from "./adapters";
import { spreadBps } from "./book-maths";
import { consolidatedMid, smartRoute } from "./fill-tolerance";

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

/**
 * The market paths the desk can honestly offer for one instrument.
 *
 * A provider quote, a direct venue book and a paper order are three different
 * capabilities. Treating them as one `liveSupported` flag made an equity with
 * a healthy REST quote and a working paper route look entirely offline merely
 * because Binance and Bybit do not carry its L2 book. Keep the distinctions in
 * one client-safe model so Execution and the pipeline inspector cannot make
 * different claims about the same symbol.
 */
export interface MarketCapabilities {
  asset: AssetClass;
  restQuote: boolean;
  directL2: boolean;
  paperMarketOrder: boolean;
}

export function marketCapabilitiesFor(symbol: string): MarketCapabilities {
  const normalised = symbol.trim().toUpperCase();
  const asset = classify(normalised);
  return {
    asset,
    restQuote: isApplicable("quote", asset),
    directL2: (SYMBOLS as readonly string[]).includes(normalised),
    paperMarketOrder: asset === "equity",
  };
}

export const BINANCE_HOSTS = ["https://api.binance.com", "https://data-api.binance.vision"];

/**
 * Bybit's primary and its documented alternate domain.
 *
 * Binance has had host failover since the beginning; Bybit had a single host,
 * and that asymmetry stayed invisible until the systems console started
 * measuring per-venue error rates. At that time Bybit answered **HTTP 403** to
 * every request from the serverless region — a 100% error rate — while the same
 * call from a laptop succeeded in 62ms. One venue silently dropping out turns
 * "consolidated cross-venue depth" into single-venue depth, and the routing
 * numbers built on it into a single-venue quote wearing a cross-venue label.
 *
 * THAT IS NO LONGER TRUE, and the correction is worth more than the deletion
 * would be. Re-measured against production over five consecutive calls, Bybit
 * answered every one — and answered faster than Binance every time:
 *
 *     BINANCE  ok  77-90 ms        BYBIT  ok  9-11 ms
 *
 * So the failover pair below is no longer the workaround it was written as; it
 * is ordinary redundancy on the venue that is now the nearer of the two. The
 * original finding is kept rather than overwritten because a fact that flipped
 * silently once can flip back, and a reader who sees only today's numbers has
 * no reason to keep checking. `lib/bybit-klines.ts` depends on this being true
 * and re-verifies it on every request rather than trusting this comment.
 */
export const BYBIT_HOSTS = ["https://api.bybit.com", "https://api.bytick.com"];

const FETCH_TIMEOUT_MS = 8_000;

/**
 * Which host last answered, per venue, remembered per process.
 *
 * This was the one piece of hidden mutable state in an otherwise pure module: a
 * bare `Map<string, number>` at file scope, keyed by a string the two call
 * sites in `adapters.ts` had to agree on by convention, with the host list
 * passed in separately on every call — so nothing stopped a lookup keyed
 * `"binance"` being resolved against `BYBIT_HOSTS`. `HostPreference` binds the
 * memo to the list it indexes at construction, which makes that unrepresentable
 * rather than merely unlikely, and the same class now backs the two klines
 * transports that had each grown their own copy of the reordering expression.
 */
const HOST_PREFERENCE: Record<VenueName, HostPreference> = {
  BINANCE: new HostPreference(BINANCE_HOSTS),
  BYBIT: new HostPreference(BYBIT_HOSTS),
};

/** The venue's host list, starting from whichever host last answered. */
export function orderedHosts(venue: VenueName): readonly string[] {
  return HOST_PREFERENCE[venue].ordered();
}

/** Record that `host` answered for `venue`. Ignored if it is not one of them. */
export function rememberHost(venue: VenueName, host: string): void {
  HOST_PREFERENCE[venue].remember(host);
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
export async function getJson(url: string, revalidate = 0, venue: VenueName = "BINANCE"): Promise<unknown> {
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
