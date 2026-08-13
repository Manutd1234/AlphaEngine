/**
 * What this instance can honestly say about its own recoveries.
 *
 * `OperatorPanel` has refused a history chart from the start, and the reasoning
 * was right: "this instance keeps no durable remediation ledger, and a
 * 'resolutions over time' line would have to invent its own past." What changed
 * is not the reasoning but the inputs — `resetBreaker` now emits the closing
 * transition it used to swallow, so open→closed pairs are observable and can be
 * split into automatic and operator recoveries.
 *
 * WHAT THIS SUPPORTS: a count of trips, a split by how each was closed, and a
 * distribution of how long circuits stayed open.
 *
 * WHAT IT STILL REFUSES, and why the refusal is not a caveat that a caption
 * could carry:
 *
 *   A TREND OVER TIME. Pairing needs both the opening and the closing line
 *   still in a 600-event ring shared with dispatch, cache, quota and upstream
 *   traffic. The longest outages are the likeliest to lose their opening line
 *   to eviction — so the surviving sample is BIASED SHORT, and a line through
 *   it slopes toward a recovery time nobody achieved. That is a wrong answer,
 *   not an imprecise one, and no amount of labelling fixes a chart whose bias
 *   points the same way as the flattering conclusion.
 *
 * The bounds it does carry as captions: per function instance, bounded ring,
 * reset by redeploy and by Clear telemetry, and a closure is not a fix — one
 * successful probe closes a circuit that may re-open three failures later.
 */

import type { TraceEvent } from "@/lib/observability";

/** Below this a rate is the sample size talking. 1/1 rendered as 100% is theatre. */
export const MIN_TRIPS_FOR_RATE = 3;

export interface BreakerPair {
  provider: string;
  openedAt: number;
  closedAt: number | null;
  elapsedMs: number | null;
  /** Null while unresolved — an open circuit has no recovery to attribute. */
  by: "automatic" | "operator" | null;
  failures: number | null;
}

export interface RemediationModel {
  pairs: BreakerPair[];
  trips: number;
  recoveredAutomatically: number;
  recoveredByOperator: number;
  stillOpen: number;
  /** Null below MIN_TRIPS_FOR_RATE. */
  rate: number | null;
  medianCloseMs: number | null;
  longestCloseMs: number | null;
  /** The ring evicted lines, so the counts below are a floor rather than a total. */
  truncated: boolean;
  /**
   * Operator drills, counted separately and NEVER folded into recoveries:
   * a simulated outage is self-inflicted and clearing it is not a recovery from
   * anything, so counting it would inflate the rate with the desk's own tests.
   */
  drills: { simulated: number; cleared: number };
}

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export function deriveRemediation(
  events: TraceEvent[],
  cursor: { oldest: number; latest: number; retained: number; capacity: number },
): RemediationModel {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);

  const pairs: BreakerPair[] = [];
  /** Providers with an opening that has not yet been matched. */
  const open = new Map<string, BreakerPair>();
  let simulated = 0;
  let cleared = 0;

  for (const event of ordered) {
    if (event.source === "Operator") {
      const action = String(event.fields.action ?? "");
      if (action === "simulate_outage") simulated += 1;
      if (action === "clear_outage") cleared += 1;
      continue;
    }
    if (event.source !== "Breaker") continue;

    const provider = String(event.fields.provider ?? "");
    if (!provider) continue;
    const state = String(event.fields.state ?? "");

    if (state === "open") {
      // A second opening before any closure is a SECOND trip, not a duplicate.
      // Overwriting here would silently merge two incidents into one.
      const previous = open.get(provider);
      if (previous) pairs.push(previous);
      open.set(provider, {
        provider,
        openedAt: event.ts,
        closedAt: null,
        elapsedMs: null,
        by: null,
        failures: num(event.fields.failures),
      });
      continue;
    }

    if (state === "closed") {
      const pending = open.get(provider);
      if (!pending) continue; // A closure whose opening aged out of the ring.
      open.delete(provider);
      pairs.push({
        ...pending,
        closedAt: event.ts,
        elapsedMs: Math.max(0, event.ts - pending.openedAt),
        by: event.fields.by === "operator" ? "operator" : "automatic",
      });
    }

    /**
     * `half_open` is NOT a closure. `breakerOpen()` emits it every time a
     * cooldown elapses, whether or not the probe that follows succeeds —
     * treating it as a recovery would count every cooldown as a fix.
     */
  }

  for (const pending of open.values()) pairs.push(pending);
  pairs.sort((a, b) => a.openedAt - b.openedAt);

  const closed = pairs.filter((pair) => pair.elapsedMs != null);
  const durations = closed
    .map((pair) => pair.elapsedMs as number)
    .sort((a, b) => a - b);

  const recoveredAutomatically = closed.filter((pair) => pair.by === "automatic").length;
  const recoveredByOperator = closed.filter((pair) => pair.by === "operator").length;

  return {
    pairs,
    trips: pairs.length,
    recoveredAutomatically,
    recoveredByOperator,
    stillOpen: pairs.length - closed.length,
    rate: pairs.length >= MIN_TRIPS_FOR_RATE ? closed.length / pairs.length : null,
    medianCloseMs: durations.length
      ? durations[Math.floor((durations.length - 1) / 2)]
      : null,
    longestCloseMs: durations.length ? durations[durations.length - 1] : null,
    // `oldest > 1` means lines existed that this reader will never receive, so
    // some openings are gone and the counts are a floor.
    truncated: cursor.oldest > 1,
    drills: { simulated, cleared },
  };
}
