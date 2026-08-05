/**
 * Regime-conditioned performance.
 * ===============================
 *
 * A single headline Sharpe hides *where* the returns came from. A trend
 * follower that earned everything in one bull leg and bled through every
 * sideways stretch is a different proposition from one that survives all
 * three — this module makes that distinction visible.
 *
 * Two classifications, both deliberately simple and stated in the payload:
 *   • Trend — price vs its own long SMA with a ±deadband. Interpretable
 *     ("price is >2% above its 200-bar average"), stateless, and reuses the
 *     exact `sma` the strategies trade on.
 *   • Volatility — trailing realised vol split at the full-sample median.
 *     The median is hindsight: this is descriptive attribution, not a
 *     tradable signal, and the `note` says so.
 *
 * Named stress windows (COVID, Luna/3AC, FTX) are always listed; when the
 * loaded bars do not cover a window it is reported as uncovered rather than
 * silently dropped — absence of evidence must look different from evidence.
 *
 * Small private copies of the Sharpe/drawdown helpers rather than an import
 * from `engine.ts`, which would create a cycle (engine imports this module).
 * Same precedent as `quant.ts`.
 */

import { sma } from "./indicators";
import { mean, stdev } from "./stats";
import {
  BARS_PER_YEAR,
  type Bar,
  type NamedWindowStat,
  type RegimeReport,
  type RegimeStat,
} from "./types";

/** Below this many bars a regime Sharpe is reported as null, not a number. */
const MIN_BARS_FOR_SHARPE = 20;

export const TREND_DEADBAND = 0.02;
export const VOL_LOOKBACK = 30;

export const NAMED_WINDOWS = [
  {
    id: "covid",
    label: "COVID crash (Mar 2020)",
    startMs: Date.UTC(2020, 2, 1),
    endMs: Date.UTC(2020, 3, 1),
  },
  {
    id: "luna-3ac",
    label: "2022 crypto crash (Luna/3AC, Apr–Jun)",
    startMs: Date.UTC(2022, 3, 1),
    endMs: Date.UTC(2022, 6, 1),
  },
  {
    id: "ftx",
    label: "FTX collapse (Nov 2022)",
    startMs: Date.UTC(2022, 10, 1),
    endMs: Date.UTC(2022, 11, 1),
  },
] as const;

function annualisedSharpeOf(returns: number[], ann: number): number {
  if (returns.length < 2) return 0;
  const sd = stdev(returns, 1);
  return sd > 0 ? (mean(returns) / sd) * Math.sqrt(ann) : 0;
}

function maxDrawdownOf(equity: number[]): number {
  let peak = -Infinity;
  let worst = 0;
  for (const e of equity) {
    if (e > peak) peak = e;
    const dd = e / peak - 1;
    if (dd < worst) worst = dd;
  }
  return worst;
}

function statFor(
  regime: string,
  indices: number[],
  returns: Float64Array,
  position: Float64Array,
  ann: number,
  groupTotal: number,
): RegimeStat {
  const rets: number[] = [];
  const equity: number[] = [];
  let eq = 1;
  let wins = 0;
  let exposed = 0;
  for (const i of indices) {
    const r = returns[i];
    rets.push(r);
    eq *= 1 + r;
    equity.push(eq);
    if (r > 0) wins++;
    if (position[i] !== 0) exposed++;
  }
  const n = indices.length;
  return {
    regime,
    bars: n,
    share: groupTotal > 0 ? n / groupTotal : 0,
    sharpe: n >= MIN_BARS_FOR_SHARPE ? annualisedSharpeOf(rets, ann) : null,
    totalReturn: eq - 1,
    maxDrawdown: maxDrawdownOf(equity),
    winRate: n > 0 ? wins / n : 0,
    exposure: n > 0 ? exposed / n : 0,
  };
}

/** Trailing realised vol of price returns, NaN until the window fills. */
function rollingVol(close: Float64Array, window: number): Float64Array {
  const n = close.length;
  const out = new Float64Array(n).fill(NaN);
  if (n < 2) return out;
  const rets = new Float64Array(n);
  for (let i = 1; i < n; i++) rets[i] = close[i - 1] !== 0 ? close[i] / close[i - 1] - 1 : 0;
  let sum = 0;
  let sumSq = 0;
  for (let i = 1; i < n; i++) {
    sum += rets[i];
    sumSq += rets[i] * rets[i];
    if (i > window) {
      sum -= rets[i - window];
      sumSq -= rets[i - window] * rets[i - window];
    }
    if (i >= window) {
      const m = sum / window;
      const variance = Math.max(0, sumSq / window - m * m);
      out[i] = Math.sqrt(variance);
    }
  }
  return out;
}

export function regimeReport(
  bars: Bar[],
  close: Float64Array,
  strategyReturns: Float64Array,
  position: Float64Array,
  interval: string,
): RegimeReport {
  const n = bars.length;
  const ann = BARS_PER_YEAR[interval] ?? 8760;
  const trendLookback = Math.max(2, Math.min(200, Math.floor(n / 4)));

  // --- trend: price vs its own long SMA with a deadband ------------------- //
  const trendSma = sma(close, trendLookback);
  const bull: number[] = [];
  const bear: number[] = [];
  const sideways: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = trendSma[i];
    if (Number.isNaN(s)) continue;
    if (close[i] > s * (1 + TREND_DEADBAND)) bull.push(i);
    else if (close[i] < s * (1 - TREND_DEADBAND)) bear.push(i);
    else sideways.push(i);
  }
  const trendTotal = bull.length + bear.length + sideways.length;

  // --- volatility: trailing realised vol vs full-sample median ------------ //
  const vol = rollingVol(close, VOL_LOOKBACK);
  const defined: number[] = [];
  for (let i = 0; i < n; i++) if (!Number.isNaN(vol[i])) defined.push(i);
  const sortedVols = defined.map((i) => vol[i]).sort((a, b) => a - b);
  const median = sortedVols.length ? sortedVols[Math.floor(sortedVols.length / 2)] : 0;
  const highVol: number[] = [];
  const lowVol: number[] = [];
  for (const i of defined) (vol[i] >= median ? highVol : lowVol).push(i);
  const volTotal = highVol.length + lowVol.length;

  // --- named stress windows ----------------------------------------------- //
  const spanStart = n ? bars[0].t : 0;
  const spanEnd = n ? bars[n - 1].t : 0;
  const windows: NamedWindowStat[] = NAMED_WINDOWS.map((w) => {
    const overlap = Math.max(
      0,
      Math.min(spanEnd, w.endMs) - Math.max(spanStart, w.startMs),
    );
    const coverage = overlap / (w.endMs - w.startMs);
    const inWindow: number[] = [];
    for (let i = 0; i < n; i++) {
      if (bars[i].t >= w.startMs && bars[i].t < w.endMs) inWindow.push(i);
    }
    const covered = coverage >= 0.9 && inWindow.length >= 30;
    return {
      id: w.id,
      label: w.label,
      covered,
      coverage,
      stat: covered ? statFor(w.id, inWindow, strategyReturns, position, ann, n) : null,
    };
  });

  return {
    trendLookback,
    deadband: TREND_DEADBAND,
    volLookback: VOL_LOOKBACK,
    classifiedBars: trendTotal,
    totalBars: n,
    trend: [
      statFor("bull", bull, strategyReturns, position, ann, trendTotal),
      statFor("bear", bear, strategyReturns, position, ann, trendTotal),
      statFor("sideways", sideways, strategyReturns, position, ann, trendTotal),
    ],
    vol: [
      statFor("highVol", highVol, strategyReturns, position, ann, volTotal),
      statFor("lowVol", lowVol, strategyReturns, position, ann, volTotal),
    ],
    windows,
    note:
      `Trend = close vs its ${trendLookback}-bar SMA with a ±${TREND_DEADBAND * 100}% deadband; `
      + `SMA warm-up bars are unclassified. The volatility split uses the full-sample median — `
      + `hindsight, so it describes where returns came from and is not a tradable signal. `
      + `Per-regime drawdown compounds only that regime's bars stitched together: a diagnostic, `
      + `not a drawdown anyone lived through.`,
  };
}
