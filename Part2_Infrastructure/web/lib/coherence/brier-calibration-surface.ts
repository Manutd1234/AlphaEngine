import { countLabel, decimalLabel, statValue, unitOf } from "./decimals";
import type { CoherenceCalibration, CoherenceReliabilityBin } from "./types-lab";

export type CalibrationBinState = "point" | "empty" | "unavailable";

export interface CalibrationSurfaceBin {
  key: string;
  label: string;
  index: number;
  count: number | null;
  countText: string;
  low: number | null;
  high: number | null;
  forecast: number | null;
  observed: number | null;
  state: CalibrationBinState;
  forecastText: string;
  observedText: string;
  deviationText: string;
  readout: string;
}

export interface CalibrationMetric {
  label: string;
  value: string;
  role: "total" | "add" | "subtract";
}

function isUnit(value: number | null): value is number {
  return value !== null && value >= 0 && value <= 1;
}

function safeCount(value: number): number | null {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/**
 * One row per probability bin, in the gateway's order and without filling gaps.
 * Floats are geometry only; every displayed quantity stays on the wire string.
 */
export function calibrationSurfaceBins(
  bins: readonly CoherenceReliabilityBin[],
): CalibrationSurfaceBin[] {
  return bins.map((bin, index) => {
    const count = safeCount(bin.count);
    const low = unitOf(bin.low);
    const high = unitOf(bin.high);
    const forecast = unitOf(bin.mean_forecast);
    const observed = unitOf(bin.outcome_rate);
    const boundsReady = isUnit(low) && isUnit(high) && low <= high;
    const pointReady = boundsReady && isUnit(forecast) && isUnit(observed);
    const state: CalibrationBinState = count === null
      ? "unavailable"
      : count === 0
        ? "empty"
        : pointReady
          ? "point"
          : "unavailable";
    const countText = count === null ? "—" : countLabel(count);
    const forecastText = decimalLabel(bin.mean_forecast, 6);
    const observedText = decimalLabel(bin.outcome_rate, 6);
    const deviationText = decimalLabel(bin.deviation, 6);
    const readout = state === "empty"
      ? `Band ${bin.label}: no settled markets; forecast mean and observed frequency are unavailable, so no point is drawn.`
      : state === "unavailable"
        ? `Band ${bin.label}: ${countText} settled; its probability bounds, forecast mean, or observed frequency are unavailable, so no point is drawn.`
        : `Band ${bin.label}: ${countText} settled; forecast mean ${forecastText}; observed frequency ${observedText}; provided deviation ${deviationText}.`;

    return {
      key: `${index}-${bin.label}`,
      label: bin.label,
      index,
      count,
      countText,
      low: boundsReady ? low : null,
      high: boundsReady ? high : null,
      forecast: pointReady ? forecast : null,
      observed: pointReady ? observed : null,
      state,
      forecastText,
      observedText,
      deviationText,
      readout,
    };
  });
}

/** Exact Murphy terms beside the surface; null and malformed values stay dashes. */
export function calibrationMetrics(data: CoherenceCalibration): CalibrationMetric[] {
  const metric = (
    label: string,
    raw: string | null,
    role: CalibrationMetric["role"],
  ): CalibrationMetric => ({
    label,
    value: statValue(raw) === null ? "—" : decimalLabel(raw, 8),
    role,
  });
  return [
    metric("Brier", data.brier, "total"),
    metric("Reliability", data.reliability, "add"),
    metric("Resolution", data.resolution, "subtract"),
    metric("Uncertainty", data.uncertainty, "add"),
    metric("Binning", data.binning, "add"),
  ];
}
