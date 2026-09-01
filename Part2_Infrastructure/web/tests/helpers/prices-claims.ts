/**
 * The load-bearing claims of the Kalshi engine's READING panes.
 *
 * A table, in its own module, for the reason every table in this repository
 * ends up in one: `coherence-reading-claims.test.ts` crossed the 400-line
 * ceiling when the engine split into Prices and Proofs on 2026-08-24, and the
 * house rule is to SPLIT rather than shave prose — a claim guard that pays for
 * a new entry by deleting the sentence explaining an old one is a guard being
 * quietly retired. The seam is the obvious one: the data here, the assertions
 * over it there, and neither needs the other to be read.
 *
 * Chosen by one rule: a reader who did not meet this sentence would take away
 * something false. Not "everything true on the tab" — the tables and figures
 * carry most of that, and a guard over all of it would pin the whole tab in
 * place.
 */

/**
 * A claim, the phrase that carries it, and how many places may say it.
 *
 * `at` is a count and not a file, because which file says it is a design
 * decision that may change; how MANY say it is the property being defended.
 * Every entry at 1 is the default. The three at 2 are claims whose two sites
 * are on views that cannot render together — a listing and the Layout drawing,
 * a family's outcome table and a book's identity strip — and each says so.
 */
export const CLAIMS: ReadonlyArray<{ claim: string; phrase: string; at?: number; why?: string }> = [
  // ---- the books ---------------------------------------------------------
  {
    claim: "Kalshi sends two bid ladders and no asks, so every offer is implied",
    phrase: "two bid ladders, not asks; each offer mirrors the opposite ladder",
  },
  {
    claim: "yes ask + no ask is always $1 + spread, so buying both sides under a dollar is unreachable",
    phrase: "never below a dollar",
  },
  {
    claim: "and unreachable rather than merely rare",
    phrase: "unreachable, not merely rare",
  },
  {
    claim: "the implied offer is the opposite ladder read from the other side",
    phrase: "the NO ladder read from the other side",
  },
  // ---- the baskets -------------------------------------------------------
  {
    claim: "buying a basket needs every ask and selling needs every bid",
    phrase: "Buying a basket needs every ask and selling it needs every bid",
  },
  {
    claim: "so a family can be bought and not sold",
    phrase: "it can be bought and not sold",
  },
  {
    claim: "a total built from the quoted legs only would invent an arbitrage",
    phrase: "understate it by exactly the legs it skipped",
    at: 2,
    why: "the overview figure's footnote covers the whole watchlist; the per-family note "
      + "covers the one family whose bar could not be drawn, and they are different objects",
  },
  {
    claim: "and DollarBar says which leg it was, on the family that could not be drawn",
    phrase: "which is the direction that invents an arbitrage",
  },
  {
    claim: "the exchange's own mutually-exclusive flag decides whether prices must sum",
    phrase: "flag decides that, not our arithmetic",
  },
  {
    claim: "asset types are Kalshi's own category, never inferred from the ticker",
    phrase: "own category for each series, never read off the ticker",
  },
  {
    claim: "and an uncategorised series is grouped rather than guessed at",
    phrase: "grouped as uncategorised rather than guessed at",
  },
  // ---- settlement --------------------------------------------------------
  {
    claim: "a contract settles on a published index over a window, not on the price on screen",
    phrase: "not screen price",
  },
  {
    claim: "an entitlement failure is only claimed after production authentication succeeds",
    phrase: "authentication succeeded, but this account lacks access",
  },
  {
    claim: "coverage is one city, so nothing here is venue-wide",
    phrase: "Coverage is one city",
  },
  {
    claim: "a minute with no published spread gets a dash, never a zero-length bar",
    phrase: "rather than a zero-length bar",
  },
  // ---- maker dispersion --------------------------------------------------
  {
    claim: "signing_unavailable is a fact about this deployment, not an empty market",
    phrase: "Not an empty market.",
  },
  {
    claim: "refused means the channel answered, which is stronger than silence",
    phrase: "Not silence.",
  },
  {
    claim: "empty is a completed authenticated measurement, not a failed read",
    phrase: "signed HTTP poll completed with zero open requests",
  },
  {
    claim: "available is not one price, it is several independent answers",
    phrase: "Several makers answered independently",
  },
  {
    claim: "a state the pane has not been taught is named rather than folded into the four",
    phrase: "rather than folded into the nearest",
  },
  {
    claim: "spread between makers is not one maker's own bid-offer",
    phrase: "median width is one maker",
  },
  {
    claim: "and the two are opposite situations",
    phrase: "opposite situations",
  },
  {
    claim: "crossed quotes are counted and excluded, never averaged in",
    phrase: "counted and excluded, never averaged in",
  },
  {
    claim: "an unmeasured ratio is not a ratio of zero",
    phrase: "an unmeasured ratio is not a ratio of zero",
  },
  // ---- the stake ---------------------------------------------------------
  {
    claim: "growth-optimal is not riskless",
    phrase: "not riskless",
  },
  {
    claim: "the worst case is printed as what a dollar becomes",
    phrase: "in the worst outcome",
    at: 2,
    why: "the warning states it with the arbitrage it is being contrasted against, and the "
      + "plan table's Worst-case wealth row states what the figure IS; the second is drawn "
      + "when there is no arbitrage and the first is not",
  },
  {
    claim: "the exclusive-family solver declines a strike ladder by name",
    phrase: "declines this family by name",
  },
  // ---- the shell ---------------------------------------------------------
  {
    claim: "a path that names nothing is named explicitly",
    phrase: "No such path",
  },
  {
    claim: "a listed file whose reading this read could not produce can come back later",
    phrase: "the path exists, the reading does not, in this read",
  },
  {
    claim: "an empty directory exists and holds nothing watched",
    phrase: "This directory is empty",
  },
  {
    claim: "a venue that could not be read is an outage, not an empty directory",
    phrase: "That is an outage and not an empty directory",
  },
  {
    claim: "collateral is held per shard, so one order group cannot span two",
    phrase: "collateral never crosses their boundary",
    why: "the Routing readout states the consequence beside the activity diagram that applies it",
  },
  {
    claim: "the namespace and browser are the configured watchlist, not the whole exchange",
    phrase: "not the whole exchange",
    at: 2,
    why: "Namespace and Browse state their scope independently and never co-render",
  },
];
