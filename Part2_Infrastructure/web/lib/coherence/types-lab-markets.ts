/**
 * Market-shaped coherence lab readings: distribution surfaces, stakes, and
 * combination bounds.
 *
 * Every decimal remains a string. These fixed-point quantities are parsed at
 * their use sites rather than rounded by JSON's binary64 number representation.
 * Nullable readings remain nullable; malformed collection members do not pass
 * the guards into fixed-point parsers as `undefined`.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
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
  /** Portfolio direction/cost; populated only when this leg belongs to a bound row. */
  direction?: "buy" | "sell" | null;
  execution_cost?: string | null;
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
  testable?: boolean;
  untestable_reason?: string | null;
  violated: boolean;
  legs: CoherenceComboLeg[];
}

export interface CoherenceCombos {
  /** The venue reading's age in seconds; see `CoherenceUniverse`. Null, never zero. */
  observed_age_s: number | null;
  state: string;
  combos: CoherenceCombo[];
  rows: CoherenceComboRow[];
  quoted: number;
  outside_band: number;
  violations: number;
  notes: string[];
}

/* --------------------------------------------------------------- guards -- */

export function isCoherenceSurface(value: unknown): value is CoherenceSurface {
  return isRecord(value)
    && typeof value.state === "string"
    && typeof value.engine === "string"
    && isNullableString(value.basis)
    && typeof value.event_ticker === "string"
    && Array.isArray(value.probes)
    && value.probes.every((probe) => isRecord(probe)
      && typeof probe.strike === "string"
      && typeof probe.survival === "string"
      && typeof probe.ticker === "string"
      && typeof probe.label === "string"
      && typeof probe.origin === "string")
    && Array.isArray(value.bins)
    && value.bins.every((bin) => isRecord(bin)
      && typeof bin.label === "string"
      && isNullableString(bin.low)
      && isNullableString(bin.high)
      && typeof bin.mass === "string"
      && isNullableString(bin.representative)
      && typeof bin.negative === "boolean")
    && isNullableString(value.total_mass)
    && isNullableString(value.tail_mass_low)
    && isNullableString(value.tail_mass_high)
    && isNullableString(value.mean)
    && isNullableString(value.variance)
    && isNullableString(value.standard_deviation)
    && isNullableString(value.skewness)
    && isNullableString(value.excess_kurtosis)
    && typeof value.moments_note === "string"
    && Array.isArray(value.negative_bins)
    && value.negative_bins.every((label) => typeof label === "string")
    && typeof value.detail === "string";
}

export function isCoherenceKelly(value: unknown): value is CoherenceKelly {
  return isRecord(value) && typeof value.state === "string" && Array.isArray(value.stakes);
}

export function isCoherenceCombos(value: unknown): value is CoherenceCombos {
  return isRecord(value) && typeof value.state === "string" && Array.isArray(value.combos);
}
