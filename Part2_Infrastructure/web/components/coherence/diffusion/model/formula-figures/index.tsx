"use client";

/**
 * Card id to figure, and the assertion that the two lists are the same list.
 *
 * A REGISTRY RATHER THAN A FIELD ON `FORMULAS`, the same shape
 * `lesson-figures/index.tsx` uses: the catalogue stays a list of claims and a
 * fourteenth card cannot break the drawings.
 *
 * COMPLETE, THOUGH, WHERE THE LESSONS REGISTRY IS DELIBERATELY PARTIAL. Every
 * card here names a mechanism AND a failure, so a card with no figure is a gap
 * rather than a decision — and `diffusion-model-views.test.ts` holds the two
 * lists to a bijection so it stays that way.
 */

import { type ReactNode } from "react";

import { Absorbed, Exponential, Floor, HalfLife, Overshoot, Power, States } from "./measurement";
import { Clock, Identity, Mmse, Percentile, Skill, Spectrum } from "./instrument";

export const FORMULA_FIGURES: Record<string, () => ReactNode> = {
  absorbed: Absorbed,
  overshoot: Overshoot,
  floor: Floor,
  halflife: HalfLife,
  states: States,
  exponential: Exponential,
  power: Power,
  clock: Clock,
  percentile: Percentile,
  mmse: Mmse,
  spectrum: Spectrum,
  identity: Identity,
  skill: Skill,
};

/** The figure for a card, or nothing if the registry has drifted from the list. */
export default function FormulaFigure({ id }: { id: string }) {
  const Figure = FORMULA_FIGURES[id];
  return Figure ? <Figure /> : null;
}
