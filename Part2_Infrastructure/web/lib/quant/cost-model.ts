import {
  BARS_PER_YEAR,
  type Bar,
  type CellKind,
  type FoldEfficiency,
  type MonthlyReturn,
  type ParamResult,
  type PromotionCheck,
  type PromotionGate,
  type Regression,
  type StabilityCell,
  type StabilityReport,
  type TailReport,
  type Verdict,
  type WalkForwardFold,
  type WalkForwardReport,
} from "../types";
import { barsPerYear } from "./common";

// --------------------------------------------------------------------------
// Cost model
// --------------------------------------------------------------------------

export interface CostModel {
  /** Flat exchange fee, basis points of traded notional. */
  feeBps: number;
  /** Flat slippage, basis points of traded notional. */
  slippageBps: number;
  /**
   * Square-root market-impact coefficient.
   *
   * `impact_bps = coefficient × 10⁴ × √(orderNotional / ADV)`. Zero disables it,
   * which is the default — so an unconfigured run produces exactly the numbers
   * the parity fixture pins.
   */
  impactCoefficient: number;
  /** Order notional used to size market impact, in quote currency. */
  orderNotional: number;
  /** Perpetual funding, bps per 8h, charged on absolute exposure. */
  fundingBpsPer8h: number;
  /** Annual borrow cost on short exposure, in bps. */
  borrowBpsAnnual: number;
}

export const NO_FRICTIONS: Pick<
  CostModel,
  "impactCoefficient" | "orderNotional" | "fundingBpsPer8h" | "borrowBpsAnnual"
> = {
  impactCoefficient: 0,
  orderNotional: 0,
  fundingBpsPer8h: 0,
  borrowBpsAnnual: 0,
};

/** Hours represented by one bar, for converting a funding rate to a per-bar drag. */
export const HOURS_PER_BAR: Record<string, number> = {
  "1m": 1 / 60, "5m": 1 / 12, "15m": 0.25, "30m": 0.5,
  "1h": 1, "2h": 2, "4h": 4, "1d": 24, "1w": 168,
};

export function hoursPerBar(interval: string): number {
  return HOURS_PER_BAR[interval] ?? 8760 / (barsPerYear(interval) || 8760);
}

/**
 * Per-unit-turnover cost in fractional terms, including square-root impact.
 *
 * The impact law is `k·√(Q/ADV)`, the standard concave form: doubling order size
 * costs about 1.41×, not 2×, because a larger order is worked over more of the
 * book. It is a *model*, not a measurement — the UI says so, because a slippage
 * figure a researcher chose is an assumption they are making, not a fact the
 * backtest discovered.
 */
export function turnoverCost(model: CostModel, adv: number): number {
  const flat = (model.feeBps + model.slippageBps) / 1e4;
  if (model.impactCoefficient <= 0 || model.orderNotional <= 0 || adv <= 0) return flat;
  const participation = Math.min(1, model.orderNotional / adv);
  return flat + model.impactCoefficient * Math.sqrt(participation);
}

/** Per-bar holding cost as a fraction of equity, for a given signed position. */
export function holdingCost(model: CostModel, position: number, interval: string): number {
  if (position === 0) return 0;
  const hours = hoursPerBar(interval);
  const funding = (model.fundingBpsPer8h / 1e4) * (hours / 8) * Math.abs(position);
  const borrow = position < 0
    ? (model.borrowBpsAnnual / 1e4) * (hours / 8760) * Math.abs(position)
    : 0;
  return funding + borrow;
}

/** Average daily volume in quote currency, from the bar series. */
export function averageDailyVolume(bars: Bar[], interval: string): number {
  if (!bars.length) return 0;
  const barsPerDay = 24 / hoursPerBar(interval);
  let quoteVolume = 0;
  for (const bar of bars) quoteVolume += bar.v * bar.c;
  return (quoteVolume / bars.length) * barsPerDay;
}
