"use client";

/**
 * How much detail the workspace opens with.
 *
 * Sits next to the theme toggle because it is the same kind of setting: a
 * viewing preference, persisted, affecting nothing about what the system can
 * do. The wording is load-bearing — every description says "collapsed" or "one
 * click away", never "hidden", because a control that implies a feature is
 * unavailable when it is one click away creates exactly the misunderstanding
 * the three-tier design exists to avoid.
 */

import { Layers } from "lucide-react";

import { COMPLEXITY_LABELS, nextComplexity } from "@/lib/complexity";
import { setComplexity, useComplexity } from "@/lib/use-complexity";

export default function ComplexityToggle() {
  const tier = useComplexity();
  const { label, description } = COMPLEXITY_LABELS[tier];
  const next = nextComplexity(tier);

  return (
    <button
      type="button"
      className="icon theme-toggle"
      onClick={() => setComplexity(next)}
      title={`${label} — ${description} Click for ${COMPLEXITY_LABELS[next].label}.`}
      aria-label={
        `Detail level: ${label}. ${description} `
        + `Switch to ${COMPLEXITY_LABELS[next].label}. `
        + "Every tab and section is available at every level; only how much is expanded changes."
      }
    >
      <Layers size={14} aria-hidden />
      <span>{label}</span>
    </button>
  );
}
