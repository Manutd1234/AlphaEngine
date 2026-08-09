/** Shared contracts between the API routes and the UI. */

export type Strategy =
  | "ma_cross"
  | "ema_cross"
  | "macd_cross"
  | "donchian"
  | "donchian_mid"
  | "breakout_sma"
  | "rsi_reversion"
  | "williams_r"
  | "stochastic"
  | "momentum"
  | "roc_trend"
  | "triple_ma"
  | "ppo_cross"
  | "trix_cross"
  | "rsi_trend"
  | "price_channel"
  | "ema_slope"
  | "bollinger_breakout"
  | "zscore_reversion"
  | "atr_breakout"
  | "keltner_breakout"
  | "supertrend"
  | "atr_trailing_stop"
  | "obv_trend"
  | "volume_breakout"
  | "mfi_reversion";

/**
 * Families, for grouping the picker.
 *
 * Every strategy here takes exactly two integer parameters, which is why they
 * fit the existing request shape unchanged. That is not a coincidence — it is
 * the selection criterion. Models needing a third axis (Ichimoku) or a
 * non-integer one (Bollinger's standard-deviation multiple) are deliberately
 * held back until the request carries named parameters, because encoding a
 * 1.5x multiplier as the integer 15 makes a slider that lies about its units.
 */
export type StrategyFamily = "Trend" | "Breakout" | "Mean reversion" | "Momentum" | "Volume";

export const STRATEGY_FAMILY: Record<Strategy, StrategyFamily> = {
  ma_cross: "Trend",
  ema_cross: "Trend",
  macd_cross: "Trend",
  donchian: "Breakout",
  donchian_mid: "Breakout",
  breakout_sma: "Breakout",
  rsi_reversion: "Mean reversion",
  williams_r: "Mean reversion",
  stochastic: "Mean reversion",
  momentum: "Momentum",
  roc_trend: "Momentum",
  triple_ma: "Trend",
  ppo_cross: "Trend",
  trix_cross: "Trend",
  ema_slope: "Trend",
  price_channel: "Breakout",
  rsi_trend: "Momentum",
  bollinger_breakout: "Breakout",
  zscore_reversion: "Mean reversion",
  atr_breakout: "Breakout",
  keltner_breakout: "Breakout",
  supertrend: "Trend",
  atr_trailing_stop: "Trend",
  obv_trend: "Volume",
  volume_breakout: "Volume",
  mfi_reversion: "Volume",
};
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
  /**
   * Bars discarded between each training window and its test window.
   *
   * Adjacent folds leak: a 200-bar moving average evaluated on the first test
   * bar is mostly made of training bars, so an "out-of-sample" score is partly
   * in-sample. Optional and defaulting to 0, which reproduces the Python
   * reference exactly — the parity fixture pins that equivalence.
   */
  embargoBars?: number;

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
  /**
   * Where the in-sample winner placed out-of-sample among all combinations
   * scored on this fold. Rank 1 of 40 means the choice held up; rank 33 of 40
   * means the fold selected noise.
   */
  oosRank?: number;
  combosRanked?: number;
  embargoBars?: number;
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

/**
 * Which feed a sweep's prices came from.
 *
 * A closed union rather than a bare string, and every provider adapter's id is
 * a member. That is deliberate: a new adapter that can serve bars will not
 * compile until it is named here, and `marketdata-routing.test.ts` asserts the
 * two lists agree in both directions — so a vendor cannot start answering
 * backtests under a name the UI has never heard of.
 *
 * `synthetic` is a first-class member and always was: the fallback names
 * itself, so the run header and the banner have never disagreed about which
 * prices were real. The union was widened for the other half of that problem —
 * AAPL was routed to Binance's klines endpoint, which cannot ever answer it, so
 * an equity had exactly two reachable states, `synthetic` and `synthetic`.
 * Naming the four vendors that can serve equities is what gives the label
 * something to say.
 */
export const DATA_SOURCES = [
  "binance",
  "fmp",
  "tiingo",
  "massive",
  "alphavantage",
  "openbb",
  "synthetic",
] as const;
export type DataSource = (typeof DATA_SOURCES)[number];

export interface SweepResponse {
  request: SweepRequest;
  dataSource: DataSource;
  bars: number;
  periodStart: string;
  periodEnd: string;
  /**
   * Content hash of the bars this sweep ran on.
   *
   * A window is not a dataset: the same start and end can be a live pull, a
   * cached copy, or the synthetic fallback. Two results sharing this hash
   * provably saw the same prices. Mirrors `data_hash` on the Python reference.
   */
  dataHash?: string;
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
  /**
   * Minimum Track Record Length (Bailey & López de Prado) at `confidence`.
   * `vsZero` is the citable literature quantity — bars needed to prove
   * SR > 0. `vsSearchHurdle` benchmarks against the search's expected-max
   * Sharpe instead, matching the DSR narrative. `null` bars = the observed SR
   * does not exceed the benchmark, so no finite record suffices (JSON-safe
   * stand-in for Infinity).
   */
  minTrackRecord: {
    confidence: number;
    vsZero: MinTrackRecordEntry;
    vsSearchHurdle: MinTrackRecordEntry;
  };
  /** Bootstrap resampling envelope around the winner's equity curve. */
  monteCarlo: MonteCarloBands;
  /** Performance conditioned on market regime — where the returns came from. */
  regimes: RegimeReport;
  /** Build identity of the code that ran the sweep; stamped by the route. */
  commit?: string;
  /** Generator seed when dataSource is synthetic; null on real market data. */
  syntheticSeed?: number | null;
}

export interface MinTrackRecordEntry {
  bars: number | null;
  years: number | null;
  sufficient: boolean | null;
}

/**
 * Percentile envelopes of resampled equity paths, aligned 1:1 with `series`
 * (plain arrays, not Float64Array — typed arrays serialise to objects).
 * Stationary bootstrap so volatility clustering survives the resample; iid
 * would understate how wide the honest cone is.
 */
export interface MonteCarloBands {
  method: "stationary-bootstrap";
  seed: number;
  paths: number;
  meanBlockLength: number;
  p05: number[];
  p25: number[];
  p50: number[];
  p75: number[];
  p95: number[];
  terminal: { p05: number; p50: number; p95: number; probLoss: number };
}

/** Strategy performance over one regime's (non-contiguous) bars. */
export interface RegimeStat {
  regime: string;
  bars: number;
  /** Of the classified bars in this regime's group (trend or vol). */
  share: number;
  /** Annualised; null below ~20 bars, where the estimate is noise. */
  sharpe: number | null;
  totalReturn: number;
  /** Over the concatenated in-regime sub-equity — a diagnostic, not a
   *  historical drawdown (see RegimeReport.note). */
  maxDrawdown: number;
  winRate: number;
  exposure: number;
}

/** A named historical stress window, present even when the data misses it. */
export interface NamedWindowStat {
  id: string;
  label: string;
  covered: boolean;
  /** Fraction of the window's span that the loaded bars overlap, 0..1. */
  coverage: number;
  stat: RegimeStat | null;
}

export interface RegimeReport {
  trendLookback: number;
  deadband: number;
  volLookback: number;
  classifiedBars: number;
  totalBars: number;
  trend: RegimeStat[];
  vol: RegimeStat[];
  windows: NamedWindowStat[];
  note: string;
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
  /**
   * Probability of backtest overfitting: the fraction of folds whose in-sample
   * winner landed in the worse half of the same grid out-of-sample. A strategy
   * whose winners keep placing in the bottom half is being chosen by noise.
   * Null when no fold ranked its grid.
   */
  overfittingProbability: number | null;
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
  ema_cross: "EMA crossover",
  macd_cross: "MACD signal crossover",
  donchian: "Donchian breakout",
  donchian_mid: "Donchian mid-band",
  breakout_sma: "Trend-filtered breakout",
  rsi_reversion: "RSI mean reversion",
  williams_r: "Williams %R reversion",
  stochastic: "Stochastic oscillator",
  momentum: "Momentum (skip-recent)",
  roc_trend: "Rate of change with trend filter",
  triple_ma: "Triple moving average",
  ppo_cross: "Percentage price oscillator",
  trix_cross: "TRIX signal crossover",
  rsi_trend: "RSI trend continuation",
  bollinger_breakout: "Bollinger band breakout",
  zscore_reversion: "Z-score mean reversion",
  price_channel: "Price channel breakout",
  ema_slope: "EMA slope",
  atr_breakout: "ATR breakout",
  keltner_breakout: "Keltner channel breakout",
  supertrend: "Supertrend",
  atr_trailing_stop: "ATR trailing stop (chandelier)",
  obv_trend: "On-balance volume trend",
  volume_breakout: "Volume-confirmed breakout",
  mfi_reversion: "Money-flow index reversion",
};

/** What `fast` and `slow` actually mean for each model — shown in the UI so the
 *  sliders are not two unlabelled numbers. */
export const PARAM_MEANING: Record<Strategy, { fast: string; slow: string }> = {
  ma_cross: { fast: "Fast SMA period", slow: "Slow SMA period" },
  ema_cross: { fast: "Fast EMA span", slow: "Slow EMA span" },
  macd_cross: { fast: "Fast EMA span", slow: "Slow EMA span" },
  donchian: { fast: "Breakout lookback", slow: "Trailing-exit lookback" },
  donchian_mid: { fast: "Channel lookback", slow: "Exit SMA period" },
  breakout_sma: { fast: "Breakout lookback", slow: "Trend-filter SMA period" },
  rsi_reversion: { fast: "RSI period", slow: "Trend-filter SMA period" },
  williams_r: { fast: "%R lookback", slow: "Exit SMA period" },
  stochastic: { fast: "%K lookback", slow: "%D smoothing" },
  momentum: { fast: "Bars skipped (recent)", slow: "Momentum lookback" },
  roc_trend: { fast: "Rate-of-change lookback", slow: "Trend-filter SMA period" },
  triple_ma: { fast: "Fast SMA period", slow: "Slow SMA period" },
  ppo_cross: { fast: "Fast EMA span", slow: "Slow EMA span" },
  trix_cross: { fast: "TRIX EMA span", slow: "Signal SMA period" },
  rsi_trend: { fast: "RSI period", slow: "Trend-filter SMA period" },
  bollinger_breakout: { fast: "Band SMA period", slow: "Band width (σ)" },
  zscore_reversion: { fast: "Z-score lookback", slow: "Entry threshold (σ)" },
  price_channel: { fast: "Breakout lookback", slow: "Exit-channel lookback" },
  ema_slope: { fast: "EMA span", slow: "Slope lookback (bars)" },
  atr_breakout: { fast: "ATR period", slow: "Breakout size (ATRs)" },
  keltner_breakout: { fast: "EMA & ATR period", slow: "Channel width (ATRs)" },
  supertrend: { fast: "ATR period", slow: "Band distance (ATRs)" },
  atr_trailing_stop: { fast: "ATR & trend period", slow: "Stop distance (ATRs)" },
  obv_trend: { fast: "OBV smoothing period", slow: "Unused (kept for grid shape)" },
  volume_breakout: { fast: "Breakout lookback", slow: "Volume average period" },
  mfi_reversion: { fast: "MFI period", slow: "Exit SMA period" },
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
  ema_cross: { fast: "Fast EMA", slow: "Slow EMA" },
  // MACD and the oscillators live on their own scale; drawing them against
  // price would flatten the price axis into a line.
  macd_cross: { fast: null, slow: "Slow EMA" },
  donchian: { fast: "Breakout high", slow: "Trailing low" },
  donchian_mid: { fast: "Channel high", slow: "Exit SMA" },
  breakout_sma: { fast: "Breakout high", slow: "Trend SMA" },
  rsi_reversion: { fast: null, slow: "Trend SMA" },
  williams_r: { fast: null, slow: "Exit SMA" },
  stochastic: { fast: null, slow: "Exit SMA" },
  momentum: { fast: null, slow: "Lookback SMA" },
  roc_trend: { fast: null, slow: "Trend SMA" },
  triple_ma: { fast: "Fast SMA", slow: "Slow SMA" },
  ppo_cross: { fast: null, slow: "Slow EMA" },
  trix_cross: { fast: null, slow: "TRIX signal" },
  rsi_trend: { fast: null, slow: "Trend SMA" },
  bollinger_breakout: { fast: "Upper band", slow: "Band mid" },
  zscore_reversion: { fast: null, slow: "Rolling mean" },
  price_channel: { fast: "Channel high", slow: "Channel low" },
  ema_slope: { fast: null, slow: "EMA" },
  atr_breakout: { fast: null, slow: "Prior close" },
  keltner_breakout: { fast: "Upper channel", slow: "Channel mid" },
  supertrend: { fast: "Upper band", slow: "Lower band" },
  atr_trailing_stop: { fast: "Trailing stop", slow: "Trend SMA" },
  obv_trend: { fast: null, slow: "OBV average" },
  volume_breakout: { fast: "Breakout high", slow: "Trend SMA" },
  mfi_reversion: { fast: null, slow: "Exit SMA" },
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
