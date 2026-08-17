"use client";

/**
 * How much detail the workspace opens with.
 *
 * A three-segment control rather than the cycling button it used to be. The
 * button had to name the tier it would move to, so the label read as a
 * destination while the icon read as a state, and the two other tiers were
 * invisible until you clicked through them. Three segments show the whole
 * range and where you are in it, which is what the setting actually is.
 *
 * It lives inside the header's quick-settings panel now, where a description
 * has room to sit under the control. That matters here: the wording is
 * load-bearing. Every description says "collapsed" or "one click away", never
 * "hidden", and the sentence beneath is now visible rather than only reaching
 * screen readers through an aria-label — a control that implies a feature is
 * unavailable when it is one click away creates exactly the misunderstanding
 * the three-tier design exists to avoid.
 */

import { COMPLEXITY_LABELS, COMPLEXITY_TIERS } from "@/lib/complexity";
import { setComplexity, useComplexity } from "@/lib/use-complexity";

export default function ComplexityToggle() {
  const tier = useComplexity();
  const { description } = COMPLEXITY_LABELS[tier];

  return (
    <div>
      <div className="seg" role="group" aria-label="Detail level">
        {COMPLEXITY_TIERS.map((candidate) => (
          <button
            key={candidate}
            type="button"
            aria-pressed={tier === candidate}
            onClick={() => setComplexity(candidate)}
            title={COMPLEXITY_LABELS[candidate].description}
            className="font-semibold"
          >
            {COMPLEXITY_LABELS[candidate].label}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-fs-xs leading-snug text-text-muted">
        {description} Every tab and section is available at every level; only how much is expanded
        changes.
      </p>
    </div>
  );
}
