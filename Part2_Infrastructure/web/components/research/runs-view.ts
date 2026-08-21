/**
 * What the Fitted models panel renders, decided from a `DeskSourceState`.
 *
 * The panel used to hold a four-state `Load` union whose `loading` arm carried
 * no payload, so `refresh()` blanked the measured table on every read and a
 * single failed probe replaced it with a failure card. Against a gateway
 * answering every other request, the table, the tiles and the capsule
 * alternated with the poll — the cockpit's `setBook(null)` defect in
 * miniature. `DeskSourceMachine` already makes that unrepresentable (measured
 * data is never replaced; demotion immediate, promotion needs a streak), so
 * the panel routes its probes through `useDeskSource` and this function maps
 * the machine's state to the three things the panel can honestly show.
 *
 * A function rather than JSX so `research-stability.test.ts` can replay a
 * scripted pass/fail sequence and read the decision with no DOM — the same
 * argument `desk-source.ts` makes for not being a hook.
 *
 * One deliberate wording constraint follows from the shape: the `caution` on a
 * held reading must render as ONE stable sentence for the whole episode. Its
 * `reason` is null while the gateway is being confirmed back (the machine
 * clears `failure` on any success) and set again on the next drop, so copy
 * that switches on it would alternate two sentences at the poll cadence —
 * the note-level version of the flicker this module removes.
 */

import type { DeskSourceState } from "@/lib/desk-source";

export type RunsView<T> =
  /** No probe has settled: the panel is reading, and says so. */
  | { kind: "connecting" }
  /** Nothing was ever measured and the gateway is not answering. */
  | { kind: "unreachable"; reason: string }
  /**
   * A measured payload — the only state that shows runs. `caution` is null
   * while the reading is current, and set while it is a held last-good read:
   * the gateway has dropped a probe since, or its recovery is still one
   * success short of the promotion streak.
   */
  | { kind: "runs"; payload: T; caution: { reason: string | null; lastGoodAt: Date } | null };

export function runsView<T>(state: DeskSourceState<T>): RunsView<T> {
  const { showing } = state;

  if (showing.kind === "measured") {
    return {
      kind: "runs",
      payload: showing.payload,
      caution: showing.tier === "cached"
        ? { reason: state.failure?.message ?? null, lastGoodAt: showing.lastGoodAt }
        : null,
    };
  }

  if (!state.settled) return { kind: "connecting" };

  // Nothing measured, ever. The machine reports this as `generated` when a
  // fallback would be allowed, but this panel never invents a corpus — either
  // branch renders as the same fact: the gateway could not be reached.
  return {
    kind: "unreachable",
    reason: state.failure?.message ?? "the gateway did not answer",
  };
}
