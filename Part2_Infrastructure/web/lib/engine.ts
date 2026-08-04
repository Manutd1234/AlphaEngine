/**
 * Vectorised backtest engine (TypeScript).
 * ========================================
 *
 * A faithful port of `NumpyEngine` in `Part2_Infrastructure/modules/backtester.py`,
 * so a sweep run in the browser-facing Vercel portal and one run by the Python
 * gateway produce the same numbers.
 *
 * Accounting conventions (identical in both implementations):
 *   • signals are formed on bar t and executed on bar t+1 — no look-ahead;
 *   • cost = (fee + slippage) bps charged on the notional turnover of every
 *     position change;
 *   • returns compound on equity, i.e. constant-fraction (100%) sizing.
 */

import { pctChange, rollingMax, rollingMin, rsi, shift1, sma } from "./indicators";
import {
  type CostModel,
  averageDailyVolume,
  buildFactors,
  holdingCost,
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
  skewness,
  stdev,
  verdictFor,
} from "./stats";
import {
  BARS_PER_YEAR,
  Bar,
  Direction,
  MAX_COMBOS,
  ParamResult,
  SeriesPoint,
  Strategy,
  SweepRequest,
  SweepResponse,
  WalkForwardFold,
} from "./types";

export const barsPerYear = (interval: string) => BARS_PER_YEAR[interval] ?? 8760;

// --------------------------------------------------------------------------- //
// Signals
// --------------------------------------------------------------------------- //
/**
 * The strategy's "should I be long?" state, bar by bar.
 *
 * Mirrors `build_signals` in the Python reference, including two details that
 * are easy to get wrong and that the parity suite pins:
 *
 *  1. **Exit dominates entry.** The reference assigns the entry mask and then
 *     the exit mask, so a bar where both fire ends up flat. Written as an
 *     if/else-if chain the entry wins instead — which turns RSI reversion from
 *     2 trades into 70, because oversold and below-trend nearly always coincide.
 *  2. **NaN comparisons are false.** Before an indicator's lookback is filled it
 *     has no opinion, and "no opinion" is not "exit".
 */
function longState(
  strategy: Strategy,
  close: Float64Array,
  high: Float64Array,
  low: Float64Array,
  fast: number,
  slow: number,
): Uint8Array {
  const n = close.length;
  const out = new Uint8Array(n);

  if (strategy === "ma_cross") {
    const f = sma(close, fast);
    const s = sma(close, slow);
    for (let i = 0; i < n; i++) {
      out[i] = !Number.isNaN(f[i]) && !Number.isNaN(s[i]) && f[i] > s[i] ? 1 : 0;
    }
    return out;
  }

  if (strategy === "donchian") {
    const upper = shift1(rollingMax(high, fast));
    const lower = shift1(rollingMin(low, slow));
    let state = 0;
    for (let i = 0; i < n; i++) {
      if (!Number.isNaN(upper[i]) && close[i] > upper[i]) state = 1;
      if (!Number.isNaN(lower[i]) && close[i] < lower[i]) state = 0; // exit overrides
      out[i] = state;
    }
    return out;
  }

  // rsi_reversion — buy oversold; the trend MA is a STOP, not an entry gate.
  const r = rsi(close, fast);
  const trend = sma(close, slow);
  let state = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(r[i]) && r[i] < 30) state = 1;
    if ((!Number.isNaN(r[i]) && r[i] > 55) || (!Number.isNaN(trend[i]) && close[i] < trend[i])) {
      state = 0; // exit overrides
    }
    out[i] = state;
  }
  return out;
}

/**
 * Target position per bar: 1 long, 0 flat, -1 short (long_short only).
 *
 * Driven by crossover *events*, not by the raw comparison: the book starts flat
 * and only takes a side once a signal has actually fired. Reading the comparison
 * directly would open a short the instant the warmup ends in long/short mode —
 * a position nobody asked for, on a signal that never happened.
 *
 * Parameter semantics (always fast < slow):
 *   ma_cross      fast/slow SMA periods
 *   donchian      fast = breakout lookback, slow = trailing-exit lookback
 *   rsi_reversion fast = RSI period, slow = trend-filter SMA period
 */
export function buildPosition(
  strategy: Strategy,
  bars: Bar[],
  close: Float64Array,
  high: Float64Array,
  low: Float64Array,
  fast: number,
  slow: number,
  direction: Direction,
): Float64Array {
  const n = close.length;
  const pos = new Float64Array(n);
  const flat = direction === "long_short" ? -1 : 0;
  const isLong = longState(strategy, close, high, low, fast, slow);

  let state = 0;
  let prevLong = 0;
  for (let i = 0; i < n; i++) {
    if (isLong[i] && !prevLong) state = 1;
    else if (!isLong[i] && prevLong) state = flat;
    pos[i] = state;
    prevLong = isLong[i];
  }
  return pos;
}

// --------------------------------------------------------------------------- //
// Metrics
// --------------------------------------------------------------------------- //
export function maxDrawdown(equity: Float64Array): number {
  let peak = -Infinity;
  let worst = 0;
  for (let i = 0; i < equity.length; i++) {
    if (equity[i] > peak) peak = equity[i];
    const dd = equity[i] / peak - 1;
    if (dd < worst) worst = dd;
  }
  return worst;
}

export function annualisedSharpe(returns: Float64Array, ann: number): number {
  const sd = stdev(returns, 1);
  return sd > 0 ? (mean(returns) / sd) * Math.sqrt(ann) : 0;
}

function sortino(returns: Float64Array, ann: number): number {
  const downside: number[] = [];
  for (let i = 0; i < returns.length; i++) if (returns[i] < 0) downside.push(returns[i]);
  const dd = downside.length > 1 ? stdev(downside, 1) : 0;
  return dd > 0 ? (mean(returns) / dd) * Math.sqrt(ann) : 0;
}

export interface ComboRun {
  result: ParamResult;
  equity: Float64Array;
  returns: Float64Array;
  position: Float64Array;
  /** Holding costs (funding + borrow) charged over the run, in fractional terms. */
  holdingDrag: number;
}

/**
 * The fields `runCombo` reads from a request.
 *
 * The friction group is `Partial` on purpose. The parity suite constructs this
 * object literally with the original five fields, and `turnoverCost` /
 * `holdingCost` both collapse to the flat model when the frictions are absent —
 * so an unconfigured run is not merely *close* to the Python reference, it
 * evaluates the identical expression.
 */
export type ComboRequest =
  Pick<SweepRequest, "strategy" | "direction" | "feeBps" | "slippageBps" | "interval">
  & Partial<Pick<SweepRequest, "impactCoefficient" | "orderNotional" | "fundingBpsPer8h" | "borrowBpsAnnual">>;

export function costModelFor(req: ComboRequest): CostModel {
  return {
    feeBps: req.feeBps,
    slippageBps: req.slippageBps,
    impactCoefficient: req.impactCoefficient ?? 0,
    orderNotional: req.orderNotional ?? 0,
    fundingBpsPer8h: req.fundingBpsPer8h ?? 0,
    borrowBpsAnnual: req.borrowBpsAnnual ?? 0,
  };
}

export function runCombo(
  bars: Bar[],
  close: Float64Array,
  high: Float64Array,
  low: Float64Array,
  pxRet: Float64Array,
  req: ComboRequest,
  fast: number,
  slow: number,
  /** Average daily quote volume, for the square-root impact model. */
  adv = 0,
): ComboRun {
  const n = close.length;
  const model = costModelFor(req);
  const cost = turnoverCost(model, adv);
  // Skipped entirely when both rates are zero, so the hot loop is byte-identical
  // to the pre-friction version on a default request.
  const chargesHolding = model.fundingBpsPer8h !== 0 || model.borrowBpsAnnual !== 0;
  const ann = barsPerYear(req.interval);

  const pos = buildPosition(req.strategy, bars, close, high, low, fast, slow, req.direction);

  const returns = new Float64Array(n);
  const equity = new Float64Array(n);
  let eq = 1;
  let prevLagged = 0;
  let turnoverTotal = 0;
  let feesUsd = 0;
  let trades = 0;
  let wins = 0;
  let tradeEntryEquity = 1;
  let inTrade = false;
  let holdingDrag = 0;

  // Win *rate* alone cannot size a position: 40% winners paying 3:1 and 40%
  // winners paying 0.5:1 are the same number and opposite decisions. Kelly needs
  // the payoff ratio, and the payoff ratio cannot be recovered from the
  // aggregates afterwards — two unknowns, one equation — so the magnitudes are
  // accumulated here, where each trade's P&L is actually known.
  let winReturn = 0;
  let lossReturn = 0;

  for (let i = 0; i < n; i++) {
    const lagged = i > 0 ? pos[i - 1] : 0; // execute next bar
    const turnover = Math.abs(lagged - prevLagged);

    if (turnover > 0) {
      turnoverTotal += turnover;
      feesUsd += turnover * cost * eq * 100_000;
      if (inTrade) {
        trades += 1;
        const pnl = eq / tradeEntryEquity - 1;
        if (eq > tradeEntryEquity) {
          wins += 1;
          winReturn += pnl;
        } else {
          lossReturn -= pnl; // carried as a positive magnitude
        }
        inTrade = false;
      }
      if (lagged !== 0) {
        inTrade = true;
        tradeEntryEquity = eq;
      }
    }

    // Charged on the position actually held this bar, not on the signal —
    // funding accrues to whoever is carrying the exposure, and the exposure is
    // the lagged position for exactly the reason the returns use it.
    const holding = chargesHolding ? holdingCost(model, lagged, req.interval) : 0;
    holdingDrag += holding;
    if (holding > 0) feesUsd += holding * eq * 100_000;

    const r = lagged * pxRet[i] - turnover * cost - holding;
    returns[i] = r;
    eq *= 1 + r;
    equity[i] = eq;
    prevLagged = lagged;
  }
  if (inTrade) {
    trades += 1;
    const pnl = eq / tradeEntryEquity - 1;
    if (eq > tradeEntryEquity) {
      wins += 1;
      winReturn += pnl;
    } else {
      lossReturn -= pnl;
    }
  }

  const totalReturn = equity[n - 1] - 1;
  const years = n / ann;
  const cagr =
    years > 0 && totalReturn > -1 ? Math.pow(1 + totalReturn, 1 / years) - 1 : 0;
  const mdd = maxDrawdown(equity);

  // Exposure is measured on the *lagged* (executed) position, not the signal —
  // the bar a signal appears on is not a bar you were in the market.
  let barsInPosition = 0;
  for (let i = 1; i < n; i++) if (pos[i - 1] !== 0) barsInPosition++;

  return {
    result: {
      fast,
      slow,
      totalReturn,
      cagr,
      sharpe: annualisedSharpe(returns, ann),
      sortino: sortino(returns, ann),
      maxDrawdown: mdd,
      calmar: mdd < 0 ? cagr / Math.abs(mdd) : 0,
      winRate: trades ? wins / trades : 0,
      trades,
      avgWin: wins ? winReturn / wins : 0,
      avgLoss: trades - wins ? lossReturn / (trades - wins) : 0,
      exposure: barsInPosition / n,
      turnover: turnoverTotal,
      feesPaid: feesUsd,
    },
    equity,
    returns,
    position: pos,
    holdingDrag,
  };
}

// --------------------------------------------------------------------------- //
// Grid
// --------------------------------------------------------------------------- //
export function paramGrid(req: SweepRequest): Array<[number, number]> {
  const combos: Array<[number, number]> = [];
  for (let f = req.fastMin; f <= req.fastMax; f += req.fastStep) {
    for (let s = req.slowMin; s <= req.slowMax; s += req.slowStep) {
      if (f < s) combos.push([f, s]);
    }
  }
  if (combos.length > MAX_COMBOS) {
    const step = Math.ceil(combos.length / MAX_COMBOS);
    return combos.filter((_, i) => i % step === 0);
  }
  return combos;
}

function columns(bars: Bar[]) {
  const n = bars.length;
  const close = new Float64Array(n);
  const high = new Float64Array(n);
  const low = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    close[i] = bars[i].c;
    high[i] = bars[i].h;
    low[i] = bars[i].l;
  }
  return { close, high, low, pxRet: pctChange(close) };
}

// --------------------------------------------------------------------------- //
// Walk-forward
// --------------------------------------------------------------------------- //
function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}

export function walkForward(
  bars: Bar[],
  combos: Array<[number, number]>,
  req: SweepRequest,
  adv = 0,
): { folds: WalkForwardFold[]; oosSharpe: number | null } {
  const folds = Math.max(2, Math.min(req.folds, 10));
  const seg = Math.floor(bars.length / (folds + 1));
  if (seg < 100) return { folds: [], oosSharpe: null };

  const out: WalkForwardFold[] = [];
  const oosReturns: number[] = [];

  for (let i = 0; i < folds; i++) {
    const train = bars.slice(i * seg, (i + 1) * seg);
    const test = bars.slice((i + 1) * seg, (i + 2) * seg);
    if (test.length < 50) break;

    const tr = columns(train);
    let bestIs = combos[0];
    let bestSharpe = -Infinity;
    for (const [f, s] of combos) {
      const { result } = runCombo(train, tr.close, tr.high, tr.low, tr.pxRet, req, f, s, adv);
      if (result.sharpe > bestSharpe) {
        bestSharpe = result.sharpe;
        bestIs = [f, s];
      }
    }

    const te = columns(test);
    const oos = runCombo(test, te.close, te.high, te.low, te.pxRet, req, bestIs[0], bestIs[1], adv);
    for (let k = 0; k < oos.returns.length; k++) oosReturns.push(oos.returns[k]);

    out.push({
      fold: i + 1,
      trainStart: isoDay(train[0].t),
      trainEnd: isoDay(train[train.length - 1].t),
      testStart: isoDay(test[0].t),
      testEnd: isoDay(test[test.length - 1].t),
      chosenFast: bestIs[0],
      chosenSlow: bestIs[1],
      isSharpe: bestSharpe,
      oosSharpe: oos.result.sharpe,
      oosReturn: oos.result.totalReturn,
    });
  }

  const agg = oosReturns.length
    ? annualisedSharpe(Float64Array.from(oosReturns), barsPerYear(req.interval))
    : null;
  return { folds: out, oosSharpe: agg };
}

// --------------------------------------------------------------------------- //
// Orchestration
// --------------------------------------------------------------------------- //
export function runSweep(
  bars: Bar[],
  req: SweepRequest,
  dataSource: "binance" | "synthetic",
  warnings: string[] = [],
): SweepResponse {
  const t0 = Date.now();
  const combos = paramGrid(req);
  if (!combos.length) throw new Error("Empty parameter grid — fast must be less than slow.");
  if (bars.length < 200) throw new Error(`Not enough data: ${bars.length} bars.`);

  const { close, high, low, pxRet } = columns(bars);
  const ann = barsPerYear(req.interval);

  // Sized once on the whole series and reused for every combination and every
  // walk-forward slice. Recomputing it per slice would make an order's modelled
  // impact depend on which fold it landed in, so two identical trades would be
  // charged differently for a reason that has nothing to do with the trade.
  const adv = averageDailyVolume(bars, req.interval);

  const runs: ComboRun[] = combos.map(([f, s]) =>
    runCombo(bars, close, high, low, pxRet, req, f, s, adv),
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
  const { dsr, psr, expectedMax } = deflatedSharpe(
    candidates,
    srPerBar,
    bestRun.returns.length,
    skewness(bestRun.returns),
    kurtosis(bestRun.returns),
  );

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
  let peak = -Infinity;
  const ddArr = new Float64Array(bars.length);
  for (let i = 0; i < bars.length; i++) {
    if (bestRun.equity[i] > peak) peak = bestRun.equity[i];
    ddArr[i] = bestRun.equity[i] / peak - 1;
  }
  for (let i = 0; i < bars.length; i += step) {
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
    combosTested: results.length,
    durationMs: Date.now() - t0,
    best,
    benchmark: {
      totalReturn: bhEquity[bars.length - 1] - 1,
      sharpe: annualisedSharpe(pxRet, ann),
      maxDrawdown: maxDrawdown(bhEquity),
    },
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
  };
}
