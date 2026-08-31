import { DOLLAR_CC, toCenticents } from "./fixed-point";
import { toUnit } from "./decimals";
import type { CoherenceCombo } from "./types-lab";

export type ParlaySimulationMode = "quote" | "legs";

export interface SimulationLeg {
  key: string;
  ticker: string;
  label: string;
  side: string;
  probabilityCc: number | null;
}

export interface SimulationReading {
  quoteCc: number | null;
  lowerCc: number | null;
  upperCc: number | null;
  independence: number | null;
}

export interface ParlaySimulationSource {
  live: SimulationReading;
  legs: SimulationLeg[];
}

export interface FrechetResult {
  lowerCc: number | null;
  upperCc: number | null;
  independence: number | null;
  missing: number;
}

export const CENT_CC = 100;

export function probabilityCc(value: number | null | undefined): number | null {
  if (value == null || !Number.isInteger(value) || value < 0 || value > DOLLAR_CC) return null;
  return value;
}

/** Keep a sub-cent live origin valid while every native range move stays one cent. */
export function centStepDomain(originCc: number): { minCc: number; maxCc: number } {
  const origin = probabilityCc(originCc) ?? 0;
  const offset = origin % CENT_CC;
  return {
    minCc: offset,
    maxCc: DOLLAR_CC - ((DOLLAR_CC - offset) % CENT_CC),
  };
}

function wireProbabilityCc(value: string | null): number | null {
  return probabilityCc(toCenticents(value));
}

function wireProbability(value: string | null): number | null {
  const parsed = toUnit(value);
  return parsed != null && parsed >= 0 && parsed <= 1 ? parsed : null;
}

/** Fréchet bounds and the independence reference from required-side inputs. */
export function frechetFromCenticents(values: readonly (number | null)[]): FrechetResult {
  if (values.length === 0) {
    return { lowerCc: null, upperCc: null, independence: null, missing: 0 };
  }

  const probabilities = values.map(probabilityCc);
  const missing = probabilities.filter((value) => value == null).length;
  if (missing) return { lowerCc: null, upperCc: null, independence: null, missing };

  const quoted = probabilities as number[];
  const sum = quoted.reduce((total, value) => total + value, 0);
  return {
    lowerCc: Math.max(0, sum - (quoted.length - 1) * DOLLAR_CC),
    upperCc: Math.min(...quoted),
    independence: quoted.reduce((product, value) => product * (value / DOLLAR_CC), 1),
    missing: 0,
  };
}

/** Read only values that are valid probabilities; malformed wire values remain absent. */
export function parlaySimulationSource(combo: CoherenceCombo): ParlaySimulationSource {
  return {
    live: {
      quoteCc: wireProbabilityCc(combo.price),
      lowerCc: wireProbabilityCc(combo.lower_bound),
      upperCc: wireProbabilityCc(combo.upper_bound),
      independence: wireProbability(combo.independence),
    },
    legs: combo.legs.map((leg, index) => ({
      key: `${leg.ticker}:${leg.side}:${index}`,
      ticker: leg.ticker,
      label: leg.label,
      side: leg.side,
      probabilityCc: wireProbabilityCc(leg.probability),
    })),
  };
}

/** Apply a local what-if without mutating or filling any live field. */
export function simulateParlay(
  source: ParlaySimulationSource,
  mode: ParlaySimulationMode,
  quoteCc: number | null,
  legValues: readonly (number | null)[],
): SimulationReading {
  if (mode === "quote") {
    return { ...source.live, quoteCc: probabilityCc(quoteCc) };
  }

  const calculated = frechetFromCenticents(legValues);
  return {
    quoteCc: source.live.quoteCc,
    lowerCc: calculated.lowerCc,
    upperCc: calculated.upperCc,
    independence: calculated.independence,
  };
}

/** A polling change starts a fresh local session; local edits never cross live reads. */
export function parlaySimulationKey(combo: CoherenceCombo, mode: ParlaySimulationMode): string {
  const legInputs = combo.legs.map((leg) => `${leg.ticker}:${leg.side}:${leg.probability ?? "null"}`).join("|");
  return [mode, combo.ticker, combo.price, combo.lower_bound, combo.upper_bound, combo.independence, legInputs].join("|");
}
