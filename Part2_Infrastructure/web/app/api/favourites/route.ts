/**
 * Combine up to five saved runs into one portfolio.
 *
 * Each recipe is RE-EXECUTED rather than replayed. `ExperimentRecord` stores a
 * projection and never the return series — a deliberate decision documented in
 * `lib/experiments.ts`, because sixty records of two thousand floats would
 * exceed the 5 MB `localStorage` quota. What it does store is exactly the
 * recipe: symbol, interval, strategy, parameters, window. Re-running five of
 * them costs five bar loads and five combinations, which is well inside this
 * function's budget and avoids fighting a decision that was correct.
 *
 * The cap of five is the interesting constraint. It is not a performance limit —
 * it is the point past which a "portfolio" of backtest variations stops being a
 * portfolio. Five saved runs on the same symbol with adjacent parameters are one
 * bet, and an optimiser handed six of them will report a diversification benefit
 * that does not exist.
 */

import { NextRequest, NextResponse } from "next/server";

import { barsPerYear, runCombo } from "@/lib/engine";
import {
  alignFavourites,
  combineFavourites,
  FAVOURITE_METHODS,
  MIN_OVERLAP_BARS,
  type FavouriteMethod,
  type FavouriteSeries,
} from "@/lib/favourites";
import { loadBars, MarketDataUnavailableError } from "@/lib/marketdata";
import { DEFAULT_REQUEST, INTERVALS, STRATEGY_LABELS, type SweepRequest } from "@/lib/types";

export const runtime = "nodejs";

/** Five, and the reason is in the module comment: past this it is one bet. */
const MAX_FAVOURITES = 5;

interface Recipe {
  id: string;
  symbol: string;
  interval: string;
  strategy: string;
  fast: number;
  slow: number;
  bars: number;
  direction?: string;
  feeBps?: number;
  slippageBps?: number;
}

function isRecipe(value: unknown): value is Recipe {
  const r = value as Recipe;
  return Boolean(
    r && typeof r.id === "string" && typeof r.symbol === "string"
    && typeof r.strategy === "string" && Number.isFinite(r.fast) && Number.isFinite(r.slow),
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { recipes?: unknown; method?: unknown };
    const recipes = Array.isArray(body.recipes) ? body.recipes.filter(isRecipe) : [];

    if (recipes.length < 2) {
      return NextResponse.json(
        { error: "Combining needs at least two saved runs." },
        { status: 400 },
      );
    }
    if (recipes.length > MAX_FAVOURITES) {
      return NextResponse.json(
        { error: `At most ${MAX_FAVOURITES} runs can be combined.` },
        { status: 400 },
      );
    }
    // Two slots holding the same run would give the optimiser a perfectly
    // correlated pair and a covariance matrix it cannot invert — and, worse, a
    // "portfolio" whose diversification is entirely an artefact of counting one
    // strategy twice.
    if (new Set(recipes.map((r) => r.id)).size !== recipes.length) {
      return NextResponse.json({ error: "The same run was submitted twice." }, { status: 400 });
    }

    const method: FavouriteMethod =
      (FAVOURITE_METHODS as readonly string[]).includes(String(body.method))
        ? (body.method as FavouriteMethod)
        : "equal_weight";

    const warnings: string[] = [];
    const series: FavouriteSeries[] = [];

    for (const recipe of recipes) {
      const interval = (INTERVALS as readonly string[]).includes(recipe.interval)
        ? recipe.interval : DEFAULT_REQUEST.interval;
      const barCount = Math.min(5000, Math.max(300, Math.round(recipe.bars ?? DEFAULT_REQUEST.bars)));
      const loaded = await loadBars(recipe.symbol, interval, barCount);
      warnings.push(...loaded.warnings);

      const n = loaded.bars.length;
      const close = new Float64Array(n);
      const high = new Float64Array(n);
      const low = new Float64Array(n);
      const volume = new Float64Array(n);
      const pxRet = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        close[i] = loaded.bars[i].c;
        high[i] = loaded.bars[i].h;
        low[i] = loaded.bars[i].l;
        volume[i] = loaded.bars[i].v;
      }
      for (let i = 1; i < n; i++) pxRet[i] = close[i - 1] !== 0 ? close[i] / close[i - 1] - 1 : 0;

      const req: SweepRequest = {
        ...DEFAULT_REQUEST,
        symbol: recipe.symbol,
        interval,
        bars: barCount,
        strategy: (recipe.strategy in STRATEGY_LABELS
          ? recipe.strategy : DEFAULT_REQUEST.strategy) as SweepRequest["strategy"],
        direction: recipe.direction === "long_short" ? "long_short" : "long_only",
        feeBps: Number.isFinite(recipe.feeBps) ? Number(recipe.feeBps) : DEFAULT_REQUEST.feeBps,
        slippageBps: Number.isFinite(recipe.slippageBps)
          ? Number(recipe.slippageBps) : DEFAULT_REQUEST.slippageBps,
      };

      const combo = runCombo(
        loaded.bars, close, high, low, volume, pxRet, req, recipe.fast, recipe.slow,
      );

      series.push({
        id: recipe.id,
        label: `${recipe.symbol}, ${STRATEGY_LABELS[req.strategy]} ${recipe.fast}/${recipe.slow}`,
        symbol: recipe.symbol,
        timestamps: loaded.bars.map((b) => b.t),
        returns: Array.from(combo.returns),
      });
    }

    const aligned = alignFavourites(series);
    if (!aligned) {
      return NextResponse.json(
        { error: "These runs share no bars — they cannot be combined into one portfolio." },
        { status: 422 },
      );
    }
    if (aligned.overlap < MIN_OVERLAP_BARS) {
      // Refused rather than answered. A covariance across five strategies on
      // forty shared bars has more parameters than observations, and the weights
      // it produces are noise wearing a method name.
      return NextResponse.json({
        error: `These runs overlap on only ${aligned.overlap} bars; `
          + `${MIN_OVERLAP_BARS} are needed before a covariance means anything. `
          + "Pick runs over a common window, or the same interval.",
        overlap: aligned.overlap,
      }, { status: 422 });
    }

    const ann = barsPerYear(recipes[0].interval);
    const results = FAVOURITE_METHODS
      .map((m) => combineFavourites(aligned, m, ann))
      .filter((r) => r !== null);
    const chosen = results.find((r) => r.method === method) ?? null;

    return NextResponse.json({
      method,
      overlap: aligned.overlap,
      longest: aligned.longest,
      members: series.map((s) => ({ id: s.id, label: s.label, symbol: s.symbol })),
      chosen,
      // Every method, so a reader can see whether the clever one beat 1/n out of
      // sample. Usually it does not, and that is the most useful thing this
      // endpoint reports.
      all: results,
      warnings,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown error" },
      { status: err instanceof MarketDataUnavailableError ? 503 : 400 },
    );
  }
}
