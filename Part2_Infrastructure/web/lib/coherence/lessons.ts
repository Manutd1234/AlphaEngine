/**
 * The ten lessons, and the code each one is about.
 *
 * Shaped after `lib/strategy-docs/model.ts`: a summary, the rule as a plain
 * Unicode formula, when it holds, and — mandatory, never a hedge — how it
 * fails. The failure line is the one that earns the entry. A lesson that only
 * says what is true teaches a reader to trust it everywhere, and every item
 * here has a boundary that matters more than the statement.
 *
 * `guards` names the module the lesson is about and `pinnedBy` the test that
 * would go red if the lesson stopped being true. That pairing is the point of
 * the catalogue: these are not notes beside the code, they are claims the suite
 * enforces, and `coherence-lessons.test.ts` checks every named file exists.
 */

export interface CoherenceLesson {
  id: string;
  title: string;
  summary: string;
  /** A plain Unicode string. There is no KaTeX here and none may be added. */
  formula?: string;
  whenItHolds: string;
  whenItFails: string;
  /** Where this lesson lives on the tab. */
  pane: string;
  guards: string[];
  pinnedBy: string[];
  /** False until the slice that ships it lands. Shown as pending, never hidden. */
  shipped: boolean;
}

export const COHERENCE_LESSONS: CoherenceLesson[] = [
  {
    id: "book",
    title: "A binary book has two bid ladders and no asks",
    summary:
      "Kalshi publishes resting YES bids and resting NO bids. The offer you would trade against is a reading of the opposite ladder, so the sum of the two asks is one dollar plus the spread and is never below a dollar.",
    formula: "yes_ask + no_ask = (1 − no_bid) + (1 − yes_bid) = 1 + spread",
    whenItHolds:
      "Always, on any single snapshot of one market. It is an identity in the definitions, not a property of a liquid book.",
    whenItFails:
      "Never as arithmetic — but it appears to fail when the two ladders are read at different instants. A sum below a dollar means a torn snapshot, and a bot that trades on it is trading on its own latency.",
    pane: "books",
    guards: ["modules/coherence/kernel/book.py"],
    pinnedBy: ["tests/test_coherence_lesson_0.py"],
    shipped: true,
  },
  {
    id: "fixedpoint",
    title: "Prices are fixed point, and float breaks them where it matters",
    summary:
      "Prices arrive as decimal strings on a grid that can be as fine as a hundredth of a cent, and every decision here is a comparison at the fourth decimal place. The engine parses to Decimal and never converts.",
    formula: "0.1 + 0.2 ≠ 0.3 in binary64; eight legs at 0.1250 must total exactly 1.0000",
    whenItHolds:
      "Wherever a price is compared to another price or to a dollar — which on this tab is everywhere.",
    whenItFails:
      "A float engine is not slightly wrong. It is right on every case a casual test would try and wrong on the marginal ones, which are the only cases an arbitrage engine looks at.",
    pane: "books",
    guards: ["modules/coherence/kernel/money.py", "modules/coherence/kernel/grid.py"],
    pinnedBy: ["tests/test_coherence_money.py", "tests/test_coherence_grid.py", "tests/test_coherence_no_float.py"],
    shipped: true,
  },
  {
    id: "grid",
    title: "Valid prices come from the market's own bands",
    summary:
      "The scalar tick size is gone. Each market publishes price_ranges — start, end and step — and the step depends on where in the range the price sits, with finer ticks at the edges than in the centre.",
    formula: "valid(p) means p = start + k steps within the band containing p",
    whenItHolds:
      "For every order price. Snapping is directional: a buy rounds up and a sell rounds down, never toward the price that flatters the trade.",
    whenItFails:
      "Reading the structure NAME instead of the bands. A client that switches on 'linear_cent' prices every market on the next structure wrong, and the exchange rejects the order rather than correcting it.",
    pane: "books",
    guards: ["modules/coherence/kernel/grid.py"],
    pinnedBy: ["tests/test_coherence_grid.py"],
    shipped: true,
  },
  {
    id: "basket",
    title: "A mutually exclusive family is a dollar sold in pieces",
    summary:
      "When the exchange marks an event mutually exclusive, exactly one outcome resolves YES. Owning every outcome owns a guaranteed dollar, so what the pieces cost is a direct reading of whether the prices admit a probability.",
    formula: "Σ p_i = 1 for a coherent family; Σ ask_i < 1 is a Dutch book before fees",
    whenItHolds:
      "Only when the exchange's own mutually_exclusive flag is set. That flag is the licence for the sum, not our arithmetic over the strikes.",
    whenItFails:
      "Buckets need not tile. Inferring exclusivity from floor and cap values asserts a claim the venue did not make, and a family with a gap in it has no reason to sum to anything.",
    pane: "universe",
    guards: ["modules/coherence/views.py"],
    pinnedBy: ["tests/test_coherence_observe.py"],
    shipped: true,
  },
  {
    id: "absence",
    title: "An absent quote is not a zero one",
    summary:
      "Zero is a legal price on this exchange, so a market nobody will bid on and a market bid at nothing are different facts. Every price the engine cannot read stays null and renders as a dash with a reason.",
    whenItHolds:
      "Everywhere a price is missing — which in the tails is most of the time, because nobody bids for the outcome that will not happen.",
    whenItFails:
      "A default of zero turns an unquoted tail into a one-cent market with a tight spread, and a basket summed over only its quoted legs understates the cost by exactly the legs it skipped — the direction that invents arbitrage.",
    pane: "universe",
    guards: ["modules/coherence/kernel/book.py", "modules/coherence/views.py"],
    pinnedBy: ["tests/test_coherence_lesson_0.py", "tests/test_coherence_observe.py"],
    shipped: true,
  },
  {
    id: "fees",
    title: "The fee has three components and everyone models one",
    summary:
      "Every fill charges a trade fee ceiled to a hundredth of a cent, a rounding fee that restores the account's balance precision, and a rebate that returns accumulated rounding. On small fills the rounding fee can exceed the trade fee many times over.",
    formula: "net_fee = ceil₀.₀₀₀₁(mult x rate x C x p x (1 - p)) + rounding − rebate",
    whenItHolds:
      "On every fill. The trade fee is a parabola peaking at fifty cents, so the correct no-arbitrage test is Σ ask < 1 − Σ net_fee, which depends on where the legs sit.",
    whenItFails:
      "Testing Σ ask < 1.00 is not a conservative approximation of that — it is a different test, and it is wrongest in the middle of the book where the volume is.",
    pane: "fees",
    guards: ["modules/coherence/kernel/costs.py"],
    pinnedBy: ["tests/test_coherence_costs.py"],
    shipped: true,
  },
  {
    id: "lattice",
    title: "The exchange publishes its own logical structure",
    summary:
      "Mutual exclusivity, strike ladders, buckets and settlement sources are all in the metadata. Two markets are the same payoff only when they share a settlement source — never when their titles merely read alike.",
    formula: "A ⊆ B ⟹ p(A) ≤ p(B)",
    whenItHolds:
      "Within one event, where every child market shares a shard and settles on one source.",
    whenItFails:
      "Matching markets by title similarity. Two similarly-worded markets can settle on different sources with different cut-offs, and when they resolve differently a hedged position pays zero or two dollars rather than one.",
    pane: "lattice",
    guards: ["modules/coherence/kernel/lattice.py"],
    pinnedBy: ["tests/test_coherence_lattice.py"],
    shipped: true,
  },
  {
    id: "duality",
    title: "The certificate of infeasibility is the trade",
    summary:
      "Rather than scanning for arbitrage shapes someone imagined, the engine asks whether any probability measure fits the quoted prices. When none does, linear-programming duality hands back the portfolio that profits in every state.",
    formula: "max t subject to payoff − cost ≥ t; t* > 0 ⟹ the dual is the portfolio",
    whenItHolds:
      "For any set of constraints written as linear rows, which is why new instruments extend the engine by adding rows rather than code paths.",
    whenItFails:
      "A solver answer is only as good as the executability constraints in it. An LP that ignores resting depth, price grids or per-shard collateral returns a portfolio nobody can fill.",
    pane: "certificate",
    guards: ["modules/coherence/kernel/dutchbook.py"],
    pinnedBy: ["tests/test_coherence_dutchbook.py"],
    shipped: true,
  },
  {
    id: "halflife",
    title: "Measure how long a dislocation survives before building an executor",
    summary:
      "Every coherence violation has a lifetime. If the median is shorter than the round trip, it is not an opportunity — it is a data artefact, and the race was lost before it was entered.",
    formula: "survival S(t) = P(violation still open after t seconds)",
    whenItHolds:
      "Once enough episodes have been recorded to estimate a median. Until then the honest answer is that there is no estimate.",
    whenItFails:
      "Reading a short half-life as 'be faster'. Against commercial detection in tens of milliseconds over REST polling, the edge has to be in structures nobody scans for, not in speed.",
    pane: "diffusion",
    guards: ["modules/coherence/episodes.py"],
    pinnedBy: ["tests/test_coherence_episodes.py"],
    shipped: true,
  },
  {
    id: "index",
    title: "Incoherence is measurable, per series, over time",
    summary:
      "The distance from the quoted price vector to the nearest arbitrage-free measure is a number. Logged per series it becomes a pricing-efficiency record nobody else publishes.",
    formula: "CI = min ‖p_quoted − q‖₁ over valid probability measures q",
    whenItHolds:
      "Wherever the books can be read. An unreadable event has no index, and that is stored as null rather than zero.",
    whenItFails:
      "A zero recorded for an unreadable event reads as perfectly coherent — the most misleading value available — which is why the tape's index column is nullable.",
    pane: "index",
    guards: ["modules/coherence/kernel/coherence_index.py"],
    pinnedBy: ["tests/test_coherence_store.py"],
    shipped: true,
  },
];
