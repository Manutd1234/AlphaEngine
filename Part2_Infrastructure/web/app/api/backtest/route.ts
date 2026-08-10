import { NextRequest, NextResponse } from "next/server";

import { runSweep } from "@/lib/engine";
import { loadBars } from "@/lib/marketdata";
import { seedFromString } from "@/lib/random";
import { type Bar, DEFAULT_REQUEST, INTERVALS, STRATEGY_LABELS, SweepRequest } from "@/lib/types";
import { APP_COMMIT } from "@/lib/version";

export const runtime = "nodejs";
// No `maxDuration` override. A 74-combination sweep over 2000 bars runs in ~20ms,
// so nothing here needs an extended budget — and a value above the account's
// plan limit is rejected at build time, which is a deployment failure that
// cannot be reproduced locally.

/**
 * Derived from the label map, never listed again.
 *
 * This was a hand-written set of three, and it stayed three while the engines
 * grew to twenty-six. Every strategy added after the first three was accepted
 * by the UI, computed correctly by both engines, and then silently replaced
 * with `ma_cross` here on the way in — twenty-three of twenty-six, coerced at
 * the door. The bug was invisible because the coercion is by design: an
 * unrecognised strategy falls back rather than 400s, so a stale whitelist looks
 * exactly like a client sending nonsense.
 *
 * `STRATEGY_LABELS` is a `Record<Strategy, string>`, so its keys ARE the union
 * at runtime. Deriving from it means the two cannot drift again — there is no
 * second list to forget.
 */
const STRATEGIES = new Set(Object.keys(STRATEGY_LABELS));

// Equity symbols may carry a class suffix (BRK.B) and short tickers must not
// silently fall back to BTCUSDT. `loadBars` routes on asset class, so an equity
// reaches the equity providers and only falls back to a labelled synthetic
// series when none of them can answer.
const SYMBOL_RE = /^[A-Z0-9.\-]{1,20}$/;

function clamp(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

function clampFloat(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

function benchmarkOf(raw: unknown, symbol: string): string | undefined {
  const candidate = String(raw ?? "").trim().toUpperCase();
  if (!candidate || candidate === symbol) return undefined;
  return SYMBOL_RE.test(candidate) ? candidate : undefined;
}

/** Never trust the client with grid bounds — an unbounded sweep is a free way to
 *  burn the function's whole time budget. */
function sanitise(body: Partial<SweepRequest>): SweepRequest {
  const symbol = String(body.symbol ?? DEFAULT_REQUEST.symbol).toUpperCase();
  const interval = String(body.interval ?? DEFAULT_REQUEST.interval);
  const strategy = String(body.strategy ?? DEFAULT_REQUEST.strategy);

  const fastMin = clamp(body.fastMin, 2, 400, DEFAULT_REQUEST.fastMin);
  const fastMax = Math.max(fastMin + 1, clamp(body.fastMax, 3, 400, DEFAULT_REQUEST.fastMax));
  const slowMin = clamp(body.slowMin, 3, 800, DEFAULT_REQUEST.slowMin);
  const slowMax = Math.max(slowMin + 1, clamp(body.slowMax, 4, 800, DEFAULT_REQUEST.slowMax));

  return {
    symbol: SYMBOL_RE.test(symbol) ? symbol : DEFAULT_REQUEST.symbol,
    interval: (INTERVALS as readonly string[]).includes(interval) ? interval : DEFAULT_REQUEST.interval,
    bars: clamp(body.bars, 300, 5000, DEFAULT_REQUEST.bars),
    strategy: (STRATEGIES.has(strategy) ? strategy : DEFAULT_REQUEST.strategy) as SweepRequest["strategy"],
    fastMin,
    fastMax,
    fastStep: clamp(body.fastStep, 1, 100, DEFAULT_REQUEST.fastStep),
    slowMin,
    slowMax,
    slowStep: clamp(body.slowStep, 1, 200, DEFAULT_REQUEST.slowStep),
    feeBps: clampFloat(body.feeBps, 0, 100, DEFAULT_REQUEST.feeBps),
    slippageBps: clampFloat(body.slippageBps, 0, 100, DEFAULT_REQUEST.slippageBps),
    direction: body.direction === "long_short" ? "long_short" : "long_only",
    folds: clamp(body.folds, 2, 10, DEFAULT_REQUEST.folds),
    walkForward: body.walkForward !== false,

    // Absent, blank and "same as the traded symbol" all mean no comparison.
    // The third is the one worth catching here rather than downstream: a
    // regression of a series on itself has a beta of exactly 1, an R² of 1 and
    // an alpha of 0, which is a perfectly well-formed way of saying nothing.
    benchmarkSymbol: benchmarkOf(body.benchmarkSymbol, symbol),

    // Microstructure frictions. Every one defaults to 0, which is what keeps an
    // unconfigured request arithmetically identical to the Python reference —
    // `clampFloat` returns the fallback for absent, non-numeric and non-finite
    // input alike, so a client that omits the whole group cannot accidentally
    // enable it. The upper bounds are deliberately generous: a researcher
    // stress-testing a strategy at an absurd participation rate is doing the
    // right thing, and the UI labels the result as a model either way.
    impactCoefficient: clampFloat(body.impactCoefficient, 0, 1, 0),
    orderNotional: clampFloat(body.orderNotional, 0, 1e10, 0),
    fundingBpsPer8h: clampFloat(body.fundingBpsPer8h, -50, 50, 0),
    borrowBpsAnnual: clampFloat(body.borrowBpsAnnual, 0, 5000, 0),
  };
}

/**
 * The engine's floor, restated here so the failure can name its own cause.
 *
 * `runSweep` throws `Not enough data: 3 bars.` and the route used to return that
 * verbatim. It is a true sentence that helps nobody: it reports the symptom
 * (three bars) without the cause (this vendor has almost no intraday history
 * for equities) or the fix (ask for daily). A reader sees a broken app rather
 * than a data limit they can work around in one click.
 *
 * That is the same failure the equity routing bug had — a message that named
 * the wrong thing, so a fixable problem looked like an outage. Kept in step
 * with `engine.ts` by `backtest-route.test.ts`, which reads both literals.
 */
const MIN_BARS = 200;

/** Daily is only a suggestion when the caller was not already asking for it. */
function interval1dWouldHelp(interval: string): boolean {
  return interval !== "1d";
}

/**
 * Why a window came back too short, in terms the reader can act on.
 *
 * Deliberately specific about the equity-intraday case, because that is the one
 * a user hits by changing a dropdown and cannot otherwise diagnose: MSFT serves
 * 400 daily bars and 6 four-hourly ones from the same provider on the same key.
 */
function explainShortWindow(
  symbol: string,
  interval: string,
  source: string,
  got: number,
  asked: number,
): string {
  const head =
    `${symbol} · ${interval} returned only ${got} bars from ${source}, and a sweep needs at least ${MIN_BARS}.`;

  if (source === "synthetic") {
    return `${head} No provider could serve this symbol, so nothing was measured.`;
  }
  if (interval !== "1d") {
    // The actionable half. Free equity tiers carry a few days of intraday
    // history and years of daily, so the same symbol works immediately one
    // control away — which the old message gave no way to discover.
    return `${head} Free equity tiers keep only a few days of intraday history `
      + `but years of daily. Switch Interval to 1d for this symbol, or trade a crypto pair, `
      + `which streams full intraday history from the venue.`;
  }
  return `${head} Ask for fewer bars, or pick a symbol with a longer listing history.`;
}

export async function POST(request: NextRequest) {
  try {
    const req = sanitise((await request.json()) as Partial<SweepRequest>);
    const { bars, source, warnings } = await loadBars(req.symbol, req.interval, req.bars);

    // Checked here rather than left to the engine's throw, because this is the
    // only layer that knows WHICH provider answered and what was asked for.
    // 422 rather than 400: the request was well-formed and the data was not
    // there, and a client cannot fix a 400 by retrying with a different symbol.
    if (bars.length < MIN_BARS) {
      return NextResponse.json(
        {
          error: explainShortWindow(req.symbol, req.interval, source, bars.length, req.bars),
          symbol: req.symbol,
          interval: req.interval,
          source,
          barsReturned: bars.length,
          barsRequired: MIN_BARS,
          // The interval that would work, so the UI can offer it as an action
          // rather than asking the reader to infer it from prose.
          suggestedInterval: interval1dWouldHelp(req.interval) ? "1d" : null,
          warnings,
        },
        { status: 422 },
      );
    }

    // The benchmark is loaded through the same routing as the traded symbol, so
    // an index ETF needs no special case and a benchmark that cannot be served
    // degrades the same way the primary does — with a stated reason rather than
    // a missing panel.
    let benchmarkBars: Bar[] | null = null;
    if (req.benchmarkSymbol) {
      const loaded = await loadBars(req.benchmarkSymbol, req.interval, req.bars);
      if (loaded.source === "synthetic") {
        // A synthetic benchmark would produce an alpha against a random walk,
        // which is worse than no alpha: it is a number that looks measured.
        warnings.push(
          `Benchmark ${req.benchmarkSymbol} could not be loaded, so no alpha or beta was computed. `
            + loaded.warnings.join(" "),
        );
      } else {
        benchmarkBars = loaded.bars;
        warnings.push(...loaded.warnings);
      }
    }

    const result = runSweep(bars, req, source, warnings, benchmarkBars);
    // Environment concerns stay out of the pure engine: the route stamps the
    // build identity and, for synthetic data, the generator seed.
    return NextResponse.json({
      ...result,
      commit: APP_COMMIT,
      syntheticSeed: source === "synthetic" ? seedFromString(req.symbol) : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
