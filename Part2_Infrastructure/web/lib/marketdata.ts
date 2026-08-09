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

export interface LoadedBars {
  bars: Bar[];
  source: DataSource;
  warnings: string[];
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
    try {
      return { bars: await fetchBinanceKlines(symbol, interval, bars), source: "binance", warnings: [] };
    } catch (err) {
      return fellBackToSynthetic(symbol, interval, bars, (err as Error).message);
    }
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
