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
