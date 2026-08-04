/** Shared contracts between the API routes and the UI. */

export type Strategy = "ma_cross" | "donchian" | "rsi_reversion";
export type Direction = "long_only" | "long_short";

export interface Bar {
  t: number; // ms epoch
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface SweepRequest {
  symbol: string;
  interval: string;
  bars: number;
  strategy: Strategy;
  fastMin: number;
  fastMax: number;
  fastStep: number;
  slowMin: number;
  slowMax: number;
  slowStep: number;
  feeBps: number;
  slippageBps: number;
  direction: Direction;
  folds: number;
  walkForward: boolean;

  // ---- microstructure frictions ------------------------------------------
  // All optional and all defaulting to zero, so an unconfigured request is
  // arithmetically identical to the flat-cost model the Python engine
  // implements and the parity fixture pins. Switching one on is an explicit
  // choice by the researcher, and the UI labels the results as a *model* rather
  // than as something the backtest discovered.

  /** Square-root impact coefficient: `impact = k·√(orderNotional / ADV)`. */
  impactCoefficient?: number;
  /** Order notional used to size market impact, in quote currency. */
  orderNotional?: number;
  /** Perpetual funding, bps per 8h, charged on absolute exposure. */
  fundingBpsPer8h?: number;
  /** Annual borrow cost charged on short exposure, in bps. */
  borrowBpsAnnual?: number;
}

export interface ParamResult {
  fast: number;
  slow: number;
  totalReturn: number;
  cagr: number;
  sharpe: number;
  sortino: number;
  maxDrawdown: number;
  calmar: number;
  winRate: number;
  trades: number;
  /** Mean return of a winning trade, as a fraction. 0 when there were none. */
  avgWin: number;
  /** Mean return of a losing trade, as a positive magnitude. 0 when none. */
  avgLoss: number;
  exposure: number;
  turnover: number;
  feesPaid: number;
}

export interface WalkForwardFold {
  fold: number;
  trainStart: string;
  trainEnd: string;
  testStart: string;
  testEnd: string;
  chosenFast: number;
  chosenSlow: number;
  isSharpe: number;
  oosSharpe: number;
  oosReturn: number;
}

export interface SeriesPoint {
  t: number;
  close: number;
  fast: number | null;
  slow: number | null;
  position: number;
  equity: number;
  buyHold: number;
  drawdown: number;
}

export interface SweepResponse {
  request: SweepRequest;
  dataSource: "binance" | "synthetic";
  bars: number;
  periodStart: string;
  periodEnd: string;
  combosTested: number;
  durationMs: number;
  best: ParamResult;
  benchmark: { totalReturn: number; sharpe: number; maxDrawdown: number };
  results: ParamResult[];
  topResults: ParamResult[];
  deflatedSharpeRatio: number;
  probabilisticSharpeRatio: number;
  expectedMaxSharpe: number;
  verdict: {
    level: "pass" | "marginal" | "fail";
    headline: string;
    detail: string;
  };
  walkForward: WalkForwardFold[];
  walkForwardOosSharpe: number | null;
  series: SeriesPoint[];
  warnings: string[];

  // ---- research analytics -------------------------------------------------
  // Additive: `runCombo` and every field above are untouched, so the parity
  // fixture still pins the engine against the Python reference.

  /** Neighbourhood classification of every grid point — plateau vs cliff. */
  stability: StabilityReport;
  /** Per-fold walk-forward efficiency and parameter drift. */
  walkForwardReport: WalkForwardReport;
  /** Regression of strategy returns on single-instrument time-series factors. */
  factors: FactorReport | null;
  /** Loss-tail statistics, monthly grid and annualised turnover. */
  tail: TailReport;
  /** The veto list a candidate must clear before execution hand-off. */
  promotion: PromotionGate;
  /** What the cost model actually charged, so an assumption is never invisible. */
  costs: CostSummary;
}

// ---------------------------------------------------------------------------
// Research analytics contracts
//
// Defined here rather than in `lib/quant.ts` because they cross the API
// boundary: the route serialises them and the browser deserialises them, so
// they are contract, not implementation. `quant.ts` imports them back.
// ---------------------------------------------------------------------------

/** How a grid point behaves relative to its tested neighbours. */
export type CellKind = "plateau" | "slope" | "cliff" | "dead" | "isolated";

export interface StabilityCell {
  fast: number;
  slow: number;
  sharpe: number;
  /** Grid-adjacent combinations that were actually tested (up to 8). */
  neighbours: number;
  neighbourMean: number;
  neighbourMin: number;
  /** neighbourMean / sharpe — how much of the cell's edge the area retains. */
  retention: number | null;
  kind: CellKind;
}

export interface StabilityReport {
  cells: StabilityCell[];
  best: StabilityCell | null;
  plateauCount: number;
  cliffCount: number;
  classified: number;
  verdict: Verdict;
}

export interface Verdict {
  level: "pass" | "marginal" | "fail";
  headline: string;
  detail: string;
}

export interface FoldEfficiency extends WalkForwardFold {
  /** OOS Sharpe as a fraction of IS Sharpe. Null when IS was not positive. */
  efficiency: number | null;
  /** Grid-step distance from the previous fold's chosen parameters. */
  paramDrift: number | null;
}

export interface WalkForwardReport {
  folds: FoldEfficiency[];
  medianEfficiency: number | null;
  positiveFolds: number;
  totalFolds: number;
  /** Fraction of folds that re-selected the previous fold's parameters. */
  parameterPersistence: number | null;
  verdict: Verdict;
}

export interface FactorLoading {
  name: string;
  beta: number;
  tStat: number;
  pValue: number;
}

export interface Regression {
  n: number;
  alpha: number;
  alphaAnnualised: number;
  alphaTStat: number;
  alphaPValue: number;
  loadings: FactorLoading[];
  rSquared: number;
  adjRSquared: number;
  idiosyncraticShare: number;
  informationRatio: number;
  collinearity: { a: string; b: string; corr: number }[];
}

export interface FactorReport {
  regression: Regression;
  /** One line per factor saying exactly what it is, so nothing is implied. */
  descriptions: string[];
  lookback: number;
  /** Stated in the payload, not just in the UI copy — see `lib/quant.ts`. */
  note: string;
}

export interface MonthlyReturn {
  month: string;
  year: number;
  monthIndex: number;
  return: number;
  bars: number;
}

export interface TailReport {
  var95: number;
  var99: number;
  cvar95: number;
  cvar99: number;
  tailRatio: number;
  bestBar: number;
  worstBar: number;
  positiveBars: number;
  totalBars: number;
  maxLosingStreak: number;
  ulcerIndex: number;
  monthly: MonthlyReturn[];
  annualisedTurnover: number;
}

export interface PromotionCheck {
  id: string;
  label: string;
  value: string;
  hurdle: string;
  passed: boolean;
  why: string;
}

export interface PromotionGate {
  checks: PromotionCheck[];
  passed: number;
  total: number;
  eligible: boolean;
}

export interface CostSummary {
  /** Flat fee + slippage, in basis points of traded notional. */
  flatBps: number;
  /** Average daily quote volume the impact model was sized against. */
  averageDailyVolume: number;
  /** Modelled impact in bps at the configured order size; 0 when disabled. */
  impactBps: number;
  /** Fraction of ADV a single order represents; 0 when impact is disabled. */
  participation: number;
  fundingBpsPer8h: number;
  borrowBpsAnnual: number;
  /** True when every friction beyond flat fee/slippage is switched off. */
  flatOnly: boolean;
}

export const INTERVALS = ["15m", "1h", "4h", "1d"] as const;

export const STRATEGY_LABELS: Record<Strategy, string> = {
  ma_cross: "Moving-average crossover",
  donchian: "Donchian breakout",
  rsi_reversion: "RSI mean reversion",
};

/** What `fast` and `slow` actually mean for each model — shown in the UI so the
 *  sliders are not two unlabelled numbers. */
export const PARAM_MEANING: Record<Strategy, { fast: string; slow: string }> = {
  ma_cross: { fast: "Fast SMA period", slow: "Slow SMA period" },
  donchian: { fast: "Breakout lookback", slow: "Trailing-exit lookback" },
  rsi_reversion: { fast: "RSI period", slow: "Trend-filter SMA period" },
};

/**
 * What the two overlay lines on the price chart actually ARE, per strategy.
 *
 * Distinct from `PARAM_MEANING`: a parameter is a lookback, the plotted line is
 * the level that lookback produces. `fast: null` means the model has no second
 * price-scale line worth drawing (RSI lives on 0-100, so plotting it would
 * collapse the price axis).
 */
export const CHART_SERIES: Record<Strategy, { fast: string | null; slow: string }> = {
  ma_cross: { fast: "Fast SMA", slow: "Slow SMA" },
  donchian: { fast: "Breakout high", slow: "Trailing low" },
  rsi_reversion: { fast: null, slow: "Trend SMA" },
};

export const BARS_PER_YEAR: Record<string, number> = {
  "1m": 525_600,
  "5m": 105_120,
  "15m": 35_040,
  "30m": 17_520,
  "1h": 8_760,
  "2h": 4_380,
  "4h": 2_190,
  "1d": 365,
  "1w": 52,
};

export const DEFAULT_REQUEST: SweepRequest = {
  symbol: "BTCUSDT",
  interval: "4h",
  bars: 2000,
  strategy: "ma_cross",
  fastMin: 5,
  fastMax: 40,
  fastStep: 5,
  slowMin: 20,
  slowMax: 200,
  slowStep: 20,
  feeBps: 6,
  slippageBps: 2,
  direction: "long_only",
  folds: 4,
  walkForward: true,
};

export const MAX_COMBOS = 400;
