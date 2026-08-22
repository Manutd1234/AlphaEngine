/**
 * Absolute times for the trust panes.
 *
 * Shared by the two Feeds & Contracts panes, which both print "observed at" and
 * "fetched at" beside a figure. A relative age ("3 minutes ago") is what the
 * evidence cards already say; the footnotes want the instant itself, so a
 * reader can line it up against a gateway log.
 *
 * `not observed` rather than a blank or an epoch: an absent timestamp is a
 * thing that did not happen, and printing nothing invites the reader to supply
 * their own explanation.
 */
export function absoluteTime(value: string | null | undefined): string {
  if (!value) return "not observed";
  const parsed = Date.parse(value);
  return Number.isNaN(parsed)
    ? value
    // Sliced to whole seconds and then labelled, rather than
    // `.replace(".000Z", " UTC")`. That replacement only fired on a timestamp
    // whose milliseconds were exactly zero, and the gateway stamps every one of
    // these with `datetime.now(timezone.utc)` — microseconds included — so in a
    // live deployment the footnote read "2026-08-22 15:37:40.123Z" beside a
    // sibling clause reading "15:00:00 UTC". Measured, not assumed:
    // `Date.parse("2026-08-22T15:37:40.123456+00:00")` renders ".123Z" through
    // the old form. Two spellings of one instant is the imprecision an auditor
    // reads as two different clocks, and the millisecond tail is noise nobody
    // lines up against a gateway log. Seconds, not the minutes `utc()` prints
    // in the ledger: a feed age on this tab is quoted to 0.01 s, so a
    // "fetched at" rounded to the minute could not be placed against it.
    : `${new Date(parsed).toISOString().slice(0, 19).replace("T", " ")} UTC`;
}
