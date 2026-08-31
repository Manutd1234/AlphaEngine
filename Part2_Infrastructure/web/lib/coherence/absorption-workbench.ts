/**
 * The exact evidence behind the absorption workbench.
 *
 * The gateway owns the two mean curves. This module never rebuilds those
 * means: it pairs each payload value with the middle half of the SAME
 * floor-cleared run cells `absorptionBand` already uses, and applies the
 * browser's parity-tested `halfLife` only to locate the mean curve's crossing.
 * Missing means stay missing, refused runs stay counted in the stage summary,
 * and a crossing the horizon grid cannot resolve stays a refusal.
 */

import { absorptionBand, type HorizonBand } from "./absorption-band";
import { halfLife, type HalfLife } from "./diffusion-model";

import type { StageRun } from "@/components/coherence/diffusion/types";

export type AbsorptionStage = "release" | "call";

export interface AbsorptionCellEvidence {
  /** The gateway's aggregate, not a mean recomputed in this browser. */
  mean: number | null;
  /** Middle 50% and its exact population, computed from existing run cells. */
  band: HorizonBand;
  /** Where this table row came from, including a wire reason when absent. */
  provenance: string;
}

export interface AbsorptionHorizonEvidence {
  horizon: string;
  seconds: number | null;
  release: AbsorptionCellEvidence;
  call: AbsorptionCellEvidence;
}

export interface AbsorptionWorkbenchEvidence {
  rows: AbsorptionHorizonEvidence[];
  seconds: Array<number | null>;
  crossings: Record<AbsorptionStage, HalfLife>;
}

const CELL_STATE: Record<string, string> = {
  ok: "measured",
  pending: "pending",
  uncaptured: "uncaptured",
  insufficient: "insufficient bars",
  unavailable: "no source",
};

/** Parse only a unit the wire can state; an unknown label never becomes zero. */
export function horizonSeconds(label: string): number | null {
  const match = /^(\d+(?:\.\d+)?)(s|m|h)$/.exec(label.trim());
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const multiplier = match[2] === "s" ? 1 : match[2] === "m" ? 60 : 3_600;
  return value * multiplier;
}

function curveCrossing(
  seconds: readonly (number | null)[],
  curve: readonly (number | null)[],
): HalfLife {
  const measured = seconds
    .map((x, index) => ({ x, y: curve[index] ?? null }))
    .filter((point): point is { x: number; y: number } => point.x != null && point.y != null);
  return halfLife(measured.map((point) => point.x), measured.map((point) => point.y));
}

function rowProvenance(
  runs: readonly StageRun[],
  stage: AbsorptionStage,
  horizon: string,
  mean: number | null,
  band: HorizonBand,
): string {
  if (mean != null) {
    return `payload mean; middle 50% from ${band.n} floor-cleared run cell${band.n === 1 ? "" : "s"}`;
  }

  const stageRuns = runs.filter((run) => run.stage === stage);
  const cells = stageRuns.flatMap((run) => run.cells.filter((cell) => cell.horizon === horizon));
  const counts = new Map<string, number>();
  const reasons: string[] = [];
  for (const cell of cells) {
    const word = cell.absorbed == null && cell.state === "ok"
      ? "no absorbed value"
      : CELL_STATE[cell.state] ?? cell.state;
    counts.set(word, (counts.get(word) ?? 0) + 1);
    if (cell.reason && !reasons.includes(cell.reason)) reasons.push(cell.reason);
  }
  const states = [...counts].map(([word, count]) => `${count} ${word}`).join(", ");
  const refused = stageRuns.filter((run) => run.signal_state !== "ok").length;
  return [
    "payload has no mean",
    states || "no horizon cell on the record",
    refused ? `${refused} stage${refused === 1 ? "" : "s"} refused before aggregation` : "",
    reasons[0] ?? "",
  ].filter(Boolean).join("; ");
}

export function absorptionWorkbenchEvidence(
  horizons: readonly string[],
  release: readonly (number | null)[],
  call: readonly (number | null)[],
  runs: readonly StageRun[],
): AbsorptionWorkbenchEvidence {
  const seconds = horizons.map(horizonSeconds);
  const releaseBands = absorptionBand(runs, "release", horizons);
  const callBands = absorptionBand(runs, "call", horizons);
  const rows = horizons.map((horizon, index) => {
    const releaseMean = release[index] ?? null;
    const callMean = call[index] ?? null;
    const releaseBand = releaseBands[index];
    const callBand = callBands[index];
    return {
      horizon,
      seconds: seconds[index],
      release: {
        mean: releaseMean,
        band: releaseBand,
        provenance: rowProvenance(runs, "release", horizon, releaseMean, releaseBand),
      },
      call: {
        mean: callMean,
        band: callBand,
        provenance: rowProvenance(runs, "call", horizon, callMean, callBand),
      },
    };
  });
  return {
    rows,
    seconds,
    crossings: {
      release: curveCrossing(seconds, release),
      call: curveCrossing(seconds, call),
    },
  };
}

/** Where a resolved log-time crossing sits on the curve's ordinal horizon axis. */
export function crossingOrdinal(
  crossing: HalfLife,
  seconds: readonly (number | null)[],
): number | null {
  if (crossing.state !== "ok" || crossing.value == null) return null;
  for (let upper = 1; upper < seconds.length; upper += 1) {
    const lo = seconds[upper - 1];
    const hi = seconds[upper];
    if (lo == null || hi == null || crossing.value < lo || crossing.value > hi) continue;
    if (hi === lo) return upper;
    const weight = (Math.log(crossing.value) - Math.log(lo)) / (Math.log(hi) - Math.log(lo));
    return upper - 1 + Math.min(1, Math.max(0, weight));
  }
  return null;
}
