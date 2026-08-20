/**
 * The sweep wire contract: what the browser asks for and what the route
 * answers with.
 *
 * Split out of `lib/types.ts` when that file passed 790 lines. Everything here
 * is serialised across the API boundary, so a change to a field name is a
 * protocol change and the parity fixtures pin the Python reference to it.
 *
 * The report shapes nested inside `SweepResponse` live in `./analytics`. That
 * import is type-only in both directions — `analytics.ts` needs
 * `WalkForwardFold` from here — so the cycle is erased at compile time and no
 * module-scope cycle reaches the bundler.
 */

import type { BenchmarkComparison } from "../benchmark";
import type { Strategy } from "./strategies";
import type {
  CostSummary,
  FactorReport,
  PromotionGate,
  StabilityReport,
  TailReport,
  WalkForwardReport,
} from "./analytics";

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
   * An external instrument to measure alpha and beta against.
   *
   * Optional, and its absence is not a default: when unset the response's
   * `benchmarkComparison` is null and the UI says the comparison was not
   * requested, rather than quietly substituting one. The same-symbol
   * buy-and-hold comparison in `benchmark` is unaffected either way — the two
   * answer different questions and both stay.
   */
  benchmarkSymbol?: string;
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
  "bybit",
  "binance",
  "fmp",
  "tiingo",
  "massive",
  "alphavantage",
  "openbb",
  "synthetic",
] as const;
export type DataSource = (typeof DATA_SOURCES)[number];

/**
 * Did these bars come from a measurement, as opposed to a generator?
 *
 * The one distinction risk maths is allowed to care about. A covariance, a VaR
 * or an ADV computed on the synthetic fallback is an invented number wearing a
 * measured one's clothes — but WHICH real venue or vendor answered is a
 * latency preference, not a data-quality tier, and code has no business
 * branching on it.
 *
 * This predicate exists because that rule was once written as
 * `source !== "binance"` — an allowlist of the only venue that existed when
 * the line was written. The day a second venue started serving bars, the Risk
 * tab silently dropped every crypto symbol from the covariance and reported
 * "not enough price history" for a book with four hundred real observations
 * behind it. Green tests, plausible message, wrong claim — the house defect.
 * A named predicate over the closed union is how the intent survives the next
 * venue.
 */
export function isMeasuredSource(source: unknown): source is Exclude<DataSource, "synthetic"> {
  return typeof source === "string"
    && source !== "synthetic"
    && (DATA_SOURCES as readonly string[]).includes(source);
}

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
  /** Buy-and-hold on the SAME symbol — "did the timing add anything". */
  benchmark: { totalReturn: number; sharpe: number; maxDrawdown: number };
  /**
   * Alpha, beta and tracking error against an external instrument.
   *
   * Null for three distinguishable reasons, all of which the panel names: no
   * benchmark was requested, the benchmark's bars could not be loaded, or fewer
   * than `MIN_ALIGNED_BARS` timestamps survived the join. The third is the one
   * worth surfacing — two vendors on different bar conventions produce an empty
   * intersection, and an empty intersection through a regression looks like a
   * missing feature rather than a data problem.
   */
  benchmarkComparison?: BenchmarkComparison | null;
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
  /**
   * The winner's realised per-bar returns — the exact driver distribution the
   * band resampled, shipped so the Risk tab's terminal-distribution Monte
   * Carlo runs on the same drivers in a worker. Plain array, not Float64Array:
   * typed arrays serialise to objects (same reason as MonteCarloBands).
   * Optional so cached older payloads stay valid during a rolling deploy.
   */
  bestRunReturns?: number[];
  /** Performance conditioned on market regime — where the returns came from. */
  regimes: RegimeReport;
  /** Build identity of the code that ran the sweep; stamped by the route. */
  commit?: string;
  /**
   * Present and true only on the committed seed run the landing page shows
   * before the live sweep completes. Never set by the route.
   */
  seededDemo?: true;
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

export const INTERVALS = ["15m", "1h", "4h", "1d"] as const;

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
