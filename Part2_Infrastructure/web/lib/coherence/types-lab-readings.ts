/**
 * Aggregate coherence lab readings: calibration, settlement formation, maker
 * dispersion, and the read-only shell.
 *
 * Null is a measured absence, never a zero substitute. The shallow guards keep
 * each pane's discriminator and iterated collection safe while preserving the
 * gateway's nullable readings and explanatory detail.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

export interface CoherenceSeriesBias {
  series_ticker: string;
  /**
   * The favourite–longshot slope for this series alone. Above one is the
   * classic shape. Reported per series because one aggregate slope averages
   * markets that are not the same question, and two halves pointing opposite
   * ways can sit at one together.
   */
  slope: string;
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
  bias_by_series: CoherenceSeriesBias[];
  median_horizon_s: number | null;
  /** The floor the scorer applied, in seconds before close; null when no floor was applied to nothing. */
  horizon_s: number | null;
  thin: boolean;
  bins: CoherenceReliabilityBin[];
  isotonic_map: CoherenceMapPoint[];
  composition: CoherenceCompositionRow[];
  detail: string;
}

/* ---------------------------------------------- calibration over time -- */

/**
 * One scoring run, as it was taken.
 *
 * Every figure is nullable and stays that way. A run against a corpus that
 * would not score keeps its nulls and carries `detail` as the reason: a zero
 * Brier here is a perfect forecaster at the origin of every chart drawn
 * afterwards, which is the coercion this codebase is most alert to.
 *
 * `engine` travels with the point rather than with the series, because a
 * history can carry both: `tape` is a forecast test and `final_trade` is not,
 * and one line through the two would plot foresight and convergence as one
 * measurement. `CalibrationScore`'s banner is the whole argument.
 */
export interface CoherenceCalibrationPoint {
  ts_ns: number;
  engine: string;
  markets: number;
  brier: string | null;
  skill: string | null;
  base_rate: string | null;
  uncertainty: string | null;
  bias_slope: string | null;
  median_horizon_s: number | null;
  /** The floor the scorer applied, in seconds before close; null when no floor was applied to nothing. */
  horizon_s: number | null;
  thin: boolean;
  detail: string | null;
}

/** The settled score over time, oldest first. Accrues forward only: the series
 *  begins where the recorder began, and the figure has to say so. */
export interface CoherenceCalibrationHistory {
  state: string;
  points: CoherenceCalibrationPoint[];
  notes: string[];
}

/* ----------------------------------------------------------- settlement -- */

export interface CoherenceWeatherSample {
  ts_ms: number;
  value: string;
  contributors: number;
  status: string;
}

export interface CoherencePendingMinute {
  ts_ms: number;
  /** What the index will read once QC clears, from readings already in hand. */
  provisional: string | null;
  spread: string | null;
  stations: number;
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
  units: string;
  /**
   * The member stations behind the index, and whether the rule that turns their
   * readings into the published value still reproduces it. Tested against every
   * completed minute rather than assumed: a provisional value computed under a
   * rule that has changed is worse than no provisional value at all.
   */
  stations: string[];
  formation_checked: number;
  formation_agreed: number;
  formation_holds: boolean;
  formation_detail: string;
  /** Minutes the venue omitted, which are minutes the index was not computed. */
  quorum_gaps: number;
  pending: CoherencePendingMinute[];
  window_is_assumed: boolean;
}

/* ------------------------------------------------------------------ rfq -- */

export interface CoherenceDispersion {
  /** Optional while the web can still meet a gateway that grouped by market. */
  rfq_id?: string;
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
  /**
   * The credential environment used for this authenticated REST poll.
   *
   * Optional while the web deployment can still meet an older gateway. Null
   * means the gateway reported that no signer was selected; an omitted field
   * means the gateway predates this provenance field.
   */
  signing_environment?: "production" | "demo" | null;
  open_requests: number;
  /** Complete, deduplicated open quote count; absent on an older gateway. */
  open_quotes?: number;
  dispersions: CoherenceDispersion[];
}

/* ---------------------------------------------------------------- shell -- */

export interface CoherenceShellEntry {
  name: string;
  kind: "dir" | "file";
  detail: string;
}

export interface CoherenceShell {
  state: string;
  path: string;
  command: "ls" | "cat";
  exists: boolean;
  entries: CoherenceShellEntry[];
  body: string;
  detail: string;
}

/* --------------------------------------------------------------- guards -- */

export function isCoherenceCalibration(value: unknown): value is CoherenceCalibration {
  return isRecord(value) && typeof value.state === "string" && Array.isArray(value.bins);
}

export function isCoherenceCalibrationHistory(value: unknown): value is CoherenceCalibrationHistory {
  return isRecord(value) && typeof value.state === "string" && Array.isArray(value.points);
}

export function isCoherenceSettlementFeed(value: unknown): value is CoherenceSettlementFeed {
  return isRecord(value) && typeof value.state === "string" && Array.isArray(value.samples);
}

export function isCoherenceRfqPanel(value: unknown): value is CoherenceRfqPanel {
  return isRecord(value)
    && typeof value.state === "string"
    && Array.isArray(value.dispersions)
    && value.dispersions.every((row) => isRecord(row)
      && (!("rfq_id" in row) || typeof row.rfq_id === "string"))
    && (!("open_quotes" in value)
      || (typeof value.open_quotes === "number"
        && Number.isInteger(value.open_quotes)
        && value.open_quotes >= 0))
    && (!("signing_environment" in value)
      || value.signing_environment === null
      || value.signing_environment === "production"
      || value.signing_environment === "demo");
}

export function isCoherenceShell(value: unknown): value is CoherenceShell {
  return isRecord(value)
    && typeof value.state === "string"
    && typeof value.path === "string"
    && (value.command === "ls" || value.command === "cat")
    && typeof value.exists === "boolean"
    && Array.isArray(value.entries)
    && value.entries.every((entry) => isRecord(entry)
      && typeof entry.name === "string"
      && (entry.kind === "dir" || entry.kind === "file")
      && typeof entry.detail === "string")
    && typeof value.body === "string"
    && typeof value.detail === "string";
}
