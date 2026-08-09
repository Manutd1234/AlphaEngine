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

import { ema, pctChange, rollingMax, rollingMin, rollingStd, rsi, shift1, sma } from "./indicators";
import { monteCarloBands } from "./montecarlo";
import { regimeReport } from "./regimes";
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
  minTrackRecordLength,
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

/**
 * A stable fingerprint of the bars a sweep ran on.
 *
 * Not a cryptographic hash — this runs in a serverless function on every sweep
 * and its only job is to answer "were these the same bars?". FNV-1a over the
 * closes plus the window bounds collides far too rarely to matter for a
 * comparison the researcher can also verify by eye, and costs one pass.
 *
 * Deliberately NOT expected to equal the Python `data_hash`: the two engines
 * fingerprint their own inputs, which arrive over different transports with
 * different float formatting. What each guarantees is internal consistency —
 * two runs *in the same engine* on the same bars agree.
 */
export function datasetFingerprint(bars: Bar[]): string {
  let hash = 0x811c9dc5;
  const mix = (value: number) => {
    hash ^= value >>> 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };
  for (const bar of bars) {
    // Six decimals: enough to separate real revisions, coarse enough that a
    // float round-trip through JSON does not change the answer.
    mix(Math.round(bar.c * 1e6));
  }
  mix(bars.length);
  mix(bars[0]?.t ?? 0);
  mix(bars[bars.length - 1]?.t ?? 0);
  return hash.toString(16).padStart(8, "0");
}

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

  if (strategy === "ema_cross") {
    const f = ema(close, fast);
    const s = ema(close, slow);
    for (let i = 0; i < n; i++) out[i] = f[i] > s[i] ? 1 : 0;
    return out;
  }

  if (strategy === "macd_cross") {
    // Signal fixed at the conventional 9: the request carries two parameters,
    // and a third axis for a value nobody tunes multiplies every sweep by nine.
    const macd = new Float64Array(n);
    const f = ema(close, fast);
    const s = ema(close, slow);
    for (let i = 0; i < n; i++) macd[i] = f[i] - s[i];
    const signal = ema(macd, 9);
    for (let i = 0; i < n; i++) out[i] = macd[i] > signal[i] ? 1 : 0;
    return out;
  }

  if (strategy === "momentum") {
    // 12-1: return to `slow` bars ago, skipping the most recent `fast`, because
    // short-horizon reversal is the documented contaminant of momentum.
    for (let i = 0; i < n; i++) {
      if (i < slow) { out[i] = 0; continue; }
      const past = close[i - slow];
      const recent = close[i - fast];
      out[i] = past > 0 && recent / past - 1 > 0 ? 1 : 0;
    }
    return out;
  }

  if (strategy === "donchian_mid") {
    const upper = shift1(rollingMax(high, fast));
    const lower = shift1(rollingMin(low, fast));
    const exitMa = sma(close, slow);
    let state = 0;
    for (let i = 0; i < n; i++) {
      const mid = (upper[i] + lower[i]) / 2;
      if (!Number.isNaN(mid) && close[i] > mid) state = 1;
      if (!Number.isNaN(exitMa[i]) && close[i] < exitMa[i]) state = 0; // exit overrides
      out[i] = state;
    }
    return out;
  }

  if (strategy === "roc_trend") {
    const trend = sma(close, slow);
    for (let i = 0; i < n; i++) {
      if (i < fast || Number.isNaN(trend[i])) { out[i] = 0; continue; }
      const roc = close[i - fast] > 0 ? close[i] / close[i - fast] - 1 : NaN;
      out[i] = roc > 0 && close[i] > trend[i] ? 1 : 0;
    }
    return out;
  }

  if (strategy === "williams_r") {
    const highN = rollingMax(high, fast);
    const lowN = rollingMin(low, fast);
    const exitMa = sma(close, slow);
    let state = 0;
    for (let i = 0; i < n; i++) {
      const span = highN[i] - lowN[i];
      const wr = span > 0 ? (-100 * (highN[i] - close[i])) / span : NaN;
      if (!Number.isNaN(wr) && wr < -80) state = 1;
      if ((!Number.isNaN(wr) && wr > -20) || (!Number.isNaN(exitMa[i]) && close[i] < exitMa[i])) {
        state = 0; // exit overrides
      }
      out[i] = state;
    }
    return out;
  }

  if (strategy === "stochastic") {
    const highN = rollingMax(high, fast);
    const lowN = rollingMin(low, fast);
    const k = new Float64Array(n).fill(NaN);
    for (let i = 0; i < n; i++) {
      const span = highN[i] - lowN[i];
      if (span > 0) k[i] = (100 * (close[i] - lowN[i])) / span;
    }
    const d = sma(k, Math.max(2, slow));
    let state = 0;
    for (let i = 0; i < n; i++) {
      // Oversold arms the long; %D is the exit confirmation, not an entry gate.
      // `k < 20 && k > d` is the crossing instant and almost never coincides —
      // it took zero trades over 600 bars.
      if (!Number.isNaN(k[i]) && k[i] < 20) state = 1;
      if ((!Number.isNaN(k[i]) && k[i] > 80) || (!Number.isNaN(d[i]) && k[i] < d[i])) state = 0;
      out[i] = state;
    }
    return out;
  }

  if (strategy === "breakout_sma") {
    const upper = shift1(rollingMax(close, fast));
    const trend = sma(close, slow);
    let state = 0;
    for (let i = 0; i < n; i++) {
      if (!Number.isNaN(upper[i]) && !Number.isNaN(trend[i]) && close[i] > upper[i] && close[i] > trend[i]) {
        state = 1;
      }
      if (!Number.isNaN(trend[i]) && close[i] < trend[i]) state = 0; // exit overrides
      out[i] = state;
    }
    return out;
  }

  if (strategy === "triple_ma") {
    // Middle leg derived, not a third parameter: the geometric mean keeps the
    // three periods evenly spaced on a log scale at no extra sweep axis.
    const midPeriod = Math.max(2, Math.round(Math.sqrt(fast * slow)));
    const f = sma(close, fast);
    const m = sma(close, midPeriod);
    const sl = sma(close, slow);
    for (let i = 0; i < n; i++) out[i] = f[i] > m[i] && m[i] > sl[i] ? 1 : 0;
    return out;
  }

  if (strategy === "ppo_cross") {
    const fastEma = ema(close, fast);
    const slowEma = ema(close, slow);
    const ppo = new Float64Array(n).fill(NaN);
    for (let i = 0; i < n; i++) {
      if (slowEma[i] !== 0) ppo[i] = ((fastEma[i] - slowEma[i]) / slowEma[i]) * 100;
    }
    const signal = ema(ppo, 9);
    for (let i = 0; i < n; i++) out[i] = ppo[i] > signal[i] ? 1 : 0;
    return out;
  }

  if (strategy === "trix_cross") {
    const e3 = ema(ema(ema(close, fast), fast), fast);
    const trix = new Float64Array(n).fill(NaN);
    for (let i = 1; i < n; i++) {
      if (e3[i - 1] !== 0) trix[i] = (e3[i] / e3[i - 1] - 1) * 100;
    }
    const sig = sma(trix, Math.max(2, slow));
    for (let i = 0; i < n; i++) out[i] = trix[i] > sig[i] ? 1 : 0;
    return out;
  }

  if (strategy === "rsi_trend") {
    // Momentum reading of RSI — the opposite of rsi_reversion, deliberately
    // both in the catalogue: which is right is a property of the regime.
    const r = rsi(close, fast);
    const trend = sma(close, slow);
    for (let i = 0; i < n; i++) {
      out[i] = !Number.isNaN(r[i]) && r[i] > 55 && !Number.isNaN(trend[i]) && close[i] > trend[i] ? 1 : 0;
    }
    return out;
  }

  if (strategy === "price_channel") {
    const upper = shift1(rollingMax(close, fast));
    const lower = shift1(rollingMin(close, slow));
    let state = 0;
    for (let i = 0; i < n; i++) {
      if (!Number.isNaN(upper[i]) && close[i] >= upper[i]) state = 1;
      if (!Number.isNaN(lower[i]) && close[i] <= lower[i]) state = 0; // exit overrides
      out[i] = state;
    }
    return out;
  }

  if (strategy === "bollinger_breakout") {
    // `slow` is band width in standard deviations — a real float, swept
    // 1.0..3.0 by 0.25 from its own axis rather than borrowed from a period grid.
    const period = Math.max(2, Math.trunc(fast));
    const mid = sma(close, period);
    const sd = rollingStd(close, period);
    let state = 0;
    for (let i = 0; i < n; i++) {
      if (!Number.isNaN(mid[i]) && !Number.isNaN(sd[i]) && close[i] > mid[i] + sd[i] * slow) state = 1;
      if (!Number.isNaN(mid[i]) && close[i] < mid[i]) state = 0; // exit overrides
      out[i] = state;
    }
    return out;
  }

  if (strategy === "zscore_reversion") {
    const period = Math.max(2, Math.trunc(fast));
    const mean = sma(close, period);
    const sd = rollingStd(close, period);
    let state = 0;
    for (let i = 0; i < n; i++) {
      const z = sd[i] > 0 ? (close[i] - mean[i]) / sd[i] : NaN;
      if (!Number.isNaN(z) && z < -slow) state = 1;
      if (!Number.isNaN(z) && z > 0) state = 0; // exit overrides
      out[i] = state;
    }
    return out;
  }

  if (strategy === "ema_slope") {
    const e = ema(close, fast);
    for (let i = 0; i < n; i++) {
      out[i] = i >= slow && e[i] - e[i - slow] > 0 ? 1 : 0;
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
/**
 * Strategies whose SECOND parameter is not a lookback period.
 *
 * Must match `FREE_SECOND_AXIS` in `modules/backtester.py` — the two engines
 * are compared combination by combination, so a grid that differs is not a
 * disagreement about the model, it is the two of them answering about
 * different parameters entirely.
 *
 * The `f < s` filter is right when both axes are periods and nonsense
 * otherwise: a band width of 2.0σ against a 20-bar mean fails `20 < 2.0`, so
 * every combination was discarded and the strategy silently took no trades.
 */
const FREE_SECOND_AXIS: Partial<Record<Strategy, [number, number, number]>> = {
  bollinger_breakout: [1.0, 3.0, 0.25],
  zscore_reversion: [1.0, 3.0, 0.25],
};

/** Inclusive, float-safe: index multiplication rather than repeated addition,
 *  which at step 0.25 drifts to 2.7499999999999996 and shows the reader a
 *  different number than the slider they moved. */
function axis(low: number, high: number, step: number): number[] {
  if (step <= 0) return [low];
  const count = Math.floor((high - low) / step + 1e-9) + 1;
  return Array.from({ length: Math.max(1, count) }, (_, i) => Number((low + i * step).toFixed(10)));
}

export function paramGrid(req: SweepRequest): Array<[number, number]> {
  const combos: Array<[number, number]> = [];
  const free = FREE_SECOND_AXIS[req.strategy];
  const fasts = axis(req.fastMin, req.fastMax, req.fastStep);
  const slows = free ? axis(free[0], free[1], free[2]) : axis(req.slowMin, req.slowMax, req.slowStep);
  for (const f of fasts) {
    for (const s of slows) {
      if (free || f < s) combos.push([f, s]);
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
  // Taken out of the training window's tail rather than by shifting the test
  // window: shifting would walk the last fold off the end of the data and
  // quietly drop it. Mirrors `walk_forward` in the Python reference.
  const embargo = Math.max(0, Math.min(Math.trunc(req.embargoBars ?? 0), Math.max(0, seg - 50)));

  for (let i = 0; i < folds; i++) {
    const train = bars.slice(i * seg, (i + 1) * seg - embargo);
    const test = bars.slice((i + 1) * seg, (i + 2) * seg);
    if (test.length < 50 || train.length < 50) break;

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

    // Score the whole grid out-of-sample, not just the winner: one OOS Sharpe
    // cannot separate "this choice was right" from "this fold was easy for
    // everything". The winner's rank among its peers can.
    const te = columns(test);
    const oos = runCombo(test, te.close, te.high, te.low, te.pxRet, req, bestIs[0], bestIs[1], adv);
    for (let k = 0; k < oos.returns.length; k++) oosReturns.push(oos.returns[k]);

    const oosSharpes = combos.map(([f, s2]) => ({
      combo: [f, s2] as [number, number],
      sharpe: runCombo(test, te.close, te.high, te.low, te.pxRet, req, f, s2, adv).result.sharpe,
    }));
    oosSharpes.sort((a, b) => b.sharpe - a.sharpe);
    const rankIndex = oosSharpes.findIndex((e) => e.combo[0] === bestIs[0] && e.combo[1] === bestIs[1]);

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
      oosRank: rankIndex >= 0 ? rankIndex + 1 : undefined,
      combosRanked: oosSharpes.length,
      embargoBars: embargo,
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

  // Seeded off the data identity and the winning parameters: rerunning the
  // same sweep draws the same cone, a different winner draws a fresh one.
  const mcSeed =
    (parseInt(dataHash.slice(0, 8), 16) ^ Math.imul(best.fast, 0x9e3779b1) ^ best.slow) >>> 0;
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
    regimes,
  };
}
