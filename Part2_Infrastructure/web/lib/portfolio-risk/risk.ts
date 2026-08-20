import { mean, stdev } from "../stats";
import { CovarianceModel } from "./covariance";
import { ReturnsBySymbol, RiskPosition } from "./inputs";

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
export const Z95 = 1.6448536269514722;
export const Z99 = 2.3263478740408408;
/** E[Z | Z > z95] = φ(z95)/0.05 — the normal expected shortfall multiplier. */
const ES95_MULTIPLIER = 2.0627128054846826;

/**
 * Closed-form 99% terminal-value VaR of the same GBM the Oracle procedure
 * simulates (`oracle/02_monte_carlo.sql`):
 *
 *     S_T = S0 · exp((μ − σ²/2)·T + σ·√T·Z),   T = days / 365
 *
 * The 1st percentile of S_T is S0·exp((μ − σ²/2)·T − z99·σ·√T); the loss
 * against the starting equity is returned floored at zero, exactly as the
 * procedure floors `p_var_99` — a rich enough drift can lift the whole 1st
 * percentile above the start, and a negative loss is honest but useless.
 *
 * Exists because the Oracle panel's first comparison was `z99·σ·√T·equity`,
 * the zero-drift NORMAL approximation, read against a simulation carrying an
 * 8% annual drift: at 30 days the drift term alone (≈ equity·μ·T) accounted
 * for the whole −22% "divergence" the panel then flagged as an input error.
 * Same drift, same volatility, same lognormal quantile, same 365-day year —
 * what remains between this figure and the simulated one is sampling error,
 * which is the only thing a divergence tile is meant to measure.
 */
export function gbmTerminalVar99(
  equity: number,
  /** Expected annual return the simulation ran on — its `p_mu`. */
  mu: number,
  /** Annualised volatility — the simulation's `p_sigma`. */
  sigma: number,
  /** Forward horizon in days — the simulation's `p_days`, over a 365-day year. */
  days: number,
): number {
  const t = days / 365;
  const firstPercentile =
    equity * Math.exp((mu - 0.5 * sigma * sigma) * t - Z99 * sigma * Math.sqrt(t));
  return Math.max(equity - firstPercentile, 0);
}

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
