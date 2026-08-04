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
