/**
 * OHLCV loading for the serverless routes — the routing policy, not a fetcher.
 *
 * Upstream calls happen server-side rather than from the browser: it avoids
 * CORS entirely, keeps per-IP rate limits pooled at the function rather than
 * spread across users' networks, and lets Vercel's CDN cache identical
 * requests.
 *
 * Where the bars come from is decided by what the symbol is. Crypto pairs go
 * straight to Binance's public klines (`binance-klines.ts`); equities and FX go
 * through the multi-provider registry. If neither can answer we fall back to a
 * deterministic synthetic series so the portal still demonstrates the research
 * workflow, and every response says which one it used. Until this commit the
 * routing step did not exist, so three of the fifteen symbols on offer could
 * never return real prices at all — `loadBars` below records how.
 */

import { fetchBinanceKlines } from "./binance-klines";
import { fetchBybitKlines } from "./bybit-klines";
import { getBars } from "./providers/registry";
import { classify } from "./providers/symbols";
import type { Attempt } from "./providers/types";
import { mulberry32, seedFromString } from "./random";
import { Bar, BARS_PER_YEAR, type DataSource } from "./types";

/** Deterministic GBM with a regime shift, seeded off the symbol so the same
 *  request always reproduces the same series and results stay comparable. */
export function syntheticBars(symbol: string, interval: string, bars: number): Bar[] {
  const rand = mulberry32(seedFromString(symbol));
  const gauss = () => {
    const u = Math.max(rand(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };

  const anchor: Record<string, number> = {
    BTCUSDT: 68_000,
    ETHUSDT: 3_500,
    SOLUSDT: 160,
    BNBUSDT: 600,
    XRPUSDT: 0.6,
    ADAUSDT: 0.45,
    DOGEUSDT: 0.16,
    AVAXUSDT: 36,
    LINKUSDT: 18,
    DOTUSDT: 7,
    LTCUSDT: 85,
    TRXUSDT: 0.13,
  };
  const ann = BARS_PER_YEAR[interval] ?? 8760;
  const vol = 0.6 / Math.sqrt(ann);
  const drift = 0.25 / ann;

  const stepMs =
    { "15m": 9e5, "1h": 36e5, "4h": 144e5, "1d": 864e5 }[interval] ?? 36e5;
  // Quantised to the bar interval: raw Date.now() gave identical closes a
  // different dataHash on every run, breaking compareRuns for synthetic data.
  const now = Math.floor(Date.now() / stepMs) * stepMs;

  const out: Bar[] = [];
  let price = anchor[symbol.toUpperCase()] ?? 100;
  for (let i = 0; i < bars; i++) {
    const mu = i < bars / 2 ? drift : -drift * 0.6;
    const ret = gauss() * vol + mu + Math.sin(i / 90) * vol * 0.4;
    const open = price;
    price *= Math.exp(ret);
    const noise = Math.abs(gauss()) * vol * 0.5;
    out.push({
      t: now - (bars - i) * stepMs,
      o: open,
      h: price * (1 + noise),
      l: price * (1 - noise),
      c: price,
      v: 1e6 * (0.5 + rand()),
    });
  }
  return out;
}

/** The registry options `loadBars` passes straight through. */
type RegistryOptions = Parameters<typeof getBars>[3];

/**
 * The crypto venue chain, fastest origin first.
 *
 * Ordered by measured round trip to each venue's server clock, not by
 * preference or by which was integrated first — see the note on `loadBars`.
 * Exported so a test can assert the ORDER rather than merely that both venues
 * are present: the whole point of this change is which one is tried first, and
 * a reordering would otherwise be invisible to the suite.
 */
export interface CryptoVenue {
  source: DataSource;
  label: string;
  fetch: (symbol: string, interval: string, bars: number) => Promise<Bar[]>;
}

export const CRYPTO_VENUES: CryptoVenue[] = [
  { source: "bybit", label: "Bybit", fetch: fetchBybitKlines },
  { source: "binance", label: "Binance", fetch: fetchBinanceKlines },
];

export interface LoadedBars {
  bars: Bar[];
  source: DataSource;
  warnings: string[];
}

/**
 * Walk the crypto venue chain, first venue that answers wins.
 *
 * Split out of `loadBars` and given an injectable chain for one reason: the
 * fallback is otherwise impossible to test. Every symbol the application offers
 * is listed on both venues, so no real request can make Bybit decline and
 * Binance answer — which would leave the entire failover path unexercised until
 * the day it was needed. That is exactly the shape of the defects this codebase
 * keeps producing, and an untested fallback is worse than no fallback, because
 * it is a promise nobody has checked.
 *
 * It is not decorative. Bybit answered HTTP 403 to every serverless request for
 * months (see `venues.ts`), and 247 of Binance's USDT pairs are absent from
 * Bybit today — so both an outage and a coverage miss are live possibilities
 * the moment the symbol list grows past its current allowlist.
 */
export async function loadCryptoBars(
  symbol: string,
  interval: string,
  bars: number,
  chain: CryptoVenue[] = CRYPTO_VENUES,
): Promise<LoadedBars> {
  const attempts: string[] = [];
  for (const venue of chain) {
    try {
      const loaded = await venue.fetch(symbol, interval, bars);
      return {
        bars: loaded,
        source: venue.source,
        // The fallback is reported, never silent. A sweep that ran on Binance
        // because Bybit declined is a different measurement from one that ran
        // on Bybit — different venue, different book, different last price —
        // and a reader comparing two runs has to be able to see that.
        warnings: attempts.length
          ? [
              `${venue.label} served these bars after ${attempts.join("; ")}. `
                + `Prices are this venue's, so they will differ slightly from a run on the other.`,
            ]
          : [],
      };
    } catch (err) {
      attempts.push(`${venue.label} declined (${(err as Error).message})`);
    }
  }
  return fellBackToSynthetic(symbol, interval, bars, attempts.join("; "));
}

function fellBackToSynthetic(symbol: string, interval: string, bars: number, why: string): LoadedBars {
  return {
    bars: syntheticBars(symbol, interval, bars),
    source: "synthetic",
    warnings: [
      `Could not load live market data (${why}). ` +
        `This run uses a deterministic synthetic price series — the workflow is real, the prices are not.`,
    ],
  };
}

/**
 * Every provider that was asked and declined, in the words it used.
 *
 * `dispatch` attaches this to the error it throws precisely so the caller can
 * say "Alpha Vantage is not configured, FMP declined intraday" rather than
 * "unavailable". A missing API key and a rate limit are different problems with
 * different fixes, and collapsing them into one sentence means neither gets
 * fixed.
 */
function whyNoProvider(err: unknown): string {
  const attempts = (err as { attempts?: Attempt[] }).attempts;
  if (!attempts?.length) return err instanceof Error ? err.message : String(err);
  return attempts.map((a) => `${a.provider}: ${a.reason}${a.detail ? ` (${a.detail})` : ""}`).join("; ");
}

/**
 * OHLCV for a backtest, routed by what the symbol actually is.
 *
 * THE BUG THIS CLOSES
 *
 * This function used to call Binance's klines endpoint for every symbol, and
 * fall back to a synthetic random walk on failure. AAPL, NVDA and MSFT have
 * been selectable in the UI the whole time, and Binance cannot ever answer for
 * them, so those three always took the fallback: every equity backtest this
 * portal has ever run was computed on invented prices, while four configured
 * providers sat in the registry able to serve them.
 *
 * The label was honest — the result did say `synthetic` and the banner did
 * appear. What was wrong is the diagnosis. The fallback exists for
 * "region-blocked, rate-limited, offline preview", and it reported the outage
 * wording for what was a routing mistake, so the message a user got said the
 * market was unreachable rather than that the request had been sent somewhere
 * that could never answer it. A warning that misnames the cause is how a
 * fixable problem survives: nobody goes looking for a router in an outage.
 *
 * WHY CRYPTO STILL TAKES THE DIRECT PATH
 *
 * `fetchBinanceKlines` pages backwards until it has the full window; a backtest
 * asks for up to 2000 bars and the klines endpoint returns 1000 at a time. The
 * registry's binance adapter calls this same function, so routing crypto
 * through the façade would work — but it would also put crypto behind a shared
 * circuit breaker and a failover chain whose other members decline intraday
 * data, converting a transient quote-side failure into a synthetic backtest.
 * The façade earns its keep where there is genuinely more than one provider;
 * for crypto klines there is one, and it is this.
 *
 * WHY BYBIT IS TRIED FIRST
 *
 * Because it is measurably nearer, and for no other reason. Both venues front
 * their REST API with a CDN, so both handshakes terminate a millisecond and a
 * half away and look identical; a round trip to each venue's *server clock* —
 * which no edge can serve from cache — separates them:
 *
 *     api.bybit.com      origin   6.2 ms
 *     api.binance.com    origin  72.7 ms
 *
 * From the Vercel serverless region the same asymmetry measures ~8x (Bybit
 * 9-11 ms against Binance 77-90 ms over five consecutive production calls).
 * Every bar this application loads pays that difference once per page, and a
 * 5000-bar sweep is five pages.
 *
 * Binance is not removed, it is demoted. It remains the fallback because it is
 * the deeper venue with the longer history, and because a chain of two real
 * venues is what stops a single venue's bad afternoon from being served as a
 * synthetic random walk. The order is a latency preference, not a judgement
 * about data quality — and `source` reports which one actually answered, so a
 * reader is never left to infer it.
 *
 * The one thing this must never become is a silent substitution. Bybit and
 * Binance do not list identical pairs, and a symbol Bybit does not carry has to
 * fall through to Binance rather than return a short series that looks fine.
 */
export async function loadBars(
  symbol: string,
  interval: string,
  bars: number,
  /**
   * Forwarded to the registry. Exists so a test can supply an empty environment
   * and a scratch cache — without it the equity path's behaviour depends on
   * whichever API keys happen to be set on the machine running the suite, which
   * is the same as not testing it.
   */
  opts: RegistryOptions = {},
): Promise<LoadedBars> {
  if (classify(symbol) === "crypto") {
    return loadCryptoBars(symbol, interval, bars);
  }

  // Equities and FX: the multi-provider façade, which already carries quota
  // accounting, a circuit breaker, failover across four vendors and the
  // fatal/warn bar contract. Reused rather than reimplemented — a fifth ad-hoc
  // equity fetcher is how the first four stopped agreeing with each other.
  try {
    const sourced = await getBars(symbol, interval, bars, opts);
    const warnings: string[] = [];

    // A short window is a legitimate answer (young listing, small free tier),
    // but silently running a 2000-bar sweep on 250 bars changes every statistic
    // downstream, so it is said out loud rather than inferred from a chart.
    if (sourced.data.length < bars) {
      warnings.push(
        `${sourced.provenance.label} returned ${sourced.data.length} of the ${bars} bars requested — `
          + `every statistic below is measured on the shorter window.`,
      );
    }
    // End-of-day vendors are fine for a daily backtest and wrong for an
    // intraday one, and only the provenance knows which tier answered.
    if (sourced.provenance.delayed) {
      warnings.push(
        `${sourced.provenance.label} serves delayed or end-of-day data. `
          + `Treat the most recent bars as indicative rather than live.`,
      );
    }
    for (const violation of sourced.provenance.contract?.violations ?? []) {
      warnings.push(`Data contract — ${violation.check}: ${violation.message}`);
    }

    return {
      bars: sourced.data.map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })),
      source: sourced.provenance.provider as DataSource,
      warnings,
    };
  } catch (err) {
    return fellBackToSynthetic(symbol, interval, bars, whyNoProvider(err));
  }
}
