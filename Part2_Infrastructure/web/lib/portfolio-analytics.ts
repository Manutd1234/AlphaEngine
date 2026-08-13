/**
 * Derivations for the portfolio charts, kept pure so they can be tested without
 * a DOM and so no component decides on its own what a number means.
 *
 * Each one states what it will not claim, because on this tab the tempting
 * mistakes are all the same shape: a ratio computed over too few observations,
 * an annualisation applied to an irregular series, or a category inferred from
 * a ticker and then printed as a fact.
 */

import { classify } from "@/lib/providers/symbols";
import type { EquityPoint, PortfolioPosition, StrategyAttribution } from "@/lib/portfolio";

/**
 * Underwater curve: how far below its own high-water mark the book has been.
 *
 * Exact rather than estimated — `highWaterMark` is already on every point, and
 * it is the quantity the gateway's halt rule is written against, so this is the
 * same measure the desk is actually governed by.
 */
export interface DrawdownPoint {
  t: number;
  /** Negative or zero, as a fraction. */
  drawdown: number;
}

export function drawdownSeries(points: EquityPoint[]): DrawdownPoint[] {
  return points
    .filter((p) => Number.isFinite(p.equity) && Number.isFinite(p.highWaterMark) && p.highWaterMark > 0)
    .map((p) => ({ t: p.t, drawdown: p.equity / p.highWaterMark - 1 }));
}

/** The deepest point, and when. Null on an empty or never-underwater series. */
export function maxDrawdown(points: EquityPoint[]): DrawdownPoint | null {
  const series = drawdownSeries(points);
  if (!series.length) return null;
  return series.reduce((worst, point) => (point.drawdown < worst.drawdown ? point : worst));
}

/**
 * Below this many observations a ratio of mean to standard deviation is noise
 * wearing a Sharpe's name. The same floor the rest of the desk uses for
 * percentiles, for the same reason.
 */
export const MIN_SHARPE_OBSERVATIONS = 20;

export interface SharpePoint {
  t: number;
  /** Null where the trailing window is too thin — the line breaks, never bridges. */
  sharpe: number | null;
}

/**
 * Rolling Sharpe over the equity track, PER OBSERVATION and not annualised.
 *
 * The annualisation is deliberately absent. `equityTrack` is a poll series
 * whose spacing depends on how long the tab has been open and how often the
 * gateway answered; multiplying by sqrt(periods-per-year) requires a period,
 * and this series does not have a stable one. Reporting the un-annualised ratio
 * is a smaller claim that happens to be true, and the axis label says which it
 * is.
 *
 * A window with no dispersion returns null rather than Infinity: a book that
 * did not move has no risk-adjusted return, and a vertical spike at the moment
 * trading started is not information.
 */
export function rollingSharpe(
  points: EquityPoint[],
  window = MIN_SHARPE_OBSERVATIONS,
): SharpePoint[] {
  const usable = points.filter((p) => Number.isFinite(p.equity) && p.equity > 0);
  const returns: Array<{ t: number; r: number }> = [];
  for (let i = 1; i < usable.length; i += 1) {
    returns.push({ t: usable[i].t, r: usable[i].equity / usable[i - 1].equity - 1 });
  }

  return returns.map((point, index) => {
    if (index + 1 < window) return { t: point.t, sharpe: null };
    const slice = returns.slice(index + 1 - window, index + 1).map((p) => p.r);
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    const variance = slice.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (slice.length - 1);
    const sd = Math.sqrt(variance);
    if (!Number.isFinite(sd) || sd === 0) return { t: point.t, sharpe: null };
    return { t: point.t, sharpe: mean / sd };
  });
}

export interface MixSlice {
  label: string;
  value: number;
  share: number;
}

function toMix(entries: Map<string, number>): MixSlice[] {
  const total = [...entries.values()].reduce((a, b) => a + b, 0);
  if (total <= 0) return [];
  return [...entries.entries()]
    .map(([label, value]) => ({ label, value, share: value / total }))
    .sort((a, b) => b.value - a.value);
}

/**
 * Gross exposure by asset class.
 *
 * `classify` is the routing module's own classifier, reused rather than
 * duplicated — it is deliberately conservative (a bare `BTC` is a real NYSE
 * listing, so a base symbol only counts as crypto when it carries a recognised
 * quote asset), and a second copy of that judgement would drift from the one
 * that decides where quotes are actually fetched from.
 */
export function assetClassMix(positions: PortfolioPosition[]): MixSlice[] {
  const buckets = new Map<string, number>();
  for (const position of positions) {
    const key = classify(position.symbol);
    buckets.set(key, (buckets.get(key) ?? 0) + Math.abs(position.notional));
  }
  return toMix(buckets);
}

/** The quote assets a pair can settle in, longest first so USDT beats USD. */
const QUOTES = ["USDT", "USDC", "BUSD", "USD", "BTC", "ETH"];

/**
 * Settlement currency, INFERRED FROM THE TICKER.
 *
 * There is no currency field anywhere in the payload, so this is a derivation
 * from the symbol's suffix and the panel labels it as one. An equity ticker
 * carries no quote asset at all and lands in `unknown` rather than being
 * assumed into USD — the desk trades on venues where that assumption is exactly
 * the sort that goes unnoticed until it is expensive.
 */
export function currencyMix(positions: PortfolioPosition[]): MixSlice[] {
  const buckets = new Map<string, number>();
  for (const position of positions) {
    const symbol = position.symbol.toUpperCase();
    const quote = QUOTES.find((q) => symbol.length > q.length && symbol.endsWith(q)) ?? "unknown";
    buckets.set(quote, (buckets.get(quote) ?? 0) + Math.abs(position.notional));
  }
  return toMix(buckets);
}

/**
 * Traded notional by sleeve — NOT current exposure.
 *
 * `by_strategy` is a lifetime tally of what each sleeve has traded, not what it
 * is holding now, and the positions payload carries no strategy tag to build
 * the latter from. So this is honestly a flow measure and the panel says so;
 * calling it "sleeve concentration" without that word would describe a chart
 * this data cannot draw.
 */
export function sleeveMix(attribution: StrategyAttribution[]): MixSlice[] {
  const buckets = new Map<string, number>();
  for (const row of attribution) {
    // The gateway records untagged flow with a null strategy; it is a real
    // bucket rather than a row to drop, and the same sentinel the blotter uses.
    const key = row.strategy ?? "untagged";
    buckets.set(key, (buckets.get(key) ?? 0) + Math.abs(row.notional));
  }
  return toMix(buckets);
}

export interface UnrealisedSpread {
  /** Positions carrying an unrealised figure. */
  n: number;
  winners: number;
  losers: number;
  flat: number;
  best: { symbol: string; pnl: number } | null;
  worst: { symbol: string; pnl: number } | null;
  total: number;
  /** Largest single |unrealised|, for scaling the bars. */
  scale: number;
}

/**
 * Where the open P&L actually sits.
 *
 * The positions table sums `total_pnl` into one number, which cannot answer the
 * question a reader has when it is small: is this a flat book, or two large
 * positions cancelling each other out?
 */
export function unrealisedSpread(positions: PortfolioPosition[]): UnrealisedSpread {
  const priced = positions.filter((p) => Number.isFinite(p.unrealized_pnl));
  const sorted = [...priced].sort((a, b) => b.unrealized_pnl - a.unrealized_pnl);
  return {
    n: priced.length,
    winners: priced.filter((p) => p.unrealized_pnl > 0).length,
    losers: priced.filter((p) => p.unrealized_pnl < 0).length,
    flat: priced.filter((p) => p.unrealized_pnl === 0).length,
    best: sorted.length ? { symbol: sorted[0].symbol, pnl: sorted[0].unrealized_pnl } : null,
    worst: sorted.length
      ? { symbol: sorted[sorted.length - 1].symbol, pnl: sorted[sorted.length - 1].unrealized_pnl }
      : null,
    total: priced.reduce((sum, p) => sum + p.unrealized_pnl, 0),
    scale: priced.reduce((max, p) => Math.max(max, Math.abs(p.unrealized_pnl)), 0),
  };
}

export interface ExposureCell {
  symbol: string;
  /** Share of gross, 0..1. */
  share: number;
  /** Limit utilisation, 0..1, or null where no symbol limit is published. */
  utilisation: number | null;
  unrealised: number;
  side: PortfolioPosition["side"];
  notional: number;
}

/**
 * The positions ranked by how much of the book they are, with their own limit
 * utilisation beside it.
 *
 * Two measures rather than one because they disagree usefully: a position can
 * be a small share of gross and still be pressed against its own symbol limit,
 * and that is precisely the position a reader needs to find.
 */
export function exposureCells(positions: PortfolioPosition[]): ExposureCell[] {
  return positions
    .map((position) => ({
      symbol: position.symbol,
      share: position.share_of_gross,
      utilisation: Number.isFinite(position.symbol_limit?.utilisation)
        ? position.symbol_limit.utilisation
        : null,
      unrealised: position.unrealized_pnl,
      side: position.side,
      notional: Math.abs(position.notional),
    }))
    .sort((a, b) => b.share - a.share);
}
