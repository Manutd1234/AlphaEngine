/**
 * What the decision tape renders, decided from the channel state, the opening
 * read, and the rows in hand.
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
 *
 * THE SECOND HALF, added when the tape got a starting state. The tape now
 * opens with a bounded read of the mirror (`use-desk-tape.ts` argues where that
 * page comes from and why not the gateway's blotter route), and the read can
 * fail while the stream works, or work while the stream drops. Those are two
 * absences, so they get two sentences and two independent render decisions —
 * `tapeSurface` for the channel, `openingSurface` for the read. Blurring them
 * into one notice would put the desk back where it started: a card that is
 * missing rows and cannot say which half is missing them.
 *
 * `describeOpening` lives here rather than beside `describeTape` in the hook
 * for a measured reason: `use-desk-tape.ts` sits at 379 lines against a 400
 * ceiling that only ratchets down, and this file is where the pair that must
 * agree — the sentence and the decision to show it — can sit together.
 */

import type { TapeOpening, TapeState } from "@/lib/use-desk-tape";

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

export interface OpeningSurface {
  /** Say what the opening read did. */
  notice: boolean;
  /**
   * The read failed, so the tape is missing every decision from before the
   * pane opened. A warning rather than a note, because a reader who cannot see
   * an order they placed a minute ago is entitled to know the panel knows.
   */
  warn: boolean;
}

/**
 * Independent of `tapeSurface` on purpose — with rows in hand and a live
 * channel, `tapeSurface.notice` is false, and a failed opening read still has
 * to speak. That is the whole reason this is a second function.
 *
 * The single exception is the one case where the two states share one cause: no
 * public Supabase config means no channel AND no mirror to read, and
 * `describeTape` has already said so. Two sentences there would report one
 * missing configuration as two faults.
 */
export function openingSurface(opening: TapeOpening, state: TapeState): OpeningSurface {
  return {
    notice: !(opening.state === "unconfigured" && state === "unconfigured"),
    warn: opening.state === "unavailable",
  };
}

/**
 * What the opening read did, kept apart from `describeTape` so the two absences
 * cannot collapse into one. Each sentence has to survive being read beside any
 * of that function's four: "the channel dropped" and "the opening read failed"
 * are different halves of the tape going missing, and a reader told only one of
 * them draws the wrong conclusion about the other.
 */
export function describeOpening(opening: TapeOpening): string {
  switch (opening.state) {
    case "unconfigured":
      return "There is no Postgres mirror configured here, so the tape has no earlier decisions to open with.";
    case "reading":
      return "Reading the last few decisions from the mirror, so the tape does not open blank.";
    case "unavailable": {
      // The reason is Postgres' own words, appended rather than paraphrased. An
      // abort is not proof the mirror is empty, so the sentence says what is
      // missing from the tape and never that there was nothing to find.
      const said = opening.reason ? ` Postgres said: ${opening.reason}` : "";
      return "The opening read failed, so decisions from before this pane opened are missing here; "
        + `the Blotter pane still holds them.${said}`;
    }
    case "read":
      return opening.count
        ? `${opening.count} earlier decision${opening.count === 1 ? "" : "s"} came from an opening `
          + "read of the mirror rather than from the stream, marked opening read in the origin column."
        : "The opening read found no earlier decisions for this instrument, so the tape is starting "
          + "genuinely empty rather than starting behind.";
  }
}
