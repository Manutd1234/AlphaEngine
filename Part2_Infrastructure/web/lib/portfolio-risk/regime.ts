import { mean, stdev } from "../stats";
import { BARS_PER_YEAR } from "../types";

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
    "Above its usual range but not extreme. Scenarios here are sized on the long-run average, so they understate what this market is currently delivering.",
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
