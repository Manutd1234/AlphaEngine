/**
 * Daily bars for whatever the book holds, and the four measured maps they make.
 *
 * The gateway knows the positions and nothing about how they co-move, so the
 * covariance behind every risk figure on the desk has to be measured here —
 * from the same `/api/ohlcv` route the research tab uses, not from assumed
 * factor loadings. This left `lib/use-book.ts` as a plain async function
 * because none of it is a hook: it is one fetch per held symbol and one
 * reduction, and a function that returns its four maps is testable in a way an
 * effect body writing four setters is not.
 *
 * Nothing here substitutes a value it could not measure. A symbol whose bars
 * are missing, short, or synthetic is absent from `returns` rather than present
 * with an invented series, and `use-book` reports it through `missingHistory`.
 */

import { averageDailyVolume } from "@/lib/quant";
import type { ReturnsBySymbol } from "@/lib/portfolio-risk";
import { isMeasuredSource, type Bar } from "@/lib/types";

/** Newest daily bar per symbol, keyed for the session-alignment check. */
export type SessionBars = Record<string, { openMs: number; prevClose: number; close: number }>;

/** Quote-currency average daily volume, measured from the same bars as `returns`. */
export type AdvBySymbol = Record<string, { adv: number; observations: number }>;

/** The four maps the risk layer reads, all built from one pass over the bars. */
export interface HeldBars {
  returns: ReturnsBySymbol;
  /** Bar open-times, index-aligned with `returns[symbol]`. */
  barTimes: Record<string, number[]>;
  advBySymbol: AdvBySymbol;
  sessionBars: SessionBars;
}

/** What an empty book measures: four empty maps, never a zero-filled one. */
export const NO_HELD_BARS: HeldBars = {
  returns: {}, barTimes: {}, advBySymbol: {}, sessionBars: {},
};

interface SymbolBars {
  symbol: string;
  series: number[];
  times: number[];
  bar: SessionBars[string] | null;
  adv: { adv: number; observations: number } | null;
}

async function fetchSymbol(symbol: string): Promise<SymbolBars> {
  const empty: SymbolBars = { symbol, series: [], times: [], bar: null, adv: null };
  try {
    const response = await fetch(
      // 400 rather than 180: a 60-bar rolling VaR backtest scores only
      // `n - 60` points, so 180 bars is 119 — a sketch rather than a
      // chart. `fetchBinanceKlines` pages at <= 1000, so this is still one
      // request. It is NOT free in meaning: buildCovariance aligns to the
      // shortest common series, so every figure on this tab moves from a
      // ~6-month to a ~13-month window. The panel prints `observations`,
      // so the change announces itself.
      `/api/ohlcv?symbol=${encodeURIComponent(symbol)}&interval=1d&bars=400`,
      { cache: "no-store" },
    );
    if (!response.ok) return empty;
    const body = await response.json();
    const bars: Bar[] = body.bars ?? [];
    // Synthetic bars would silently become a covariance estimate. A book's
    // risk must not be measured against invented prices, so that source is
    // dropped rather than used. Dropped by the NAMED predicate, not by venue:
    // this line used to read `source !== "binance"`, and the day bars started
    // arriving from Bybit it rejected every crypto symbol — the Risk tab
    // reported "not enough price history" against 400 real daily bars,
    // forever, with every test green.
    if (!isMeasuredSource(body.source) || bars.length < 21) return empty;
    // Returns and their bar times are built in one pass so `times[k]` is by
    // construction the open of the bar whose close produced `series[k]`. Every
    // downstream x-axis rests on that alignment, and it must not be re-derived
    // anywhere else.
    const series: number[] = [];
    const times: number[] = [];
    for (let i = 1; i < bars.length; i++) {
      if (bars[i - 1].c > 0) {
        series.push(bars[i].c / bars[i - 1].c - 1);
        times.push(Number(bars[i].t));
      }
    }
    // The newest bar's open time is what lets a consumer check that the return
    // it is about to use covers the gateway's session rather than yesterday's.
    // The pipeline used to read `c` and drop `t`, which made that check
    // impossible and the alignment an assumption.
    const newest = bars[bars.length - 1];
    const previous = bars[bars.length - 2];
    const bar = newest && previous && previous.c > 0
      ? { openMs: Number(newest.t), prevClose: previous.c, close: newest.c }
      : null;
    // Quote-currency ADV from the same bars the risk numbers use, so a
    // position can never have a liquidity figure but no risk figure.
    return {
      symbol,
      series,
      times,
      bar,
      adv: { adv: averageDailyVolume(bars, "1d"), observations: bars.length },
    };
  } catch {
    return empty;
  }
}

/** One request per held symbol, reduced to the four aligned maps. */
export async function fetchHeldBars(symbols: string[]): Promise<HeldBars> {
  if (!symbols.length) return NO_HELD_BARS;
  const entries = await Promise.all(symbols.map(fetchSymbol));
  // One predicate for every map, so a symbol can never appear in one and not
  // another.
  const measured = entries.filter((entry) => entry.series.length > 0);
  return {
    returns: Object.fromEntries(measured.map((e) => [e.symbol, e.series])),
    barTimes: Object.fromEntries(measured.map((e) => [e.symbol, e.times])),
    advBySymbol: Object.fromEntries(
      measured.filter((e) => e.adv !== null).map((e) => [e.symbol, e.adv!]),
    ),
    sessionBars: Object.fromEntries(
      entries.filter((e) => e.bar !== null).map((e) => [e.symbol, e.bar!]),
    ),
  };
}
