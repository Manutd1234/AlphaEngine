/**
 * What the resting-order panel is showing, decided in one place.
 *
 * `WorkingOrders` polls its own endpoint — the one surface on the Portfolio
 * tab that does — and it used to hold the outcome as a `rows` + `error` pair
 * of `useState`s with no hysteresis. Each poll rewrote both, so a gateway
 * dropping every other request toggled the error banner at the 5s cadence,
 * and a live feed that had never answered rendered the quiet-desk copy
 * ("Nothing is resting…") under the failure banner: a positive claim with no
 * reading behind it.
 *
 * The anti-twitch property now comes from `DeskSourceMachine` — measured data
 * is never replaced, demotion is immediate, promotion needs the streak — and
 * this function is the thin half: it maps the machine's state plus the
 * panel's `source` prop onto the one decision the JSX renders. Pure on
 * purpose, same argument as the machine itself: `portfolio-stability.test.ts`
 * replays a flapping gateway against it with no DOM and no renderer.
 *
 * One vocabulary note. The machine answers "may a generated stand-in appear?"
 * with `showing.kind === "generated"` when a live desk has settled without a
 * reading. For the book that is the sandbox's cue; for resting orders it must
 * not be — inventing orders during an outage is inventing commitments — so
 * that state maps to `failed` here, and `generated` is reachable only from an
 * explicit sandbox source.
 */

import type { WorkingOrderRow } from "@/lib/blotter";
import type { DeskSourceState } from "@/lib/desk-source";

/** Where the caller says the rows come from. Mirrors the panel's prop. */
export type WorkingOrdersSource = "live" | "sandbox" | "unavailable";

export type WorkingOrdersFeedView =
  /** An explicit sandbox: the caller renders the generated resting book. */
  | { kind: "generated" }
  /**
   * Rows the gateway really returned. `stale` is the machine's demotion —
   * stable under an alternating gateway, cleared only by the promotion
   * streak — or the caller declaring the source unavailable, which is the
   * same fact arriving by prop: the reading on screen cannot be refreshed.
   */
  | { kind: "measured"; rows: WorkingOrderRow[]; stale: boolean; lastGoodAt: Date }
  /** The first probe has not settled; say nothing yet. */
  | { kind: "connecting" }
  /** No gateway to ask and no reading to keep. */
  | { kind: "unavailable" }
  /** The feed has never answered. A failure to report, never a quiet desk. */
  | { kind: "failed"; message: string };

export function workingOrdersFeedView(
  source: WorkingOrdersSource,
  state: DeskSourceState<WorkingOrderRow[]>,
): WorkingOrdersFeedView {
  if (source === "sandbox") return { kind: "generated" };

  // Rule 1, inherited from the machine: a reading outranks every other state,
  // including an unavailable source — real rows from a minute ago beat a
  // shrug, provided they are carried as stale.
  if (state.showing.kind === "measured") {
    return {
      kind: "measured",
      rows: state.showing.payload,
      stale: state.showing.tier === "cached" || source === "unavailable",
      lastGoodAt: state.showing.lastGoodAt,
    };
  }

  if (source === "unavailable") return { kind: "unavailable" };
  if (!state.settled) return { kind: "connecting" };

  // Settled, live, and nothing was ever measured. The machine's `failure` is
  // cleared by any success, but a success would have made this `measured` —
  // so the message here describes a condition that is still current.
  return {
    kind: "failed",
    message: state.failure?.message ?? "The working-order feed is not answering.",
  };
}
