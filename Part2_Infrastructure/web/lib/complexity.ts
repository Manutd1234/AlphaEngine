/**
 * How much detail the workspace opens with.
 *
 * WHAT THIS IS NOT
 *
 * It is not three products, three navigations, or three feature sets. Every tab
 * and every rail section exists at every tier, and `workspace-routing-sections.test.ts`
 * asserts that the list is byte-identical across all three. A tier that hides a
 * tab is a navigation fork, and a beginner who cannot find a feature they were
 * later told about has been lied to about what the tool does.
 *
 * What changes is what is EXPANDED by default and what is one click away. The
 * mechanism is the disclosure elements the panels already use; this only sets
 * their initial state.
 *
 * WHY THAT CONSTRAINT
 *
 * The alternative — a simplified beginner surface that grows features as you
 * advance — has a specific failure this design avoids: the moment a user reads
 * documentation, follows a link, or sits next to a colleague, they discover a
 * control they were told does not exist. Density is a preference. Capability is
 * not, and pretending otherwise makes every screenshot and every instruction
 * conditional on a setting nobody mentions.
 *
 * WHY A NUMBER RATHER THAN A SET OF BOOLEANS
 *
 * `atLeast(tier, "standard")` reads as one question. A record of feature flags
 * per panel would let two panels disagree about what "standard" means, which is
 * how a tier stops being a tier and becomes thirty independent settings.
 */

export const COMPLEXITY_TIERS = ["guided", "standard", "full"] as const;
export type Complexity = (typeof COMPLEXITY_TIERS)[number];

/** Persisted next to `alphaengine-theme`, and read the same way. */
export const COMPLEXITY_STORAGE_KEY = "alphaengine-complexity";

/**
 * The default, and it is deliberately the middle one.
 *
 * A first-time visitor to a quant research desk is far more likely to be an
 * analyst who wants the numbers than a beginner who wants them hidden, and a
 * tool that opens with everything collapsed reads as an empty tool. Guided is a
 * choice someone makes, not a state they are put in.
 */
export const DEFAULT_COMPLEXITY: Complexity = "standard";

const RANK: Record<Complexity, number> = { guided: 0, standard: 1, full: 2 };

/** True when `tier` is at least as detailed as `required`. */
export function atLeast(tier: Complexity, required: Complexity): boolean {
  return RANK[tier] >= RANK[required];
}

/** Cycles guided → standard → full → guided, for a single-button control. */
export function nextComplexity(tier: Complexity): Complexity {
  const index = COMPLEXITY_TIERS.indexOf(tier);
  return COMPLEXITY_TIERS[(index + 1) % COMPLEXITY_TIERS.length];
}

export function isComplexity(value: unknown): value is Complexity {
  return typeof value === "string" && (COMPLEXITY_TIERS as readonly string[]).includes(value);
}

/**
 * What each tier means, in the words the control shows.
 *
 * The descriptions promise density and never capability — "collapsed", "one
 * click away", never "hidden" or "unavailable" — because a control that says a
 * feature is unavailable when it is one click away is the exact
 * misunderstanding this whole module is shaped to prevent.
 */
export const COMPLEXITY_LABELS: Record<Complexity, { label: string; description: string }> = {
  guided: {
    label: "Guided",
    description: "Headline numbers first; formulas, tables and advanced controls stay collapsed.",
  },
  standard: {
    label: "Standard",
    description: "The full desk: every panel expanded, derivations one click away.",
  },
  full: {
    label: "Full",
    description: "Everything open, including normalisation formulas and per-fold tables.",
  },
};
