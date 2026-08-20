import { mean, stdev } from "../stats";
import { applyManualWeights } from "./allocation";
import { ReturnsBySymbol, RiskPosition } from "./inputs";
import { Z95, Z99 } from "./risk";

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
