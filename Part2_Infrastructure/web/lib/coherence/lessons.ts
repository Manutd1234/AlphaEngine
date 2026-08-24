/**
 * The fourteen lessons, and the code each one is about.
 *
 * `pane` names the rail section that TEACHES a lesson, and it was re-checked
 * against the rail four times on 2026-08-24 as the engine went one tab →
 * two → seventeen sections → one → nine → two tabs of nine. A lesson may only
 * name a section a reader can reach by URL, so every restructure that demoted a
 * section had to move the lessons it taught:
 *
 *   - `kelly` went to `stake` on the promotion pass and back to `lattice` when
 *     `stake` became a view again.
 *   - `index` → `calibration` and `frechet` → `certificate` on the
 *     consolidation, which folded those two published sections into the ones
 *     answering the same question. Both lessons are still about exactly what
 *     they were about; only the section that shows them moved.
 *
 * `pane` is a SECTION id and says nothing about which tab owns it — `books`,
 * `universe`, `lattice` and `fees` are on Quotes, `certificate`, `calibration`
 * and `diffusion` on Proofs — because `LessonsPane` resolves the tab from
 * `lib/sections.ts` rather than storing it twice. Nothing else moved: the three
 * book lessons belong to `books`, and `duality` belongs to `certificate` rather
 * than to the portfolio the certificate hands back, since the lesson is about
 * the LP that produces a portfolio and not about reading one.
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
 *
 * `group` is the field the section reads to split itself. Fourteen cards ran to
 * about 1,700px at desk width, so the pane shows one group at a time — and the
 * mapping lives here rather than in `LessonsPane`, because a list kept in the
 * component is a list a fifteenth lesson can be left out of, and a lesson left
 * out of it renders nowhere at all.
 */

/**
 * The four readings of the catalogue, in the order the section offers them.
 *
 * Shipped-versus-pending is a degenerate cut — every lesson below is shipped —
 * so the split is by what a lesson is ABOUT. The array is also the type: a
 * lesson cannot compile without a group, a group cannot exist without an entry
 * here, and the pane renders one view per entry. Nothing can fall between.
 */
export const LESSON_GROUPS = [
  {
    id: "prices",
    label: "Quotes",
    description: "What one quote is, and how it is represented, before any structure",
  },
  {
    id: "structure",
    label: "Structure",
    description: "The venue's own logical relations, and what falls out of them",
  },
  {
    id: "bounds",
    label: "Bounds",
    description: "Where the naive bound is the wrong bound",
  },
  {
    id: "record",
    label: "Record",
    description: "What exists only against recorded history rather than one snapshot",
  },
] as const;

/** Exactly one per lesson, and only ever one of the four views above. */
export type LessonGroup = (typeof LESSON_GROUPS)[number]["id"];

export interface CoherenceLesson {
  /**
   * True only when the SECTION renders this lesson.
   *
   * Not "the engine exists" — `lattice` is built, tested and used by the
   * solver while its pane is still a placeholder, and a reader who opens that
   * pane after seeing "shipped" has been told something untrue about the tab.
   */
  id: string;
  title: string;
  summary: string;
  /** A plain Unicode string. There is no KaTeX here and none may be added. */
  formula?: string;
  whenItHolds: string;
  whenItFails: string;
  /** Where this lesson lives on the tab. */
  pane: string;
  /** Which of the section's four views carries this lesson. */
  group: LessonGroup;
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
      "Kalshi publishes resting YES and NO bids only. The offer you trade against is a reading of the opposite ladder, so the two asks sum to a dollar plus the spread, never less.",
    formula: "yes_ask + no_ask = (1 − no_bid) + (1 − yes_bid) = 1 + spread",
    whenItHolds:
      "Always, on any single snapshot of one market: an identity in the definitions, not a property of a liquid book.",
    whenItFails:
      "Never as arithmetic — but it appears to fail when the two ladders are read at different instants: a sum below a dollar is a torn snapshot, and a bot trading on it trades its own latency.",
    pane: "books",
    group: "prices",
    guards: ["modules/coherence/kernel/book.py"],
    pinnedBy: ["tests/test_coherence_lesson_0.py"],
    shipped: true,
  },
  {
    id: "fixedpoint",
    title: "Prices are fixed point, and float breaks them where it matters",
    summary:
      "Prices arrive as decimal strings on a grid as fine as a hundredth of a cent, and every decision is a comparison at the fourth decimal; the engine parses to Decimal, never converts.",
    formula: "0.1 + 0.2 ≠ 0.3 in binary64; eight legs at 0.1250 must total exactly 1.0000",
    whenItHolds:
      "Wherever a price is compared to another price or a dollar — on this tab, everywhere.",
    whenItFails:
      "A float engine is not slightly wrong: it is right on every case a casual test would try and wrong on the marginal ones — the only cases an arbitrage engine looks at.",
    pane: "books",
    group: "prices",
    guards: ["modules/coherence/kernel/money.py", "modules/coherence/kernel/grid.py"],
    pinnedBy: ["tests/test_coherence_money.py", "tests/test_coherence_grid.py", "tests/test_coherence_no_float.py"],
    shipped: true,
  },
  {
    id: "grid",
    title: "Valid prices come from the market's own bands",
    summary:
      "The scalar tick size is gone: each market publishes price_ranges — start, end and step — with finer ticks at the edges of the range than in the centre.",
    formula: "valid(p) means p = start + k steps within the band containing p",
    whenItHolds:
      "For every order price. Snapping is directional — a buy rounds up, a sell down, never toward the price that flatters the trade.",
    whenItFails:
      "Reading the structure NAME instead of the bands: a client switching on 'linear_cent' prices every market on the next structure wrong, and the exchange rejects the order.",
    pane: "books",
    group: "prices",
    guards: ["modules/coherence/kernel/grid.py"],
    pinnedBy: ["tests/test_coherence_grid.py"],
    shipped: true,
  },
  {
    id: "basket",
    title: "A mutually exclusive family is a dollar sold in pieces",
    summary:
      "When the exchange marks an event mutually exclusive, exactly one outcome resolves YES — owning every outcome owns a dollar, so the pieces' cost reads directly on whether the prices admit a probability.",
    formula: "Σ p_i = 1 for a coherent family; Σ ask_i < 1 is a Dutch book before fees",
    whenItHolds:
      "Only when the exchange's own mutually_exclusive flag is set — the licence for the sum, not our arithmetic over the strikes.",
    whenItFails:
      "Buckets need not tile: inferring exclusivity from floor and cap values asserts a claim the venue never made, and a family with a gap in it need not sum to anything.",
    pane: "universe",
    group: "structure",
    guards: ["modules/coherence/views.py"],
    pinnedBy: ["tests/test_coherence_observe.py"],
    shipped: true,
  },
  {
    id: "absence",
    title: "An absent quote is not a zero one",
    summary:
      "Zero is a legal price here, so a market nobody will bid on and one bid at nothing are different facts; an unreadable price stays null and renders as a dash with a reason.",
    whenItHolds:
      "Everywhere a price is missing — in the tails most of the time: nobody bids for the outcome that will not happen.",
    whenItFails:
      "A default of zero turns an unquoted tail into a one-cent market with a tight spread, and a basket summed over its quoted legs alone understates the cost — the direction that invents arbitrage.",
    pane: "universe",
    group: "structure",
    guards: ["modules/coherence/kernel/book.py", "modules/coherence/views.py"],
    pinnedBy: ["tests/test_coherence_lesson_0.py", "tests/test_coherence_observe.py"],
    shipped: true,
  },
  {
    id: "fees",
    title: "The fee has three components and everyone models one",
    summary:
      "Every fill charges a trade fee ceiled to a hundredth of a cent, a rounding fee restoring the account's balance precision, and a rebate returning accumulated rounding; on a small fill the rounding fee can dwarf the trade fee.",
    formula: "net_fee = ceil₀.₀₀₀₁(mult x rate x C x p x (1 - p)) + rounding − rebate",
    whenItHolds:
      "On every fill. The trade fee is a parabola peaking at fifty cents, so the right test is Σ ask < 1 − Σ net_fee, which depends on where the legs sit.",
    whenItFails:
      "Testing Σ ask < 1.00 is not a conservative approximation — it is a different test, wrongest in the middle of the book where the volume is.",
    pane: "fees",
    group: "bounds",
    guards: ["modules/coherence/kernel/costs.py"],
    pinnedBy: ["tests/test_coherence_costs.py"],
    shipped: true,
  },
  {
    id: "lattice",
    title: "The exchange publishes its own logical structure",
    summary:
      "Mutual exclusivity, strike ladders, buckets and settlement sources are all in the metadata: two markets are the same payoff only when they share a settlement source, never when titles read alike.",
    formula: "A ⊆ B ⟹ p(A) ≤ p(B)",
    whenItHolds:
      "Within one event, where every child market shares a shard and settles on one source.",
    whenItFails:
      "Matching markets by title similarity: two alike-worded markets can settle on different sources with different cut-offs, and a hedged position across them pays zero or two dollars, not one.",
    pane: "lattice",
    group: "structure",
    guards: ["modules/coherence/kernel/lattice.py"],
    pinnedBy: ["tests/test_coherence_lattice.py"],
    shipped: true,
  },
  {
    id: "duality",
    title: "The certificate of infeasibility is the trade",
    summary:
      "Rather than scanning for imagined arbitrage shapes, the engine asks whether any probability measure fits the quoted prices — when none does, duality hands back the portfolio profiting in every state.",
    formula: "max t subject to payoff − cost ≥ t; t* > 0 ⟹ the dual is the portfolio",
    whenItHolds:
      "For any constraints written as linear rows — why new instruments extend the engine by adding rows rather than code paths.",
    whenItFails:
      "A solver answer is only as good as its executability constraints: an LP ignoring resting depth, price grids or per-shard collateral returns a portfolio nobody can fill.",
    pane: "certificate",
    group: "structure",
    guards: ["modules/coherence/kernel/dutchbook.py"],
    pinnedBy: ["tests/test_coherence_dutchbook.py"],
    shipped: true,
  },
  {
    id: "halflife",
    title: "Measure how long a dislocation survives before building an executor",
    summary:
      "Every coherence violation has a lifetime; a median shorter than the round trip is not an opportunity but a data artefact, the race lost before it was entered.",
    formula: "survival S(t) = P(violation still open after t seconds)",
    whenItHolds:
      "Once enough episodes are recorded to estimate a median; until then the honest answer is no estimate.",
    whenItFails:
      "Reading a short half-life as 'be faster'. Against commercial detection in tens of milliseconds over REST polling, the edge has to be in structures nobody scans for, not in speed.",
    pane: "diffusion",
    group: "record",
    guards: ["modules/coherence/episodes.py"],
    pinnedBy: ["tests/test_coherence_episodes.py"],
    shipped: true,
  },
  {
    id: "index",
    title: "Incoherence is measurable, per series, over time",
    summary:
      "The distance from the quoted price vector to the nearest arbitrage-free one exists on every poll, not only when a Dutch book appears; logged per series, a pricing-efficiency record nobody else publishes.",
    formula: "CI = min ‖p_quoted − q‖₁ over the coherent vectors q",
    whenItHolds:
      "Two families, measured differently: a mutually exclusive basket against Σq = 1, so the distance is |Σp − 1|; a threshold ladder against monotonicity, so the distance is to its isotonic regression.",
    whenItFails:
      "Measuring only the basket. Crypto ladders carry no exclusivity flag, so an index handling baskets alone writes a column of nulls for the whole crypto complex — exactly the series a shard-migration study needs.",
    pane: "calibration",
    group: "record",
    guards: ["modules/coherence/kernel/coherence_index.py"],
    pinnedBy: ["tests/test_coherence_store.py"],
    shipped: true,
  },
  {
    id: "distribution",
    title: "A ladder of strikes is a distribution, one subtraction at a time",
    summary:
      "A threshold market quotes one point of a survival function; quote several and the mass between two strikes is what their prices differ by — an implied distribution nobody had to state.",
    formula: "pmf(k\u1d62, k\u1d62\u208a\u2081] = S(k\u1d62) \u2212 S(k\u1d62\u208a\u2081)",
    whenItHolds:
      "Along any ladder of strikes on one underlying, where two adjacent strikes are both quoted.",
    whenItFails:
      "Reading a mean off the chart. The outermost bins are open — mass above the highest strike has no width and no midpoint — so a mean pretending they sit at their bounds measures that convention, not the market; the moments here are conditional on the interior and say so.",
    pane: "lattice",
    group: "structure",
    guards: ["modules/coherence/kernel/distribution.py", "modules/coherence/kernel/moments.py"],
    pinnedBy: ["tests/test_coherence_distribution.py"],
    shipped: true,
  },
  {
    id: "kelly",
    title: "Growth-optimal is not riskless, and the difference is the trade",
    summary:
      "Sizing a family of mutually exclusive contracts is not the scalar Kelly formula repeated: exactly one outcome pays, so a dollar on one partly hedges the dollar on another, and the log-optimal split has an exact solution.",
    formula: "f\u209b = q\u209b \u2212 R\u00b7a\u209b,  R = (1 \u2212 \u03a3q) / (1 \u2212 \u03a3a)",
    whenItHolds:
      "Over one mutually exclusive family, priced at what each outcome costs to buy, whole family present.",
    whenItFails:
      "Mistaking the Kelly plan for the arbitrage. Where a basket costs under a dollar both exist: the Dutch book buys equal contracts and its profit is certain; Kelly stakes the measure, grows faster, and can lose a third of the bankroll on one settlement.",
    pane: "lattice",
    group: "structure",
    guards: ["modules/coherence/kernel/kelly.py"],
    pinnedBy: ["tests/test_coherence_kelly.py"],
    shipped: true,
  },
  {
    id: "frechet",
    title: "Two probabilities do not determine the probability of both",
    summary:
      "A parlay pays only when every leg lands, and the exchange states its legs in the metadata. The legs pin down a band, not a price, and its width is how far the parlay can move with no leg moving.",
    formula: "max(0, \u03a3p\u1d62 \u2212 (n\u22121)) \u2264 P(all) \u2264 min p\u1d62",
    whenItHolds:
      "For any conjunction whose legs the venue lists, whatever the dependence turns out to be.",
    whenItFails:
      "Treating the independence product as a fair value. Legs are routinely dependent, a price above \u03a0p\u1d62 is no evidence on its own, and parlays are quoted one-sided — the offer carries the maker's margin.",
    pane: "certificate",
    group: "bounds",
    guards: ["modules/coherence/kernel/frechet.py", "modules/coherence/drivers/kalshi_combos.py"],
    pinnedBy: ["tests/test_coherence_frechet.py"],
    shipped: true,
  },
  {
    id: "calibration",
    title: "Coherent is not correct, and only settled markets can tell you",
    summary:
      "A price vector can be perfectly coherent and perfectly wrong — a Dutch-book test never compares a price to the world; scoring settled markets splits the error into a repairable part and a part belonging to the question.",
    formula: "Brier = Reliability \u2212 Resolution + Uncertainty + Binning",
    whenItHolds:
      "Over a corpus quoted well before close and scored against what actually happened.",
    whenItFails:
      "Scoring last traded prices: a last trade lands moments before settlement, so it scores near-perfectly and measures convergence, not foresight — and the corpus is whatever the venue lists most, not a sample.",
    pane: "calibration",
    group: "record",
    guards: ["modules/coherence/kernel/calibration.py", "modules/coherence/fs/corpus.py"],
    pinnedBy: ["tests/test_coherence_calibration.py"],
    shipped: true,
  },
];
