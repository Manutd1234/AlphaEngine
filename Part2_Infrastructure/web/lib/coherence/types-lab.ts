/**
 * Wire shapes for the coherence lab: distribution, stakes, combos, calibration,
 * settlement feeds, maker dispersion, and the shell.
 *
 * Split from `types.ts` when that file reached its length ceiling, along the
 * same seam the gateway routers use: those types are the engine's running
 * state, these are the readings built on top of it.
 *
 * **Every decimal is a string, and that is not laziness.** A probability mass
 * of `0.0500`, a bin midpoint of `77549.99` and a Kelly fraction of
 * `0.006643356643356643` are fixed-point quantities whose last places decide
 * an answer; JSON numbers are binary64 and would round them on arrival. They
 * are parsed with the integer-centicent helpers in `fixed-point.ts` at the one
 * place each is used, never by `Number()` at the boundary.
 *
 * **Null means null.** A mean that could not be computed, a band with an
 * unquoted leg, a maker spread from a single quote — each arrives as `null`
 * beside a sentence saying why, and a pane renders the sentence rather than a
 * zero. The guards below are shallow for the same reason: they check the
 * `state` discriminator and the collection a pane iterates, and let everything
 * inside stay nullable, so a partial answer renders as a partial answer
 * instead of being rejected wholesale.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/* -------------------------------------------------------------- surface -- */

export interface CoherenceProbe {
  strike: string;
  survival: string;
  ticker: string;
  label: string;
  /** "threshold" read directly, or "ceiling" inverted from a P(X <= k) market. */
  origin: string;
}

export interface CoherenceBin {
  label: string;
  low: string | null;
  high: string | null;
  mass: string;
  /** The interval's midpoint, or null where the interval is unbounded. */
  representative: string | null;
  negative: boolean;
}

export interface CoherenceSurface {
  state: string;
  engine: string;
  basis: string | null;
  event_ticker: string;
  probes: CoherenceProbe[];
  bins: CoherenceBin[];
  total_mass: string | null;
  tail_mass_low: string | null;
  tail_mass_high: string | null;
  mean: string | null;
  variance: string | null;
  standard_deviation: string | null;
  skewness: string | null;
  excess_kurtosis: string | null;
  moments_note: string;
  negative_bins: string[];
  detail: string;
}

/* ---------------------------------------------------------------- kelly -- */

export interface CoherenceStake {
  ticker: string;
  label: string;
  probability: string;
  price: string;
  edge: string;
  full_fraction: string;
  fraction: string;
  admitted: boolean;
}

export interface CoherenceKelly {
  state: string;
  engine: string;
  stakes: CoherenceStake[];
  shrinkage: string;
  reserve_rate: string | null;
  cash_fraction: string | null;
  staked_fraction: string | null;
  growth_rate: string | null;
  full_growth_rate: string | null;
  worst_case_wealth: string | null;
  basket_cost: string | null;
  /** A riskless profit exists. It does NOT mean this plan is that profit. */
  arbitrage_available: boolean;
  riskless_growth: string | null;
  detail: string;
}

/* --------------------------------------------------------------- combos -- */

export interface CoherenceComboLeg {
  ticker: string;
  label: string;
  side: string;
  probability: string | null;
  buy_cost: string | null;
  opposite_cost: string | null;
}

export interface CoherenceCombo {
  ticker: string;
  label: string;
  collection_ticker: string;
  scope: string;
  legs: CoherenceComboLeg[];
  combo_bid: string | null;
  combo_ask: string | null;
  combo_mid: string | null;
  /** The price the band position was read at, and which side it came from. */
  price: string | null;
  price_basis: string;
  lower_bound: string | null;
  upper_bound: string | null;
  independence: string | null;
  band_width: string | null;
  band_position: string | null;
  dependence: string;
  inside_band: boolean | null;
  /**
   * Rows on this parlay whose portfolio costs less than it is certain to pay.
   * Distinct from `inside_band`: the bounds come from each leg's mid while the
   * parlay is read from its offer, so a price outside the band does not on its
   * own prove a trade. Only this may be called a Dutch book.
   */
  violated_rows: number;
  detail: string;
}

export interface CoherenceComboRow {
  because: string;
  scope: string;
  bound: string;
  cost: string | null;
  slack: string | null;
  violated: boolean;
  legs: CoherenceComboLeg[];
}

export interface CoherenceCombos {
  state: string;
  combos: CoherenceCombo[];
  rows: CoherenceComboRow[];
  quoted: number;
  outside_band: number;
  violations: number;
  notes: string[];
}

/* ---------------------------------------------------------- calibration -- */

export interface CoherenceReliabilityBin {
  label: string;
  low: string;
  high: string;
  count: number;
  mean_forecast: string | null;
  outcome_rate: string | null;
  /** Outcome rate minus price. Negative means the band was overpriced. */
  deviation: string | null;
}

export interface CoherenceMapPoint {
  quoted: string;
  calibrated: string;
  weight: number;
}

export interface CoherenceCompositionRow {
  series_ticker: string;
  count: number;
}

export interface CoherenceCalibration {
  state: string;
  /** "tape" is a real forecast test; "final_trade" scores convergence. */
  engine: string;
  count: number;
  base_rate: string | null;
  brier: string | null;
  reliability: string | null;
  resolution: string | null;
  uncertainty: string | null;
  /** The residual the binning leaves. Without it the four terms do not add up. */
  binning: string | null;
  skill: string | null;
  bias_slope: string | null;
  median_horizon_s: number | null;
  thin: boolean;
  bins: CoherenceReliabilityBin[];
  isotonic_map: CoherenceMapPoint[];
  composition: CoherenceCompositionRow[];
  detail: string;
}

/* ----------------------------------------------------------- settlement -- */

export interface CoherenceWeatherSample {
  ts_ms: number;
  value: string;
  contributors: number;
  status: string;
}

export interface CoherenceSettlementFeed {
  state: string;
  detail: string;
  city: string | null;
  config_version: string;
  samples: CoherenceWeatherSample[];
  sample_count: number;
  degraded_samples: number;
  contributors_min: number | null;
  contributors_max: number | null;
  latest_value: string | null;
  window_minutes: number;
  window_average: string | null;
  window_average_clean: string | null;
  /** Latest reading minus the settlement window's average: the basis itself. */
  spot_minus_window: string | null;
  reference_rate_state: string;
  reference_rate_detail: string;
}

/* ------------------------------------------------------------------ rfq -- */

export interface CoherenceDispersion {
  market_ticker: string;
  /**
   * The Frechet band this market's legs leave, and the share of it the makers
   * actually disagree over — the §8.4 measurement. Null where no combo reading
   * covers the market or the panel is too thin: never zero, which would read
   * as "the makers agree exactly" rather than "this was not measured".
   */
  band_width: string | null;
  band_fraction: string | null;
  band_note: string;
  quotes: number;
  usable: number;
  median: string | null;
  lowest: string | null;
  highest: string | null;
  spread: string | null;
  median_width: string | null;
  crossed: number;
  thin: boolean;
  detail: string;
}

export interface CoherenceRfqPanel {
  state: string;
  detail: string;
  open_requests: number;
  dispersions: CoherenceDispersion[];
}

/* ---------------------------------------------------------------- shell -- */

export interface CoherenceShellEntry {
  name: string;
  kind: string;
  detail: string;
}

export interface CoherenceShell {
  state: string;
  path: string;
  command: string;
  exists: boolean;
  entries: CoherenceShellEntry[];
  body: string;
  detail: string;
}

/* --------------------------------------------------------------- guards -- */

export function isCoherenceSurface(value: unknown): value is CoherenceSurface {
  return isRecord(value) && typeof value.state === "string" && Array.isArray(value.bins);
}

export function isCoherenceKelly(value: unknown): value is CoherenceKelly {
  return isRecord(value) && typeof value.state === "string" && Array.isArray(value.stakes);
}

export function isCoherenceCombos(value: unknown): value is CoherenceCombos {
  return isRecord(value) && typeof value.state === "string" && Array.isArray(value.combos);
}

export function isCoherenceCalibration(value: unknown): value is CoherenceCalibration {
  return isRecord(value) && typeof value.state === "string" && Array.isArray(value.bins);
}

export function isCoherenceSettlementFeed(value: unknown): value is CoherenceSettlementFeed {
  return isRecord(value) && typeof value.state === "string" && Array.isArray(value.samples);
}

export function isCoherenceRfqPanel(value: unknown): value is CoherenceRfqPanel {
  return isRecord(value) && typeof value.state === "string" && Array.isArray(value.dispersions);
}

export function isCoherenceShell(value: unknown): value is CoherenceShell {
  return isRecord(value) && typeof value.state === "string" && Array.isArray(value.entries);
}
