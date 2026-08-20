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
    : new Date(parsed).toISOString().replace("T", " ").replace(".000Z", " UTC");
}
