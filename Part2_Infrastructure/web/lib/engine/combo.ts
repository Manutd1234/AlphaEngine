/**
 * One parameter combination, priced.
 *
 * The accounting half of the engine: a strategy's long/flat state becomes a
 * position, the position becomes returns net of turnover and holding cost, and
 * the returns become the row a sweep ranks. Every convention in here is shared
 * with `modules/backtester/engines.py` and pinned by `tests/parity.test.ts`.
 */

import { holdingCost, turnoverCost, type CostModel } from "../quant";
import { longState } from "../strategies";
import {
  type Bar,
  type Direction,
  type ParamResult,
  type Strategy,
  type SweepRequest,
} from "../types";
import { annualisedSharpe, barsPerYear, maxDrawdown, sortino } from "./metrics";

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
  volume: Float64Array,
  fast: number,
  slow: number,
  direction: Direction,
): Float64Array {
  const n = close.length;
  const pos = new Float64Array(n);
  const flat = direction === "long_short" ? -1 : 0;
  const isLong = longState(strategy, close, high, low, volume, fast, slow);

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
  volume: Float64Array,
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

  const pos = buildPosition(req.strategy, bars, close, high, low, volume, fast, slow, req.direction);

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
