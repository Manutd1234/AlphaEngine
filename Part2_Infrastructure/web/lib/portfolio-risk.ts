/**
 * Book-level risk — measured, not assumed.
 * ========================================
 *
 * The gateway is authoritative about *what the book is*: positions, notionals,
 * realised P&L, the limits that bind. It says nothing about how risky that book
 * is, because risk is a property of how the instruments move together, and the
 * gateway does not carry price history.
 *
 * So every covariance here comes from bars this app actually fetched. That
 * matters more than it sounds: a stress panel wired to hand-written betas will
 * produce confident numbers on a book it has never seen, and nothing on screen
 * distinguishes that from a real measurement. If the history is missing, the
 * functions below return `null` and the UI says so rather than substituting a
 * plausible constant.
 *
 * ── What is a model and what is a measurement ───────────────────────────────
 *  - Covariance, correlation, beta, historical VaR: **measured** from returns.
 *  - Parametric VaR/CVaR: **modelled** — it assumes normality, which crypto
 *    returns violate in exactly the tail the number is about. Both are reported
 *    side by side precisely so the gap is visible; when historical is materially
 *    worse than parametric, that gap *is* the fat tail.
 *  - Stress scenarios: **assumptions**, chosen by the person running them. The
 *    propagation to unshocked instruments uses a measured beta, but the shock
 *    itself is a hypothesis and is labelled as one.
 */

import { mean, stdev } from "./stats";
import { BARS_PER_YEAR } from "./types";

// --------------------------------------------------------------------------
// Inputs
// --------------------------------------------------------------------------

export interface RiskPosition {
  symbol: string;
  /** Signed: long positive, short negative. */
  signedNotional: number;
}

/** Daily (or per-bar) return series per symbol, aligned by index. */
export type ReturnsBySymbol = Record<string, number[]>;

// --------------------------------------------------------------------------
// Covariance
// --------------------------------------------------------------------------

export interface CovarianceModel {
  symbols: string[];
  /** Realised volatility per symbol, per bar. */
  vol: number[];
  /** Symmetric correlation matrix, symbols × symbols. */
  correlation: number[][];
  /** Symmetric covariance matrix, symbols × symbols. */
  covariance: number[][];
  /** Observations the estimate is built from — small n is a weak covariance. */
  observations: number;
}

function covariance(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let s = 0;
  for (let i = 0; i < n; i++) s += (a[i] - ma) * (b[i] - mb);
  return s / (n - 1);
}

/**
 * Covariance across the symbols actually held.
 *
 * Series are truncated to the shortest common length rather than padded. A
 * symbol with less history than the others would otherwise contribute zeros to
 * the overlap, which reads as *low* volatility and *no* correlation — the two
 * errors that both make a book look safer than it is.
 */
export function buildCovariance(
  symbols: string[],
  returns: ReturnsBySymbol,
): CovarianceModel | null {
  const usable = symbols.filter((s) => (returns[s]?.length ?? 0) >= 20);
  if (usable.length === 0) return null;

  const n = Math.min(...usable.map((s) => returns[s].length));
  if (n < 20) return null;

  // Align to the most recent `n` observations of each series.
  const series = usable.map((s) => returns[s].slice(-n));
  const vol = series.map((r) => stdev(r, 1));

  const cov = series.map((a) => series.map((b) => covariance(a, b)));
  const corr = cov.map((row, i) =>
    row.map((c, j) => {
      const d = vol[i] * vol[j];
      return d > 0 ? Math.max(-1, Math.min(1, c / d)) : 0;
    }),
  );

  return { symbols: usable, vol, correlation: corr, covariance: cov, observations: n };
}

// --------------------------------------------------------------------------
// Portfolio risk
// --------------------------------------------------------------------------

export interface RiskContribution {
  symbol: string;
  signedNotional: number;
  /** Share of gross notional. */
  weight: number;
  /** Standalone volatility, annualised. */
  standaloneVol: number;
  /**
   * Share of total portfolio volatility this position is responsible for.
   *
   * Not its share of the book. A hedged position can carry 30% of the notional
   * and *reduce* total risk, which shows here as a negative contribution and
   * nowhere else.
   */
  contribution: number;
  contributionShare: number;
}

export interface PortfolioRisk {
  /** Per-bar portfolio volatility, as a fraction of equity. */
  volatility: number;
  annualisedVolatility: number;
  /** Parametric 1-bar VaR at 95%/99%, in currency, positive = loss. */
  var95: number;
  var99: number;
  /** Parametric expected shortfall, in currency. */
  cvar95: number;
  /** Empirical VaR from replaying the book over history. Null without enough data. */
  historicalVar95: number | null;
  historicalCvar95: number | null;
  contributions: RiskContribution[];
  /** Largest pairwise correlation in the book — the diversification check. */
  worstCorrelation: { a: string; b: string; corr: number } | null;
  observations: number;
  /** Bars per year used to annualise. */
  annualisation: number;
}

/** z at 95% and 99% for a one-sided normal loss tail. */
const Z95 = 1.6448536269514722;
const Z99 = 2.3263478740408408;
/** E[Z | Z > z95] = φ(z95)/0.05 — the normal expected shortfall multiplier. */
const ES95_MULTIPLIER = 2.0627128054846826;

/**
 * Volatility, VaR and the per-position risk decomposition.
 *
 * The decomposition is the standard Euler one: marginal contribution is
 * `(Σw)ᵢ / σₚ` and the component contribution `wᵢ · MCRᵢ` sums exactly to σₚ.
 * That additivity is the whole point — a "risk contribution" that does not sum
 * to the total is a ranking, not an attribution, and cannot answer "what do I
 * cut to lose the most risk per dollar".
 */
export function portfolioRisk(
  positions: RiskPosition[],
  equity: number,
  model: CovarianceModel,
  annualisation: number,
  history?: ReturnsBySymbol,
): PortfolioRisk | null {
  if (!positions.length || equity <= 0) return null;

  const index = new Map(model.symbols.map((s, i) => [s, i]));
  const held = positions.filter((p) => index.has(p.symbol) && p.signedNotional !== 0);
  if (!held.length) return null;

  // Weights as a fraction of EQUITY, not of gross. Risk is measured against the
  // capital that absorbs the loss; using gross would report the same volatility
  // for a book at 1x and one at 5x leverage.
  const w = model.symbols.map((s) => {
    const p = held.find((h) => h.symbol === s);
    return p ? p.signedNotional / equity : 0;
  });

  // Σw
  const sigmaW = model.covariance.map((row) => row.reduce((acc, c, j) => acc + c * w[j], 0));
  const variance = w.reduce((acc, wi, i) => acc + wi * sigmaW[i], 0);
  const vol = Math.sqrt(Math.max(0, variance));

  const contributions: RiskContribution[] = model.symbols
    .map((symbol, i) => {
      const marginal = vol > 0 ? sigmaW[i] / vol : 0;
      const component = w[i] * marginal;
      return {
        symbol,
        signedNotional: w[i] * equity,
        weight: w[i],
        standaloneVol: model.vol[i] * Math.sqrt(annualisation),
        contribution: component,
        contributionShare: vol > 0 ? component / vol : 0,
      };
    })
    .filter((c) => c.signedNotional !== 0)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  let worst: PortfolioRisk["worstCorrelation"] = null;
  for (let i = 0; i < model.symbols.length; i++) {
    for (let j = i + 1; j < model.symbols.length; j++) {
      if (w[i] === 0 || w[j] === 0) continue;
      const c = model.correlation[i][j];
      if (!worst || Math.abs(c) > Math.abs(worst.corr)) {
        worst = { a: model.symbols[i], b: model.symbols[j], corr: c };
      }
    }
  }

  const historical = history ? historicalVar(held, equity, history) : null;

  return {
    volatility: vol,
    annualisedVolatility: vol * Math.sqrt(annualisation),
    var95: Z95 * vol * equity,
    var99: Z99 * vol * equity,
    cvar95: ES95_MULTIPLIER * vol * equity,
    historicalVar95: historical?.var95 ?? null,
    historicalCvar95: historical?.cvar95 ?? null,
    contributions,
    worstCorrelation: worst,
    observations: model.observations,
    annualisation,
  };
}

/**
 * Replay today's book over history and read the loss distribution directly.
 *
 * No normality assumption, which is the point: crypto returns are fat-tailed in
 * exactly the region a parametric VaR describes, so the two numbers disagreeing
 * is information rather than an inconsistency. Uses the *current* weights over
 * past returns — a counterfactual ("what would this book have done"), not a
 * claim about what the book actually did.
 */
function historicalVar(
  positions: RiskPosition[],
  equity: number,
  history: ReturnsBySymbol,
): { var95: number; cvar95: number } | null {
  const usable = positions.filter((p) => (history[p.symbol]?.length ?? 0) >= 20);
  if (!usable.length) return null;
  const n = Math.min(...usable.map((p) => history[p.symbol].length));
  if (n < 20) return null;

  const pnl: number[] = [];
  for (let t = 0; t < n; t++) {
    let day = 0;
    for (const p of usable) {
      const series = history[p.symbol];
      day += p.signedNotional * series[series.length - n + t];
    }
    pnl.push(day);
  }

  pnl.sort((a, b) => a - b);
  const k = Math.max(1, Math.ceil(0.05 * pnl.length));
  const tail = pnl.slice(0, k);
  return {
    // Reported positive-as-loss so it reads next to the parametric figure.
    var95: -pnl[k - 1],
    cvar95: -mean(tail),
  };
}

// --------------------------------------------------------------------------
// Stress testing
// --------------------------------------------------------------------------

export interface Shock {
  /** Symbol or `"*"` for every instrument not named explicitly. */
  symbol: string;
  /** Fractional price move, e.g. -0.2 for −20%. */
  move: number;
}

/**
 * A hand-set shock table, in percent, converted to the fractional moves
 * `applyScenario` takes.
 *
 * A zero survives conversion rather than being dropped. "This instrument does
 * not move" is a hypothesis the operator can state, and it is a *different*
 * hypothesis from "propagate this one by its beta" — the first is a pinned
 * zero, the second is an omission. Collapsing them would quietly delete a
 * position's exposure from the total.
 *
 * This has no Python mirror on purpose and is excluded from the parity fixture,
 * the same as `applyManualWeights`: it is an interaction surface over
 * `applyScenario`, which is mirrored, and the Telegram companion has no sliders.
 */
export function manualShocks(percentBySymbol: Record<string, number>): Shock[] {
  return Object.entries(percentBySymbol)
    .filter(([, move]) => Number.isFinite(move))
    .map(([symbol, move]) => ({ symbol, move: move / 100 }));
}

export interface ScenarioResult {
  totalPnl: number;
  /** As a fraction of equity. */
  totalReturn: number;
  /** Equity remaining after the shock. */
  projectedEquity: number;
  perPosition: {
    symbol: string;
    signedNotional: number;
    /** The move applied, after beta propagation. */
    appliedMove: number;
    /** True when the move came from a beta rather than an explicit shock. */
    viaBeta: boolean;
    beta: number | null;
    pnl: number;
  }[];
  /** True when at least one instrument's move was inferred rather than given. */
  usedBeta: boolean;
}

/**
 * Beta of `symbol` against `reference`, measured from returns.
 *
 * Returns null rather than 1.0 when it cannot be estimated. Defaulting an
 * unknown beta to 1 is the quiet way a stress test starts inventing exposure:
 * every unmeasurable instrument would move exactly with the shocked one, and the
 * resulting number looks like a measurement.
 */
export function beta(
  symbol: string,
  reference: string,
  returns: ReturnsBySymbol,
): number | null {
  const a = returns[symbol];
  const b = returns[reference];
  if (!a?.length || !b?.length) return null;
  const n = Math.min(a.length, b.length);
  if (n < 20) return null;
  const x = b.slice(-n);
  const y = a.slice(-n);
  const varX = covariance(x, x);
  if (varX <= 0) return null;
  return covariance(y, x) / varX;
}

/**
 * Apply a scenario to the book.
 *
 * An instrument with no explicit shock is moved by `beta × the reference shock`
 * — and only when a beta could actually be measured. Anything else is left flat
 * and reported as such, so the total is never inflated by exposure the data
 * cannot support.
 */
export function applyScenario(
  positions: RiskPosition[],
  equity: number,
  shocks: Shock[],
  returns: ReturnsBySymbol,
  referenceSymbol: string,
): ScenarioResult {
  const explicit = new Map(shocks.filter((s) => s.symbol !== "*").map((s) => [s.symbol, s.move]));
  const wildcard = shocks.find((s) => s.symbol === "*")?.move ?? null;
  const reference = explicit.get(referenceSymbol) ?? wildcard ?? 0;

  let usedBeta = false;
  const perPosition = positions.map((p) => {
    const direct = explicit.get(p.symbol);
    if (direct !== undefined) {
      return {
        symbol: p.symbol,
        signedNotional: p.signedNotional,
        appliedMove: direct,
        viaBeta: false,
        beta: null,
        pnl: p.signedNotional * direct,
      };
    }
    const b = reference !== 0 ? beta(p.symbol, referenceSymbol, returns) : null;
    if (b !== null) usedBeta = true;
    const move = b !== null ? b * reference : (wildcard ?? 0);
    return {
      symbol: p.symbol,
      signedNotional: p.signedNotional,
      appliedMove: move,
      viaBeta: b !== null,
      beta: b,
      pnl: p.signedNotional * move,
    };
  });

  const totalPnl = perPosition.reduce((acc, p) => acc + p.pnl, 0);
  return {
    totalPnl,
    totalReturn: equity > 0 ? totalPnl / equity : 0,
    projectedEquity: equity + totalPnl,
    perPosition,
    usedBeta,
  };
}

export interface Scenario {
  id: string;
  label: string;
  /** One line on what this is meant to represent. */
  description: string;
  shocks: Shock[];
}

/**
 * Named scenarios, each a *hypothesis* rather than a forecast.
 *
 * The magnitudes are drawn from moves these markets have actually made — the
 * May 2021 and November 2022 crypto liquidations both exceeded −20% in a day —
 * so they are plausible rather than arbitrary. They are still assumptions, and
 * the panel says so.
 */
export const SCENARIOS: Scenario[] = [
  {
    id: "crypto_cascade",
    label: "Crypto liquidation cascade",
    description: "A leveraged unwind: majors gap down together and correlation goes to one.",
    shocks: [{ symbol: "BTCUSDT", move: -0.2 }, { symbol: "*", move: -0.25 }],
  },
  {
    id: "risk_off",
    label: "Broad risk-off",
    description: "Macro shock. Everything correlated to the reference falls with it.",
    shocks: [{ symbol: "BTCUSDT", move: -0.08 }],
  },
  {
    id: "melt_up",
    label: "Melt-up",
    description: "The upside case — worth running, because a short book fails here.",
    shocks: [{ symbol: "BTCUSDT", move: 0.15 }],
  },
  {
    id: "flat",
    label: "No shock",
    description: "Baseline. Any non-zero P&L here would be a bug in the propagation.",
    shocks: [{ symbol: "*", move: 0 }],
  },
];

// ---------------------------------------------------------------------------
// Volatility regime
//
// The missing input to every scenario above. A −20% shock is a different
// statement depending on what the market has been doing: in a compressed regime
// it is a tail event, in a stressed one it is a Tuesday. Mirrors
// `quant_risk.volatility_regime` in the Python gateway.
// ---------------------------------------------------------------------------

export type Regime = "COMPRESSED" | "NORMAL" | "ELEVATED" | "STRESSED";

export interface VolatilityRegime {
  regime: Regime;
  /** Annualised realised volatility over the trailing window. */
  currentVol: number;
  /** Annualised mean of every earlier window — the instrument's own baseline. */
  baselineVol: number;
  /** currentVol ÷ baselineVol. The multiplier a scenario should be scaled by. */
  ratio: number;
  /** Mid-rank percentile of the current window against all earlier ones. */
  percentile: number;
  observations: number;
  note: string;
}

const REGIME_NOTES: Record<Regime, string> = {
  STRESSED:
    "Volatility is in the top 15% of its own recent range — position sizes calibrated in calmer conditions are carrying more risk than they were sized for.",
  ELEVATED:
    "Above its usual range but not extreme. Stress scenarios sized on the long-run average will understate the move.",
  COMPRESSED:
    "Volatility is in the bottom 15%. Quiet regimes end abruptly, and the sizing set here is the sizing you carry into the next expansion.",
  NORMAL: "Volatility is within its usual range for this instrument.",
};

/**
 * Where realised volatility sits against this instrument's own recent history.
 *
 * A regime is a *relative* statement. "3% daily vol" means nothing without
 * knowing whether this name usually runs at 1% or at 6%, so the answer is a
 * percentile of the trailing window against every earlier window — not an
 * absolute threshold, which would classify every crypto pair as permanently
 * high and every FX pair as permanently low, and would be a claim about the
 * asset class rather than about now.
 *
 * The comparison set is *earlier* windows only, so the label is the one that
 * would have been available in real time.
 *
 * Returns `null` below two full windows rather than a label computed from too
 * little history — a regime call is exactly the kind of number that gets quoted
 * without its sample size.
 */
export function volatilityRegime(
  returns: number[] | Float64Array,
  options: { window?: number; interval?: string } = {},
): VolatilityRegime | null {
  const window = options.window ?? 20;
  const values = Array.from(returns);
  if (values.length < window * 2) return null;

  const rolling: number[] = [];
  for (let i = window; i <= values.length; i++) {
    rolling.push(stdev(values.slice(i - window, i)));
  }
  if (rolling.length < 2) return null;

  const current = rolling[rolling.length - 1];
  const history = rolling.slice(0, -1);
  const baseline = mean(history);

  // Mid-rank, not `<=`. Counting ties as "below" sends a series whose
  // volatility never changes to the 100th percentile, labelling a perfectly
  // calm instrument STRESSED — the exact inversion of what this is for.
  // Averaging the strict and non-strict ranks puts a constant series at 0.5,
  // which is the honest answer: it is exactly as volatile as it always is.
  let strictlyBelow = 0;
  let atOrBelow = 0;
  for (const v of history) {
    if (v < current) strictlyBelow++;
    if (v <= current) atOrBelow++;
  }
  const percentile = (strictlyBelow + atOrBelow) / (2 * history.length);
  const ratio = baseline > 0 ? current / baseline : 1;

  const regime: Regime =
    percentile >= 0.85
      ? "STRESSED"
      : percentile >= 0.6
        ? "ELEVATED"
        : percentile <= 0.15
          ? "COMPRESSED"
          : "NORMAL";

  const ann = Math.sqrt(BARS_PER_YEAR[options.interval ?? "1d"] ?? 365);
  return {
    regime,
    currentVol: current * ann,
    baselineVol: baseline * ann,
    ratio,
    percentile,
    observations: rolling.length,
    note: REGIME_NOTES[regime],
  };
}

/**
 * Rescale a scenario's shocks by how volatile the market currently is.
 *
 * The scenario magnitudes are drawn from moves these markets have actually
 * made, which makes them plausible *on average*. They are not conditioned on
 * today. When realised volatility is running at twice its baseline, the same
 * catalyst produces a larger move, and a stress test that ignores that is
 * quietly assuming an average day.
 *
 * **The multiplier floors at 1 — this scales up only, never down.** The
 * symmetric version is the obvious one and it is wrong. On live BTC data at a
 * 29th-percentile regime the ratio was 0.78, which would have shrunk a −20%
 * cascade to −15.6% and made the book look *safest* in exactly the conditions
 * the COMPRESSED note warns about: quiet regimes end abruptly, and the sizing
 * set in one is the sizing carried into the next expansion. A stress test that
 * relaxes as volatility falls reports its most reassuring number immediately
 * before it is most wrong.
 *
 * The upper bound is 2×. An unclamped ratio off a thin sample reaches 4× or 5×
 * and turns a scenario into an unfalsifiable catastrophe — a −80% "shock" tells
 * you nothing you did not already know about a long book.
 */
export const REGIME_SCALE_BOUNDS: [number, number] = [1, 2];

export function scaleShocks(shocks: Shock[], regime: VolatilityRegime | null): Shock[] {
  if (!regime) return shocks;
  const [lo, hi] = REGIME_SCALE_BOUNDS;
  const k = Math.min(hi, Math.max(lo, regime.ratio));
  return shocks.map((s) => ({ ...s, move: s.move * k }));
}

// --------------------------------------------------------------------------
// VaR model validation
//
// A VaR nobody has back-tested is an opinion. Regulators settled this argument
// decades ago: count how often the realised loss exceeded the forecast and test
// that count against the model's own claim. At 95% confidence roughly one day
// in twenty *should* breach — a model with zero exceptions is not conservative,
// it is wrong in the expensive direction, holding capital against a risk it
// cannot measure.
//
// Mirrors `var_backtest` / `rolling_var_backtest` in modules/quant_risk.py.
// --------------------------------------------------------------------------

export interface VarBacktest {
  observations: number;
  exceptions: number;
  expectedExceptions: number;
  exceptionRate: number;
  kupiecStatistic: number;
  kupiecPValue: number;
  zone: "green" | "yellow" | "red";
  verdict: string;
}

/**
 * Survival function of chi-squared with one degree of freedom.
 *
 * For 1 df this is exactly `erfc(sqrt(x/2))`. JavaScript has no `erfc`, so this
 * uses the Abramowitz & Stegun 7.1.26 rational approximation — accurate to
 * ~1.5e-7, which is far tighter than the 0.01/0.05 thresholds it feeds.
 */
function chiSquaredSurvival1df(x: number): number {
  if (x <= 0) return 1;
  const z = Math.sqrt(x / 2);
  const t = 1 / (1 + 0.3275911 * z);
  const poly = t * (0.254829592
    + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return poly * Math.exp(-z * z);
}

function kupiec(exceptions: number, observations: number, alpha: number): VarBacktest {
  const expected = alpha * observations;
  const rate = exceptions / observations;

  // Guarded at the boundaries, where log(0) appears for a model with no
  // exceptions at all — the common case on a short, quiet window.
  let lr: number;
  if (exceptions > 0 && exceptions < observations) {
    lr = -2 * (
      (observations - exceptions) * Math.log(1 - alpha) + exceptions * Math.log(alpha)
      - ((observations - exceptions) * Math.log(1 - rate) + exceptions * Math.log(rate))
    );
  } else if (exceptions === 0) {
    lr = -2 * observations * Math.log(1 - alpha);
  } else {
    lr = -2 * observations * Math.log(alpha);
  }
  lr = Math.max(0, lr);
  const pValue = chiSquaredSurvival1df(lr);

  let zone: VarBacktest["zone"];
  let verdict: string;
  if (pValue >= 0.05) {
    zone = "green";
    verdict = "Model validated: the exception count is consistent with the forecast.";
  } else if (exceptions > expected) {
    zone = pValue < 0.01 ? "red" : "yellow";
    verdict = `Model understates risk: ${exceptions} exceptions where ${expected.toFixed(1)} were expected.`;
  } else {
    zone = "yellow";
    verdict = `Model overstates risk: only ${exceptions} exceptions where ${expected.toFixed(1)} were expected `
      + "— the desk is holding capacity it is not using.";
  }

  return {
    observations,
    exceptions,
    expectedExceptions: Number(expected.toFixed(2)),
    exceptionRate: Number(rate.toFixed(4)),
    kupiecStatistic: Number(lr.toFixed(4)),
    kupiecPValue: Number(pValue.toFixed(4)),
    zone,
    verdict,
  };
}

/**
 * Back-test the parametric VaR this workspace quotes.
 *
 * The forecast is re-estimated on a rolling window and scored against the
 * *next* bar's realised book P&L, so it is never judged on data it was fitted
 * to. That distinction is the whole test: a VaR evaluated in-sample passes
 * trivially and tells a risk manager nothing.
 *
 * The book is held at today's weights — this measures the *model*, asking
 * whether the volatility estimate would have covered the losses this book would
 * have taken, which is the question a limit depends on.
 */
export function rollingVarBacktest(
  positions: RiskPosition[],
  history: ReturnsBySymbol,
  window = 60,
  confidence = 0.95,
): VarBacktest | null {
  const series = rollingVarSeries(positions, history, { window });
  if (!series) return null;

  const scored = series.points.length;
  if (scored < 20) return null;

  const exceptions = series.points.reduce((n, p) => n + (p.exception95 ? 1 : 0), 0);
  return kupiec(exceptions, scored, 1 - confidence);
}

/** One scored bar of the rolling backtest. */
export interface VarSeriesPoint {
  /** Index into the aligned common window, 0-based. */
  index: number;
  /** Bar open-time in ms, or null when times were not supplied or not aligned. */
  t: number | null;
  /** Realised counterfactual book P&L for this bar, in currency. */
  pnl: number;
  /** Trailing sigma of book P&L over the PRIOR `window` bars, in currency. */
  sigma: number;
  /** One-sided 95% loss forecast from the prior window. Positive = loss. */
  var95: number;
  /** Same, at 99%. Drawn, never scored — see the note below. */
  var99: number;
  exception95: boolean;
  exception99: boolean;
}

export interface VarSeries {
  points: VarSeriesPoint[];
  window: number;
  /** Symbols that entered the counterfactual. */
  symbols: string[];
  /** False when the supplied bar times disagreed across symbols at any index. */
  timesAligned: boolean;
}

/**
 * The per-observation series behind `rollingVarBacktest`.
 *
 * The arithmetic used to live inside the scorer, which built the whole series
 * and then returned eight scalars — so the one artefact that shows *when* the
 * model failed, and whether the failures clustered, was computed and thrown
 * away. Kupiec tests unconditional coverage only: three exceptions in one week
 * and three spread over a year produce the same green zone and are very
 * different books.
 *
 * This has no Python mirror on purpose and is excluded from the parity fixture,
 * the same as `applyManualWeights`. It is a presentation surface over arithmetic
 * that IS mirrored — `rollingVarBacktest` consumes it and stays byte-identical
 * in signature and result, which is what `tests/risk-parity.test.ts` proves.
 *
 * `var99` is emitted from the same sigma rather than routed through the scorer's
 * `confidence` parameter. That parameter reaches `kupiec` as the significance
 * level but the exception threshold below is fixed at Z95 — and `quant_risk.py`
 * has the identical line. Nothing calls it at 0.99 today; fixing it needs both
 * sides plus a fixture regeneration, so the 99% band is produced here instead
 * and is labelled "drawn, not scored" wherever it is rendered.
 */
export function rollingVarSeries(
  positions: RiskPosition[],
  history: ReturnsBySymbol,
  options: { window?: number; times?: Record<string, number[]> } = {},
): VarSeries | null {
  const window = options.window ?? 60;
  const usable = positions.filter((p) => (history[p.symbol]?.length ?? 0) > 0);
  if (!usable.length) return null;

  const length = Math.min(...usable.map((p) => history[p.symbol].length));
  if (length < window + 20) return null;

  const bookReturns: number[] = [];
  for (let t = 0; t < length; t++) {
    let total = 0;
    for (const p of usable) {
      const series = history[p.symbol];
      total += p.signedNotional * series[series.length - length + t];
    }
    bookReturns.push(total);
  }

  // Time axis is verified, not assumed. buildCovariance aligns purely by index,
  // which is correct for an all-crypto UTC-daily book and silently wrong the day
  // a differently-calendared instrument arrives. Rather than inherit that as an
  // assumption, take one symbol's times, check every other against it, and drop
  // to index labels if any disagree — the same discipline sessionReturn applies.
  const times = options.times;
  let axis: number[] | null = null;
  let timesAligned = false;
  if (times) {
    const aligned = usable
      .map((p) => times[p.symbol])
      .filter((series): series is number[] => Array.isArray(series) && series.length >= length)
      .map((series) => series.slice(series.length - length));
    if (aligned.length === usable.length && aligned.length > 0) {
      timesAligned = aligned.every((series) => series.every((v, i) => v === aligned[0][i]));
      if (timesAligned) axis = aligned[0];
    }
  }

  const points: VarSeriesPoint[] = [];
  for (let t = window; t < length; t++) {
    const train = bookReturns.slice(t - window, t);
    const mean = train.reduce((a, b) => a + b, 0) / train.length;
    const variance = train.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (train.length - 1);
    const sigma = Math.sqrt(variance);
    // A window with no dispersion produces no forecast, so it is not emitted at
    // all rather than emitted with sigma 0. Keeps points.length === the scorer's
    // `observations` exactly, which is the invariant the chart rests on.
    if (!(sigma > 0)) continue;
    const pnl = bookReturns[t];
    const var95 = Z95 * sigma;
    const var99 = Z99 * sigma;
    points.push({
      index: t,
      t: axis ? axis[t] : null,
      pnl,
      sigma,
      var95,
      var99,
      exception95: -pnl > var95,
      exception99: -pnl > var99,
    });
  }

  return { points, window, symbols: usable.map((p) => p.symbol), timesAligned };
}

// --------------------------------------------------------------------------
// Allocation
//
// The workspace could say what the book *is* — exposure, concentration, risk
// contributions — and nothing about what it should be. This closes that, and is
// deliberately naive about expected return: it allocates by risk, because
// forecasting covariance is hard and forecasting returns is harder. A proposal
// that pretended otherwise would be an opinion dressed as arithmetic.
//
// Mirrors `propose_allocation` / `rebalance_trades` in modules/quant_risk.py.
// --------------------------------------------------------------------------

export type AllocationMethod = "equal_weight" | "inverse_vol" | "equal_risk" | "min_variance";

/**
 * Every method this engine solves, in the order the desk reads them: the naive
 * one first, then the three that price risk.
 *
 * Mirrors `ALLOCATION_METHODS` in modules/quant_risk.py.
 */
export const ALLOCATION_METHODS: readonly AllocationMethod[] = [
  "equal_weight",
  "inverse_vol",
  "equal_risk",
  "min_variance",
];

/**
 * Both iterative solvers run a fixed number of steps rather than testing for
 * convergence. A tolerance check lets two implementations stop on different
 * iterations and disagree by more than the cross-language fixture allows; a
 * fixed count cannot.
 */
const SOLVER_ITERATIONS = 60;

/**
 * wᵀΣw for a weight map keyed by symbol.
 *
 * Mirrors `portfolio_variance` in modules/quant_risk.py. The summation is
 * sequential in both — never a pairwise or chunked sum, which would round
 * differently from Python's left-to-right accumulation and drift past what the
 * parity fixture tolerates.
 */
export function portfolioVariance(model: CovarianceModel, weights: Map<string, number>): number {
  const size = model.symbols.length;
  const vector = model.symbols.map((s) => weights.get(s) ?? 0);
  let total = 0;
  for (let i = 0; i < size; i++) {
    let marginal = 0;
    for (let j = 0; j < size; j++) marginal += model.covariance[i][j] * vector[j];
    total += vector[i] * marginal;
  }
  return total;
}

export interface TargetWeight {
  symbol: string;
  currentWeight: number;
  targetWeight: number;
  currentNotional: number;
  targetNotional: number;
  /** Signed change as a fraction of current gross: positive means add. */
  drift: number;
  /** Which constraint held this weight below its unclipped value, if any. */
  clippedBy: string | null;
}

export interface AllocationProposal {
  method: AllocationMethod;
  targets: TargetWeight[];
  grossBefore: number;
  grossAfter: number;
  clipped: boolean;
}

export interface AllocationLimits {
  maxSymbolNotional?: number;
  maxGrossNotional?: number;
}

/**
 * Constraint-aware target weights for the current book.
 *
 * Four methods, in increasing order of what they claim to know:
 *
 * - `equal_weight` — 1/n. It knows nothing and says so, which makes it the
 *   honest baseline the other three have to beat.
 * - `inverse_vol` — each position sized by the reciprocal of its own volatility.
 *   Ignores correlation.
 * - `equal_risk` — equalises each position's *contribution* to book volatility,
 *   so two names that move together are sized as one bet.
 * - `min_variance` — the long-only, fully-invested portfolio with the smallest
 *   variance the estimated covariance allows. The most concentrated of the four
 *   by construction, so it clips against a symbol cap most often.
 *
 * None of them forecasts a return. Mirrors `propose_allocation` in
 * modules/quant_risk.py; the fixture in tests/fixtures/risk-parity.json holds
 * the two implementations to 1e-4.
 */
export function proposeAllocation(
  positions: RiskPosition[],
  model: CovarianceModel,
  method: AllocationMethod = "inverse_vol",
  limits: AllocationLimits = {},
): AllocationProposal | null {
  const index = new Map(model.symbols.map((s, i) => [s, i]));
  const live = positions.filter((p) => index.has(p.symbol) && p.signedNotional !== 0);
  if (!live.length) return null;

  const vols = new Map(live.map((p) => [p.symbol, Math.sqrt(Math.max(0, model.covariance[index.get(p.symbol)!][index.get(p.symbol)!]))]));
  if ([...vols.values()].some((v) => !(v > 0))) return null;

  // Normalised explicitly rather than by falling through an else: the returned
  // proposal names its own method, and a silent fallback would let it name one
  // thing while the caller asked for another.
  const resolved: AllocationMethod = ALLOCATION_METHODS.includes(method) ? method : "inverse_vol";

  let weights = new Map<string, number>();
  if (resolved === "equal_weight") {
    // 1/n over *distinct* symbols, not `live.length`. Both engines key weights
    // by symbol but iterate the position list when building targets, so a
    // duplicated symbol would collect the same weight twice and silently
    // inflate gross. `vols` is already keyed by symbol, so its size is the
    // distinct count.
    const count = vols.size;
    for (const symbol of vols.keys()) weights.set(symbol, 1 / count);
  } else if (resolved === "min_variance") {
    // Minimum variance, long-only and fully invested. The KKT condition for
    // `min wᵀΣw s.t. Σw = 1, w >= 0` is that every marginal variance (Σw)ᵢ is
    // equal on the support, which gives a multiplicative update in the same
    // shape as the equal-risk solver below — one solver family in this file
    // rather than two, and no simplex projection or step size to tune.
    //
    // Seeded with inverse *variance*, which is already the exact answer when
    // the correlations are zero, so the iteration only has to undo the
    // correlation.
    let total = 0;
    for (const [symbol, vol] of vols) { weights.set(symbol, 1 / (vol * vol)); total += 1 / (vol * vol); }
    for (const [symbol, w] of weights) weights.set(symbol, w / total);

    // A multiplicative fixed point is not proven to decrease the objective on
    // every step. A method called "minimum variance" that returned something
    // more volatile than inverse-vol would be indefensible, so the best iterate
    // is kept rather than whichever one the loop happened to end on.
    let best = weights;
    let bestVariance = portfolioVariance(model, weights);

    for (let iteration = 0; iteration < SOLVER_ITERATIONS; iteration++) {
      const vector = model.symbols.map((s) => weights.get(s) ?? 0);
      const marginal = model.symbols.map((_, i) =>
        model.symbols.reduce((acc, _s, j) => acc + model.covariance[i][j] * vector[j], 0));
      const variance = model.symbols.reduce((acc, _s, i) => acc + vector[i] * marginal[i], 0);
      if (!(variance > 0)) break;

      const updated = new Map<string, number>();
      for (const [symbol, w] of weights) {
        const i = index.get(symbol)!;
        // A negative marginal variance is a hedge: the fixed point has no update
        // for it, and Math.sqrt of a negative would put a NaN into every weight
        // at the next renormalisation. Held flat, exactly as equal_risk holds a
        // non-positive contribution.
        updated.set(symbol, marginal[i] > 0 ? w * Math.sqrt(variance / marginal[i]) : w);
      }
      const sum = [...updated.values()].reduce((a, b) => a + b, 0) || 1;
      weights = new Map([...updated].map(([s, w]) => [s, w / sum]));

      const candidate = portfolioVariance(model, weights);
      if (candidate < bestVariance) { bestVariance = candidate; best = weights; }
    }
    weights = best;
  } else if (resolved === "equal_risk") {
    // Fixed-point iteration toward equal risk contribution. The inverse-vol
    // solution is the natural start: it is already correct when correlations
    // are zero, so the iteration only has to undo the correlation.
    let total = 0;
    for (const [symbol, vol] of vols) { weights.set(symbol, 1 / vol); total += 1 / vol; }
    for (const [symbol, w] of weights) weights.set(symbol, w / total);

    for (let iteration = 0; iteration < SOLVER_ITERATIONS; iteration++) {
      const vector = model.symbols.map((s) => weights.get(s) ?? 0);
      const marginal = model.symbols.map((_, i) =>
        model.symbols.reduce((acc, _s, j) => acc + model.covariance[i][j] * vector[j], 0));
      const variance = model.symbols.reduce((acc, _s, i) => acc + vector[i] * marginal[i], 0);
      if (!(variance > 0)) break;

      const targetRc = variance / weights.size;
      const updated = new Map<string, number>();
      for (const [symbol, w] of weights) {
        const i = index.get(symbol)!;
        const contribution = vector[i] * marginal[i];
        updated.set(symbol, contribution > 0 && marginal[i] > 0 ? w * Math.sqrt(targetRc / contribution) : w);
      }
      const sum = [...updated.values()].reduce((a, b) => a + b, 0) || 1;
      weights = new Map([...updated].map(([s, w]) => [s, w / sum]));
    }
  } else {
    let total = 0;
    for (const [symbol, vol] of vols) { weights.set(symbol, 1 / vol); total += 1 / vol; }
    for (const [symbol, w] of weights) weights.set(symbol, w / total);
  }

  const grossBefore = live.reduce((acc, p) => acc + Math.abs(p.signedNotional), 0);
  const budget = limits.maxGrossNotional
    ? Math.min(grossBefore, limits.maxGrossNotional)
    : grossBefore;

  let clipped = false;
  const targets: TargetWeight[] = live.map((p) => {
    const currentNotional = Math.abs(p.signedNotional);
    let targetNotional = (weights.get(p.symbol) ?? 0) * budget;
    let clippedBy: string | null = null;
    if (limits.maxSymbolNotional && targetNotional > limits.maxSymbolNotional) {
      targetNotional = limits.maxSymbolNotional;
      clippedBy = "max_symbol_notional_usd";
      clipped = true;
    }
    return {
      symbol: p.symbol,
      currentWeight: grossBefore ? currentNotional / grossBefore : 0,
      targetWeight: budget ? targetNotional / budget : 0,
      currentNotional,
      targetNotional,
      drift: grossBefore ? (targetNotional - currentNotional) / grossBefore : 0,
      clippedBy,
    };
  });

  targets.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));
  return {
    method: resolved,
    targets,
    grossBefore,
    grossAfter: targets.reduce((acc, t) => acc + t.targetNotional, 0),
    clipped,
  };
}

export interface ManualAllocation extends AllocationProposal {
  manual: true;
  /** Symbols the reader typed a weight for. */
  pinned: string[];
  /** Σ of every target weight before clipping. One when the override balances. */
  weightSum: number;
  /** `weightSum` within 1e-6 of one. Trades are withheld when this is false. */
  balanced: boolean;
}

/**
 * A solved proposal with some of its weights replaced by hand.
 *
 * This has **no Python mirror on purpose** and is excluded from the parity
 * fixture. It is a UI affordance — a PM disagreeing with a solver on one name —
 * and there is no Telegram counterpart for it, so a second implementation would
 * be a second thing to keep in step for no reader.
 *
 * Two rules carry the design:
 *
 *  - **Pinned weights are honoured verbatim.** A number the reader typed is not
 *    rescaled to make the column add up. If it does not add up, the panel says
 *    so and withholds the trades rather than quietly trading a different book.
 *  - **The remainder is spread pro-rata to the model's weights, never equally.**
 *    The solver's ordering among the names the reader did *not* touch is
 *    information they did not override; splitting the remainder equally would
 *    silently override those rows too.
 */
export function applyManualWeights(
  proposal: AllocationProposal,
  pinned: Record<string, number>,
  limits: AllocationLimits = {},
): ManualAllocation {
  const budget = limits.maxGrossNotional
    ? Math.min(proposal.grossBefore, limits.maxGrossNotional)
    : proposal.grossBefore;

  const pinnedSymbols: string[] = [];
  const held = new Map<string, number>();
  for (const target of proposal.targets) {
    const raw = pinned[target.symbol];
    if (raw == null || !Number.isFinite(raw)) continue;
    // Long-only, matching all four solvers. Clamped rather than rejected so a
    // stray keystroke does not blank the panel.
    held.set(target.symbol, Math.max(0, Math.min(1, raw)));
    pinnedSymbols.push(target.symbol);
  }

  const pinnedSum = [...held.values()].reduce((a, b) => a + b, 0);
  const unpinned = proposal.targets.filter((t) => !held.has(t.symbol));
  const modelSum = unpinned.reduce((acc, t) => acc + t.targetWeight, 0);
  const remainder = 1 - pinnedSum;

  const weights = new Map<string, number>(held);
  for (const target of unpinned) {
    if (remainder <= 0) {
      // Over-allocated. The pinned rows already claim the whole book, so the
      // rest go to zero and the panel reports the overshoot rather than
      // rescaling a number somebody typed.
      weights.set(target.symbol, 0);
    } else if (modelSum > 0) {
      weights.set(target.symbol, (target.targetWeight / modelSum) * remainder);
    } else {
      // Every unpinned row is at zero in the model, so pro-rata has nothing to
      // divide. Equal split is the only fallback, and the panel names it.
      weights.set(target.symbol, remainder / unpinned.length);
    }
  }

  const weightSum = [...weights.values()].reduce((a, b) => a + b, 0);

  let clipped = false;
  const targets: TargetWeight[] = proposal.targets.map((target) => {
    let targetNotional = (weights.get(target.symbol) ?? 0) * budget;
    let clippedBy: string | null = null;
    // Clipped after the manual weights, not before: a reader who types 60% into
    // a name the gate caps at 40% has to see the cap here rather than discover
    // it order by order.
    if (limits.maxSymbolNotional && targetNotional > limits.maxSymbolNotional) {
      targetNotional = limits.maxSymbolNotional;
      clippedBy = "max_symbol_notional_usd";
      clipped = true;
    }
    return {
      symbol: target.symbol,
      currentWeight: target.currentWeight,
      targetWeight: budget ? targetNotional / budget : 0,
      currentNotional: target.currentNotional,
      targetNotional,
      drift: proposal.grossBefore
        ? (targetNotional - target.currentNotional) / proposal.grossBefore
        : 0,
      clippedBy,
    };
  });

  targets.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));

  return {
    manual: true,
    method: proposal.method,
    pinned: pinnedSymbols,
    targets,
    grossBefore: proposal.grossBefore,
    grossAfter: targets.reduce((acc, t) => acc + t.targetNotional, 0),
    clipped,
    weightSum,
    balanced: Math.abs(weightSum - 1) <= 1e-6,
  };
}

export interface RebalanceTrade {
  symbol: string;
  side: "BUY" | "SELL";
  notional: number;
  reason: string;
}

/**
 * Trades needed to reach the proposal, filtered by a drift band.
 *
 * The band is what stops a rebalance being a fee-generating machine: a position
 * 1% away from target costs more to correct than the correction is worth.
 */
export function rebalanceTrades(
  proposal: AllocationProposal,
  positions: RiskPosition[],
  driftBand = 0.05,
): RebalanceTrade[] {
  const isLong = new Map(positions.map((p) => [p.symbol, p.signedNotional >= 0]));
  return proposal.targets
    .filter((t) => Math.abs(t.drift) >= driftBand)
    .map((t) => {
      const delta = t.targetNotional - t.currentNotional;
      const long = isLong.get(t.symbol) ?? true;
      // Adding to a short means selling more of it: direction depends on which
      // side the position is already on.
      const side: "BUY" | "SELL" = long
        ? (delta > 0 ? "BUY" : "SELL")
        : (delta > 0 ? "SELL" : "BUY");
      return {
        symbol: t.symbol,
        side,
        notional: Math.abs(delta),
        reason: `${delta < 0 ? "over" : "under"}weight by ${(Math.abs(t.drift) * 100).toFixed(1)}% of gross`
          + (t.clippedBy ? ` (target clipped by ${t.clippedBy})` : ""),
      };
    });
}
