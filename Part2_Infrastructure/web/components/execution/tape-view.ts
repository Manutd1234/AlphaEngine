/**
 * What the decision tape renders, decided from the channel state and the rows
 * in hand.
 *
 * The panel used to gate its whole table on `state === "live"`, so a dropped
 * Supabase channel replaced every decision already on the tape with a
 * one-line banner — and the client reconnects on its own cadence, so a
 * flapping socket alternated table and banner every few seconds. The rows are
 * measured data: decisions Postgres really committed, each carrying its own
 * timestamp. The rule the desk applies to the cockpit's book
 * (`desk-source.ts`: measured data is never replaced by generated data)
 * applies one level down here — a transport state may add a sentence, it must
 * not unmount a reading. No hysteresis is added on top: the state chip is the
 * socket's honest, immediate report, exactly as `VenueLiveness` passes
 * transport states through; what must not follow the flap is the table.
 *
 * A function rather than JSX so `execution-stability.test.ts` can replay a
 * scripted connect/drop/reconnect sequence and read the decision with no DOM
 * — the same argument `runs-view.ts` makes for the Fitted models panel.
 */

import type { TapeState } from "@/lib/use-desk-tape";

export interface TapeSurface {
  /** Render the rows: true whenever any exist, whatever the channel says. */
  table: boolean;
  /**
   * Say the channel's state: whenever the stream is not simply live, or there
   * is nothing else to show. `describeTape` owns the sentence; this decides
   * only that one appears.
   */
  notice: boolean;
}

export function tapeSurface(state: TapeState, rowCount: number): TapeSurface {
  return {
    table: rowCount > 0,
    notice: state !== "live" || rowCount === 0,
  };
}
