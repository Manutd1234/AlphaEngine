import type { PortfolioPayload, SessionAttribution } from "@/lib/portfolio";

// --------------------------------------------------------------------------
// Reading the session block
// --------------------------------------------------------------------------

export type SessionRead =
  | { state: "ok"; session: SessionAttribution; basis: "audited" | "generated" }
  /** No block at all, or a `{}` from a gateway running without an audit log. */
  | { state: "absent" }
  /** The block covers a different UTC day than the book's own session. */
  | { state: "mismatch"; blockDate: string }
  /** The book and the block disagree about whether any of this is real. */
  | { state: "inconsistent" };

/**
 * The session block, accepted only when it describes *this* book and *this* day.
 *
 * Three rejections, each for a different lie it could otherwise tell:
 *
 *  - A `basis` that disagrees with `book.sandbox` means one of the two is
 *    describing a book that does not exist. A live gateway must never emit
 *    `generated`, and the sandbox must never claim `audited` fills, so the
 *    contradiction is surfaced rather than resolved in favour of either.
 *  - A `session_date` other than the book's is a stale or restarted gateway.
 *    Those costs are real, they are simply another day's, and subtracting them
 *    from this day's P&L is the same error as using the lifetime totals. A
 *    block that names *no* date is accepted rather than rejected — the costs may
 *    well be this session's — but silence is not agreement, so `costLegs` says
 *    the date could not be checked instead of asserting a day the block never
 *    claimed.
 *  - Anything without a `basis` is the empty block, which is a gateway with no
 *    audit log rather than a gateway reporting zero cost.
 */
export function readSession(book: PortfolioPayload, sandbox: boolean): SessionRead {
  const session = book.attribution?.session;
  if (!session || typeof session !== "object") return { state: "absent" };

  const basis = session.basis;
  if (basis !== "audited" && basis !== "generated") return { state: "absent" };
  if (sandbox !== (basis === "generated")) return { state: "inconsistent" };

  const blockDate = session.session_date;
  if (typeof blockDate === "string" && blockDate && blockDate !== book.session_date) {
    return { state: "mismatch", blockDate };
  }

  return { state: "ok", session, basis };
}
