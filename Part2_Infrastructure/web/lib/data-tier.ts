/**
 * What a number on screen is, and what it is allowed to do.
 * ========================================================
 *
 * The desk used to answer "is the gateway up?" with a boolean and, when the
 * answer was no, replace a panel with a sentence. Twenty-six surfaces across
 * all eight tabs did that, in six different vocabularies — "Book state
 * unavailable", "gateway unreachable", "needs price history", "book connecting"
 * — and one of them (the fill-quality heatmap) rendered nothing at all.
 *
 * A dead end is not the only alternative to live data, and it is the worst one.
 * There are three real states, and they differ in what they are made of:
 *
 *   live     a payload the backend returned just now
 *   cached   a payload the backend returned earlier, carried with its age
 *   sandbox  a payload this browser generated, seeded and self-consistent
 *
 * `cached` is the tier that does most of the work. Most gateway failures are
 * transient — a redeploy, a dropped connection, an Always-Free database that
 * auto-stopped — and real numbers from forty seconds ago beat generated ones,
 * as long as the screen says how old they are. Falling straight to a generated
 * book on the first failed poll throws away good data to avoid an empty panel.
 *
 * The safety property is not "label it honestly" — labels are advisory. It is
 * that **only `live` enables a write**. In any other tier the order ticket, the
 * kill switch and the operator actions report themselves disabled, because a
 * button that submits an order against a book this browser invented is a
 * different class of wrong from a stale number.
 *
 * There is deliberately no `"unavailable"` member. It existed, and every
 * component that could construct one grew a branch that rendered a sentence
 * instead of a panel. Removing it from the union is what makes those branches a
 * compile error rather than a thing to remember.
 */

/** What the payload on screen is made of. Ordered best to worst. */
export type DataTier = "live" | "cached" | "sandbox";

/**
 * Why we are not live. Kept separate from the tier because the tier decides
 * what is allowed and the cause decides what to say.
 *
 *  - `not-configured` — no gateway in this deployment, by design. The Vercel
 *    workspace cannot host a long-lived WebSocket/DuckDB process, so this is
 *    the normal state of the public desk, not a fault.
 *  - `incident` — a gateway that should answer did not: refused, timed out, or
 *    returned an error. The desk still fills in, and says this word.
 *  - `chosen` — someone clicked Sandbox. Never overridden by a probe.
 */
export type TierCause = "not-configured" | "incident" | "chosen";

export interface Provenance {
  tier: DataTier;
  cause: TierCause | null;
  /** When the backend last actually answered. Null if it never has. */
  lastGoodAt: Date | null;
}

/**
 * Writes are live-only, everywhere, with no per-component judgement.
 *
 * `killSwitchGate` already refused to arm against a disconnected gateway and
 * `WorkingOrders` already had a `writesDisabled` flag; this is the same rule
 * stated once so the twenty-odd surfaces that gained a fallback in this pass
 * cannot each decide it differently.
 */
export function writesEnabled(tier: DataTier): boolean {
  return tier === "live";
}

/** Whether the payload is real backend data, whatever its age. */
export function isMeasured(tier: DataTier): boolean {
  return tier === "live" || tier === "cached";
}

export interface TierBadge {
  /** Shape, never colour alone — the house rule, and it survives forced-colors. */
  glyph: "●" | "◇" | "△";
  label: string;
  detail: string;
  tone: "good" | "warn" | "neutral";
}

/** How long ago, in the desk's usual clipped phrasing. */
function ageOf(at: Date, now: number): string {
  const seconds = Math.max(0, Math.round((now - at.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

/**
 * The one place the four states are put into words.
 *
 * Four, from three tiers: `sandbox` reads differently depending on whether this
 * deployment never had a gateway or lost one, and collapsing those two into
 * "Sandbox" is how an incident comes to look like a configuration choice.
 */
export function describeTier(p: Provenance, now = Date.now()): TierBadge {
  if (p.tier === "live") {
    return { glyph: "●", label: "Live data", detail: "gateway answering", tone: "good" };
  }
  if (p.tier === "cached") {
    return {
      glyph: "●",
      label: "Live data",
      // The age is the whole point of this tier: the numbers are real and they
      // are not now, and a reader cannot tell the difference without being told.
      detail: p.lastGoodAt ? `last good ${ageOf(p.lastGoodAt, now)}` : "last good reading",
      tone: "warn",
    };
  }
  if (p.cause === "incident") {
    return {
      glyph: "△",
      label: "Sandbox",
      detail: "gateway incident · simulated",
      tone: "warn",
    };
  }
  return {
    glyph: "◇",
    label: "Sandbox",
    detail: p.cause === "chosen" ? "simulated · your choice" : "simulated · no gateway here",
    tone: "neutral",
  };
}
