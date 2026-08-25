"use client";

/**
 * The two stage constants, and the three sentences a section says instead of a
 * figure when the ledger has nothing to draw.
 *
 * SHARED RATHER THAN COPIED, and that is the whole reason this file exists.
 * Since 2026-08-25 two sections read the same absorption ledger — the
 * announcement arm and Meetings — and both have to answer the same three
 * questions before they can draw anything: did the read fail, has it landed
 * yet, and is the ledger configured at all. Those three sentences are the
 * sections' null honesty. A second spelling of them in the second section is
 * exactly the drift the house rule ("empty results are reported, not hidden")
 * is written against, and no test in this suite could catch two panes wording
 * the same absence differently.
 *
 * The constants are here for the same reason one level down. `STAGE_TERMINAL_MIN`
 * is now spent in two sections — the arm's chip prints it and the Meetings
 * timeline draws it — and two literals is two places for thirty to become
 * twenty-five.
 */

import { type ReactNode } from "react";

import type { AbsorptionRead } from "./types";

/** Both stages are measured over a window of this length, each from its own t₀. */
export const STAGE_TERMINAL_MIN = 30;
/** The issuer's own gap between the statement and the press conference. */
export const STAGE_GAP_MIN = 30;

export const STAGE_WORD: Record<string, string> = {
  release: "statement",
  call: "press conference",
};

/**
 * Whether there is a ledger to draw, as a TYPE PREDICATE.
 *
 * Its twin below decides what to say when there is not, and a caller runs both:
 * `const notice = absorptionNotice(read, error); if (!absorptionReady(read)) return notice;`
 * The predicate is what narrows `read` for the rest of the section, so the
 * drawing code reads `read.runs` rather than `read!.runs`. A non-null assertion
 * would compile and would also be the house's least favourite shape — it asserts
 * a fact the type system cannot see, one line away from the code that
 * establishes it.
 */
export function absorptionReady(read: AbsorptionRead | null): read is AbsorptionRead {
  return read !== null && read.state === "ok";
}

/**
 * What to render instead of the section, or `null` when there is a read to draw.
 *
 * Returns a node rather than taking a render prop so the caller reads as
 * `const notice = absorptionNotice(read, error); if (notice) return notice;` —
 * one line at the top of each section, in the same order, saying the same
 * things.
 */
export function absorptionNotice(read: AbsorptionRead | null, error: string | null): ReactNode | null {
  if (error && !read) {
    return (
      <p className="console-empty">
        <span aria-hidden="true">✕</span> The absorption ledger could not be read: {error}
      </p>
    );
  }
  if (!read) return <p className="console-empty muted">Reading the absorption ledger…</p>;
  if (read.state !== "ok") {
    return (
      <p className="console-empty">
        <span aria-hidden="true">◌</span>{" "}
        {read.reason ?? "The absorption ledger is not configured — not the same as no events."}
      </p>
    );
  }
  return null;
}
