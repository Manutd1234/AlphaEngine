/**
 * Vectorised backtest engine (TypeScript).
 * ========================================
 *
 * A faithful port of `NumpyEngine` in `modules/backtester/engines.py`,
 * so a sweep run in the browser-facing Vercel portal and one run by the Python
 * gateway produce the same numbers.
 *
 * Accounting conventions (identical in both implementations):
 *   • signals are formed on bar t and executed on bar t+1 — no look-ahead;
 *   • cost = (fee + slippage) bps charged on the notional turnover of every
 *     position change;
 *   • returns compound on equity, i.e. constant-fraction (100%) sizing.
 *
 * WHERE THE PARTS ARE
 *
 * This file is the sweep and nothing else. It was 1,652 lines, 737 of them a
 * single branch chain over the forty-six strategies, which is the shape the
 * Python side had already been split out of. It now reads:
 *
 *   lib/strategies/             one object per strategy, keyed by id, exhaustive
 *   lib/strategies/grid.ts      the parameter space each strategy is swept over
 *   lib/engine/frame.ts         bars to columns, and the fingerprint of the input
 *   lib/engine/metrics.ts       Sharpe, Sortino, drawdown, bars per year
 *   lib/engine/combo.ts         one parameter pair, priced
 *   lib/engine/walk-forward.ts  choose in-sample, score out-of-sample
 *
 * `lib/engine/` is this file's own parts and has no `index.ts`, so `./engine`
 * still means this module and nothing else resolves to the directory.
 *
 * The public surface did not move: everything this file exported before, it
 * still exports, so no caller of `@/lib/engine` changed.
 */

import { compareToBenchmark } from "./benchmark";
import { rollingMax, rollingMin, shift1, sma } from "./indicators";
import { mcSeedFor, monteCarloBands } from "./montecarlo";
import { regimeReport } from "./regimes";
import {
  averageDailyVolume,
  buildFactors,
  parameterStability,
  promotionGate,
  regress,
  tailReport,
  turnoverCost,
  walkForwardReport,
  FACTOR_LOOKBACK,
} from "./quant";
import {
  deflatedSharpe,
  kurtosis,
  mean,
  minTrackRecordLength,
  skewness,
  stdev,
  verdictFor,
} from "./stats";
import {
  Bar,
  type DataSource,
  SeriesPoint,
  SweepRequest,
  SweepResponse,
  WalkForwardFold,
} from "./types";

import { costModelFor, runCombo, type ComboRun } from "./engine/combo";
import { columns, datasetFingerprint, isoDay } from "./engine/frame";
import { annualisedSharpe, barsPerYear, maxDrawdown } from "./engine/metrics";
import { walkForward } from "./engine/walk-forward";
import { paramGrid } from "./strategies/grid";

// The engine's front door. Every name here was exported from this file before
// the split, and the twelve callers outside it — two API routes,
// `components/Controls.tsx`, a seed script and eight test files — still import
// them from `@/lib/engine`. Moving code is not a reason to move an import.
export { paramGrid } from "./strategies/grid";
export { datasetFingerprint } from "./engine/frame";
export { annualisedSharpe, barsPerYear, maxDrawdown } from "./engine/metrics";
export {
  buildPosition,
  costModelFor,
  runCombo,
  type ComboRequest,
  type ComboRun,
} from "./engine/combo";
export { walkForward } from "./engine/walk-forward";

// --------------------------------------------------------------------------- //
// Orchestration
// --------------------------------------------------------------------------- //
export function runSweep(
  bars: Bar[],
  req: SweepRequest,
  dataSource: DataSource,
  warnings: string[] = [],
  /**
   * The external benchmark's bars, already loaded by the caller.
   *
   * Passed in rather than fetched here so the engine stays pure and the parity
   * fixture keeps calling it with three arguments. Absent means "not
   * requested", which the response distinguishes from "requested and could not
   * be aligned".
   */
  benchmarkBars: Bar[] | null = null,
): SweepResponse {
  const t0 = Date.now();
  const combos = paramGrid(req);
  if (!combos.length) throw new Error("Empty parameter grid — fast must be less than slow.");
  if (bars.length < 200) throw new Error(`Not enough data: ${bars.length} bars.`);

  const { close, high, low, volume, pxRet } = columns(bars);
  const ann = barsPerYear(req.interval);

  // Sized once on the whole series and reused for every combination and every
  // walk-forward slice. Recomputing it per slice would make an order's modelled
  // impact depend on which fold it landed in, so two identical trades would be
  // charged differently for a reason that has nothing to do with the trade.
  const adv = averageDailyVolume(bars, req.interval);

  const runs: ComboRun[] = combos.map(([f, s]) =>
    runCombo(bars, close, high, low, volume, pxRet, req, f, s, adv),
  );
  const results = runs.map((r) => r.result);

  let bestIdx = 0;
  for (let i = 1; i < results.length; i++) {
    if (results[i].sharpe > results[bestIdx].sharpe) bestIdx = i;
  }
  const best = results[bestIdx];
  const bestRun = runs[bestIdx];

  // --- multiple-testing correction ------------------------------------- //
  const perBarSd = stdev(bestRun.returns, 1);
  const srPerBar = perBarSd > 0 ? mean(bestRun.returns) / perBarSd : 0;
  const candidates = results.map((r) => r.sharpe / Math.sqrt(ann));
  const retSkew = skewness(bestRun.returns);
  const retKurt = kurtosis(bestRun.returns);
  const { dsr, psr, expectedMax } = deflatedSharpe(
    candidates,
    srPerBar,
    bestRun.returns.length,
    retSkew,
    retKurt,
  );

  // MinTRL benchmarks against the PER-BAR expectedMax; the response's
  // `expectedMaxSharpe` is the re-annualised one — do not mix them up.
  const minTrlEntry = (benchmark: number) => {
    const nStar = minTrackRecordLength(srPerBar, benchmark, retSkew, retKurt);
    if (!Number.isFinite(nStar)) return { bars: null, years: null, sufficient: null };
    const needed = Math.ceil(nStar);
    return { bars: needed, years: needed / ann, sufficient: bars.length >= needed };
  };
  const minTrackRecord = {
    confidence: 0.95,
    vsZero: minTrlEntry(0),
    vsSearchHurdle: minTrlEntry(expectedMax),
  };

  // --- walk-forward ------------------------------------------------------ //
  let wf: WalkForwardFold[] = [];
  let wfOos: number | null = null;
  if (req.walkForward) {
    try {
      const res = walkForward(bars, combos, req, adv);
      wf = res.folds;
      wfOos = res.oosSharpe;
      if (!wf.length) warnings.push("Walk-forward skipped: not enough bars for the requested folds.");
    } catch (err) {
      warnings.push(`Walk-forward failed: ${(err as Error).message}`);
    }
  }

  // --- benchmark --------------------------------------------------------- //
  const bhEquity = new Float64Array(bars.length);
  let bh = 1;
  for (let i = 0; i < bars.length; i++) {
    bh *= 1 + pxRet[i];
    bhEquity[i] = bh;
  }

  // --- series for the charts (thinned for payload size) ------------------ //
  // The overlay must be the lines the model ACTUALLY trades on. Plotting two
  // SMAs for every strategy makes the chart contradict the position shading:
  // a Donchian run showed 19 line-crossings against 6 real position changes.
  // RSI is deliberately not plotted as `fast` — it lives on a 0-100 scale and
  // PriceChart derives its y-domain from extent([close, fast, slow]), so a raw
  // RSI would flatten the price axis into a hairline.
  let fastMa: Float64Array;
  let slowMa: Float64Array;
  switch (req.strategy) {
    case "donchian":
      fastMa = shift1(rollingMax(high, best.fast)); // breakout trigger
      slowMa = shift1(rollingMin(low, best.slow)); // trailing exit
      break;
    case "rsi_reversion":
      fastMa = new Float64Array(bars.length).fill(NaN); // RSI is off-scale; omit
      slowMa = sma(close, best.slow); // the trend filter it really uses
      break;
    default:
      fastMa = sma(close, best.fast);
      slowMa = sma(close, best.slow);
  }
  const step = Math.max(1, Math.ceil(bars.length / 700));
  const series: SeriesPoint[] = [];
  const sampleIdx: number[] = [];
  let peak = -Infinity;
  const ddArr = new Float64Array(bars.length);
  for (let i = 0; i < bars.length; i++) {
    if (bestRun.equity[i] > peak) peak = bestRun.equity[i];
    ddArr[i] = bestRun.equity[i] / peak - 1;
  }
  for (let i = 0; i < bars.length; i += step) {
    sampleIdx.push(i);
    series.push({
      t: bars[i].t,
      close: close[i],
      fast: Number.isNaN(fastMa[i]) ? null : fastMa[i],
      slow: Number.isNaN(slowMa[i]) ? null : slowMa[i],
      position: bestRun.position[i],
      equity: bestRun.equity[i],
      buyHold: bhEquity[i],
      drawdown: ddArr[i],
    });
  }

  const sorted = [...results].sort((a, b) => b.sharpe - a.sharpe);

  // --- research analytics ------------------------------------------------ //
  // All derived from what the sweep already computed. Nothing above this line
  // changed, which is what keeps the parity fixture meaningful.
  const dataHash = datasetFingerprint(bars);

  const mcSeed = mcSeedFor(dataHash, best.fast, best.slow);
  const monteCarlo = monteCarloBands(bestRun.returns, sampleIdx, mcSeed);

  const regimes = regimeReport(bars, close, bestRun.returns, bestRun.position, req.interval);

  const stability = parameterStability(results);
  const wfReport = walkForwardReport(
    wf,
    combos.map(([f]) => f),
    combos.map(([, s]) => s),
  );

  const factorSet = buildFactors(pxRet);
  const regression = regress(
    bestRun.returns,
    factorSet.names.map((name, i) => ({ name, values: factorSet.values[i] })),
    ann,
  );
  const factors = regression
    ? {
        regression,
        descriptions: factorSet.descriptions,
        lookback: FACTOR_LOOKBACK,
        note:
          "Time-series factors built from this instrument's own bars — not Fama-French and not "
          + "cross-sectional, which one symbol cannot produce. t-statistics are plain OLS; a "
          + "Newey-West correction would widen them, so the significance shown here is generous.",
      }
    : null;

  const tail = tailReport(
    bestRun.returns,
    bestRun.equity,
    bars,
    req.interval,
    best.turnover,
  );

  const model = costModelFor(req);
  const participation = model.orderNotional > 0 && adv > 0
    ? Math.min(1, model.orderNotional / adv)
    : 0;
  const flatBps = req.feeBps + req.slippageBps;
  const costs = {
    flatBps,
    averageDailyVolume: adv,
    impactBps: (turnoverCost(model, adv) * 1e4) - flatBps,
    participation,
    fundingBpsPer8h: model.fundingBpsPer8h,
    borrowBpsAnnual: model.borrowBpsAnnual,
    flatOnly:
      model.impactCoefficient === 0
      && model.fundingBpsPer8h === 0
      && model.borrowBpsAnnual === 0,
  };

  const promotion = promotionGate({
    deflatedSharpe: dsr,
    walkForwardOosSharpe: wfOos,
    medianEfficiency: wfReport.medianEfficiency,
    stability: stability.best?.kind ?? null,
    alphaTStat: regression?.alphaTStat ?? null,
    maxDrawdown: best.maxDrawdown,
    trades: best.trades,
  });

  return {
    request: req,
    dataSource,
    bars: bars.length,
    periodStart: isoDay(bars[0].t),
    periodEnd: isoDay(bars[bars.length - 1].t),
    dataHash,
    combosTested: results.length,
    durationMs: Date.now() - t0,
    best,
    benchmark: {
      totalReturn: bhEquity[bars.length - 1] - 1,
      sharpe: annualisedSharpe(pxRet, ann),
      maxDrawdown: maxDrawdown(bhEquity),
    },
    benchmarkComparison: benchmarkBars && req.benchmarkSymbol
      ? compareToBenchmark(series, benchmarkBars, req.interval, req.benchmarkSymbol)
      : null,
    results,
    topResults: sorted.slice(0, 15),
    deflatedSharpeRatio: dsr,
    probabilisticSharpeRatio: psr,
    expectedMaxSharpe: expectedMax * Math.sqrt(ann),
    verdict: verdictFor(dsr, wfOos),
    walkForward: wf,
    walkForwardOosSharpe: wfOos,
    series,
    warnings,
    stability,
    walkForwardReport: wfReport,
    factors,
    tail,
    promotion,
    costs,
    minTrackRecord,
    monteCarlo,
    bestRunReturns: Array.from(bestRun.returns),
    regimes,
  };
}
