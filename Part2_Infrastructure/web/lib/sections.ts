/**
 * The single source of truth for workspace sections.
 *
 * The rails, the command palette, the hash whitelist and "Copy link to this
 * view" all read these arrays. Before this module existed the palette carried
 * hand-mirrored label literals for five workspaces and its Developer order
 * disagreed with the rail — the kind of drift that only a shared definition
 * ends. Naming pattern everywhere: a short noun Label plus a sentence-case
 * Description; ids never change (they are public deep links).
 */

export interface WorkspaceSectionDef {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

export const OVERVIEW_SECTIONS = [
  { id: "loop", label: "Decision loop", description: "Pipeline, KPIs & next step" },
  { id: "desks", label: "Desk roles", description: "One surface per role" },
  { id: "audit", label: "Audit trail", description: "Every paper order, accounted" },
] as const;
export type OverviewSection = (typeof OVERVIEW_SECTIONS)[number]["id"];
export const OVERVIEW_SECTION_IDS =
  OVERVIEW_SECTIONS.map((s) => s.id) as readonly OverviewSection[];

export const RESEARCH_SECTIONS = [
  { id: "summary", label: "Summary", description: "Verdict & performance" },
  { id: "parameters", label: "Parameters", description: "Stability & ranking" },
  { id: "walkforward", label: "Walk-forward", description: "Out-of-sample evidence" },
  { id: "attribution", label: "Attribution", description: "Factors, regime & tail" },
  { id: "lineage", label: "Lineage", description: "Signal path & desk memory" },
  { id: "decision", label: "Decision", description: "Promotion & sizing" },
  { id: "runs", label: "Runs", description: "Experiment history" },
  { id: "fitted", label: "Fitted models", description: "Supervised runs & folds" },
  // Renamed from "Codex" — the id stays `codex` because ids are deep links.
  { id: "codex", label: "Strategies", description: "Models & strategy guide" },
] as const;
export type ResearchSection = (typeof RESEARCH_SECTIONS)[number]["id"];
export const RESEARCH_SECTION_IDS =
  RESEARCH_SECTIONS.map((s) => s.id) as readonly ResearchSection[];

export const EXECUTION_SECTIONS = [
  { id: "trade", label: "Trade", description: "Ticket & pre-trade gates" },
  { id: "liquidity", label: "Liquidity", description: "Depth & consolidated book" },
  { id: "routing", label: "Routing & TCA", description: "Cost & venue allocation" },
  { id: "quality", label: "Fill quality", description: "Realised cost vs model" },
  // Label reads "Blotter" now; the id stays `activity` because it is a
  // public deep link.
  { id: "activity", label: "Blotter", description: "Orders, tape & alerts" },
] as const;
export type ExecutionSection = (typeof EXECUTION_SECTIONS)[number]["id"];
export const EXECUTION_SECTION_IDS =
  EXECUTION_SECTIONS.map((s) => s.id) as readonly ExecutionSection[];

export const PORTFOLIO_SECTIONS = [
  { id: "overview", label: "Overview", description: "Alerts, headroom & exposure" },
  { id: "equity", label: "Equity & P&L", description: "Session curve & attribution" },
  { id: "positions", label: "Positions", description: "Holdings & exposure" },
  { id: "allocation", label: "Allocation", description: "Targets & rebalancing" },
  { id: "performance", label: "Performance", description: "Attribution & costs" },
] as const;
export type PortfolioSection = (typeof PORTFOLIO_SECTIONS)[number]["id"];
export const PORTFOLIO_SECTION_IDS =
  PORTFOLIO_SECTIONS.map((s) => s.id) as readonly PortfolioSection[];

export const RISK_SECTIONS = [
  { id: "limits", label: "Limits", description: "Headroom & concentration" },
  // The id stays `model` while the label becomes "Risk engine": ids are public
  // deep links (see the header), so #risk/model must keep resolving to the half
  // it has always named. A section-level alias was considered and rejected —
  // nothing is broken, so it would be a migration mechanism for no migration.
  { id: "model", label: "Risk engine", description: "Loss estimates & validation" },
  { id: "diagram", label: "Risk diagram", description: "Forecast against realised" },
  { id: "drivers", label: "Risk drivers", description: "Contribution & correlation" },
  { id: "montecarlo", label: "Monte Carlo", description: "Terminal distribution & tail" },
  { id: "oraclevar", label: "Oracle VaR", description: "In-database GBM check" },
  { id: "scenarios", label: "Stress tests", description: "Forward shock damage" },
  { id: "controls", label: "Controls", description: "Halt & flatten handoffs" },
] as const;
export type RiskSection = (typeof RISK_SECTIONS)[number]["id"];
export const RISK_SECTION_IDS = RISK_SECTIONS.map((s) => s.id) as readonly RiskSection[];

export const DATA_SECTIONS = [
  { id: "overview", label: "Trust Summary", description: "Verdict, composition & boundary" },
  { id: "feeds", label: "Feeds & Contracts", description: "Freshness, validation & next action" },
  { id: "quality", label: "Quality", description: "Reconcile, contracts & ledger" },
  { id: "incidents", label: "Incidents", description: "Outages, quarantine & recovery" },
  { id: "lineage", label: "Lineage & Payloads", description: "Trace source, cache & coercion" },
  { id: "providers", label: "Providers & Capacity", description: "Failover, quota & reserve" },
  { id: "queue", label: "Work Queue", description: "Persisted requests, tickets & bugs" },
] as const;
export type DataSection = (typeof DATA_SECTIONS)[number]["id"];
export const DATA_SECTION_IDS = DATA_SECTIONS.map((s) => s.id) as readonly DataSection[];

export const RELIABILITY_SECTIONS = [
  { id: "overview", label: "Attention & SLIs", description: "Triage, signals & incident path" },
  { id: "planes", label: "Dependencies", description: "Provider APIs, platform & evidence" },
  { id: "services", label: "Services & Circuits", description: "Providers, venues & failover" },
  { id: "events", label: "Logs & Traces", description: "Cross-origin event investigation" },
  { id: "controls", label: "Remediation", description: "Guarded, scoped operator actions" },
] as const;
export type ReliabilitySection = (typeof RELIABILITY_SECTIONS)[number]["id"];
export const RELIABILITY_SECTION_IDS =
  RELIABILITY_SECTIONS.map((s) => s.id) as readonly ReliabilitySection[];

// Rail order — the palette used to iterate a differently-ordered id list.
export const DEVELOPER_SECTIONS = [
  { id: "overview", label: "Topology", description: "Runtime map & shared context" },
  { id: "readiness", label: "Readiness", description: "Launch gates, schema & artifacts" },
  { id: "quality", label: "CI / CD", description: "Pipelines, test gates & artifacts" },
  { id: "apis", label: "API & Schema", description: "Routes, payloads & contract drift" },
  { id: "codebase", label: "Code & Diffs", description: "Repository paths & change custody" },
  { id: "work", label: "Task Queue", description: "Engineering-impact work" },
] as const;
export type DeveloperSection = (typeof DEVELOPER_SECTIONS)[number]["id"];
export const DEVELOPER_SECTION_IDS =
  DEVELOPER_SECTIONS.map((s) => s.id) as readonly DeveloperSection[];

// The quantitative engine — THREE tabs, TWENTY-TWO rail sections and SEVENTY-ONE
// registered views. The whole workspace is eleven tabs and seventy sections;
// Markets contributes 8 sections / 26 views, Proofs 7 / 29 and Diffusion 7 /
// 16. `lib/section-views.ts` gives every non-default view an optional third hash
// segment, so views are deep-linkable, command-visible and swept.
//
// THE HONEST HISTORY, because pretending this was always obvious would make the
// next reader distrust every other comment in the file. On 2026-08-24 this rail
// went: one tab of eleven (the shape `origin/main` published) → Markets +
// Coherence → seventeen, when six in-pane `.seg` views were promoted to rails →
// back to one tab of eleven → consolidated to nine. Later passes restored the
// subjects that warranted rails, split Markets from Proofs, and extracted
// Diffusion. That sequence is history, not the current count above; what
// survives is the rule that one rail entry answers one question.
//
// THE IDS ARE THE PUBLISHED ONES AND THE LABELS ARE NEW, which is house practice
// here rather than a smell — `live` renders "Execution", `codex` renders
// "Strategies", `activity` renders "Blotter", `model` renders "Risk engine".
//
//   `markets`   → "Markets"    what the exchange is quoting.
//   `coherence` → "Proofs"     what this engine proves about those quotes.
//   `diffusion` → "Diffusion"  how quickly new information reaches the price.
//
// THE HISTORICAL STAKE MOVE ADDED A SECTION BACK, and it is worth the sentence
// because the earlier moves subtracted. `stake` was a rail section for
// part of 2026-08-24 and was demoted into `lattice`'s switcher; there it stacked
// a SECOND `.seg` under the first, so a reader met five buttons, then three more,
// then a family picker before any drawing — three rows of chrome over an empty
// state. The subject is also not the same question: `lattice` reads what measure
// the quotes imply (`/surface`), `stake` reads what to bet against that measure
// (`/stake`), and one read per section is what removes the second control row.
// At that point the two-tab engine had ten sections; the current three-tab
// topology and totals are stated above, and the id remains the published one.
//
// `coherence` is the only tab id `origin/main` ever published, so it keeps the
// half that carries the proof and every `#coherence/<section>` link in the world
// still resolves natively. `markets` was alive for one unpushed day and is
// reused rather than invented: the tests, relocation table and desk
// sweep already speak it, and a third vocabulary would be a migration mechanism
// for no migration.
//
// WHAT THE CURRENT SPLIT BUYS. Markets is a reading; Proofs is an argument
// about that reading; Diffusion is a recorded-time study. The eleven-tab header
// and all seventy rail sections share the same navigation registry. Nothing in
// `RELOCATED_SECTIONS` (`lib/workspace-hash.ts`) is optional here — every id
// that moved tab, and every id that stopped being a section, resolves to the tab
// AND section that carries it, or a live link lands on a rail default while the
// URL still names something else.
//
// TWO SECTIONS ABSORBED OTHERS IN THE CONSOLIDATION AND KEEP THEM AS VIEWS, and
// both absorbed ids were PUBLISHED, which is what makes the relocation table
// load-bearing rather than a courtesy:
//
//   - `index` folds into `calibration`, relabelled "Scorecard". Both answer
//     "were these prices right" — the index continuously, from the distance to
//     the nearest coherent price vector on every poll; calibration once settled,
//     from what actually paid. Two sections asked a reader to discover that they
//     were one question.
//   - `combos` folds into `certificate`, "Dutch book". The Fréchet bounds test
//     IS a coherence test, run on parlays instead of on a family's strikes:
//     same failure, same verdict vocabulary, one leg structure the exchange
//     states rather than one this engine infers.
//
// HISTORICAL ADDRESSABILITY COST. In the 57-section consolidation, a view was
// not in the URL, command palette or sweep, so eight subjects were reachable
// only by pressing a button. That is no longer the current contract:
// `lib/section-views.ts` registers 71 engine views and the optional third hash
// segment lets the sweep open every non-default destination. The reader used
// the earlier rail-heavy shape for a day and chose depth:
// "make sure the markets and coherance tabs do not have so many subtabs, if we
// can merge and summarise it will be good."

// Markets — what the exchange is quoting, read live and recorded.
//
// EIGHT SINCE 2026-08-25, AND THE SPLIT IS THE SAME ONE PROOFS JUST MADE.
// "the universe section has too many subtabs" — five, over two different
// subjects, which is what made the row long rather than the count. Universe
// answered both "what does a family cost" (Baskets, Families) and "what does it
// settle against" (Settlement, Formation, Pending); Books answered both "what
// are the two ladders" (Ladder, Identity) and "what do independent makers say"
// (Dispersion, Channel). A switcher holds views of ONE question, and neither of
// those two was one question.
//
// So each splits at the seam it already had, and both new ids are ids this
// engine PUBLISHED — `settlement` and `dispersion` were rail sections during
// the promotion pass and have been sitting in `RELOCATED_SECTIONS` ever since.
// Reusing them DELETES their entries from that table rather than adding two:
// `readLocation` asks the rail before it asks the table, so an id back on its
// own rail can never reach its entry, and an entry that cannot be reached is a
// lookup claiming a move that was undone. `markets/stake` records the same
// thing, and `coherence/portfolio` and `coherence/combos` left the same way
// hours earlier when Dutch book split into three.
//
// `dispersion` renders "Makers", which is house practice on this row rather
// than drift — `live` renders "Execution", `activity` renders "Blotter". The id
// is what the hash, the sweep and the relocation table speak; the label is what
// a reader finds. "Dispersion" names the measurement, and the section is about
// who is doing the quoting.
//
// WHAT IT COSTS: two more entries on a rail that already held six, on a desk
// where Research carries nine and Risk eight, and no header chip moves — this
// is the second-level rail, not the tab row, so the measured header ladder is
// untouched. WHAT IT BUYS: no section on this tab now carries more than four
// views, every one of them is one question, and four subjects that were
// once reachable only by pressing a local button now have third-segment URLs.
export const MARKETS_SECTIONS = [
  { id: "universe", label: "Universe", description: "Every family against the dollar it pays" },
  { id: "settlement", label: "Settlement", description: "The published index, how it is formed & what is pending" },
  { id: "books", label: "Books", description: "Two bid ladders & the offers they imply" },
  { id: "dispersion", label: "Makers", description: "What independent makers say, and what the channel answered" },
  { id: "lattice", label: "Lattice", description: "Implied mass, its moments & the negative bins" },
  { id: "stake", label: "Stake", description: "The log-optimal plan, its capital split & method" },
  { id: "fees", label: "Fees", description: "Three-component cost & the four-model ablation" },
  { id: "shell", label: "Shell", description: "The watched universe as a filesystem" },
] as const;
export type MarketsSection = (typeof MARKETS_SECTIONS)[number]["id"];
export const MARKETS_SECTION_IDS =
  MARKETS_SECTIONS.map((s) => s.id) as readonly MarketsSection[];

// Proofs — what follows from those quotes. Every id here was published before;
// `certificate` and `calibration` keep theirs while their labels move, and
// `portfolio` and `combos` are the two the consolidation folded away.
//
// THE SIXTH MOVE UNFOLDS TWO OF THEM, and it is the first that undoes a
// consolidation rather than deepening one — so it is worth the reason. Dutch
// book held SIX views under THREE groups over a family picker, which is three
// rows of chrome before any drawing: the two-level switcher was the right
// answer to seven flat segments and the wrong answer to a section carrying
// three different questions. They are three questions, and the reader said so:
// "there are too many subtabs and subsubtabs".
//
//   `certificate` → "Coherence test"  is there a Dutch book in this family.
//   `portfolio`   → "Basket"          the portfolio the answer hands back.
//   `combos`      → "Parlays"         the same test on the venue's own conjunctions.
//
// Each is ONE read and ONE control row, which is the rule `stake` was promoted
// back for and the same rule applied twice more. Nothing was invented to do it:
// both ids are already in `RELOCATED_SECTIONS`, so this DELETES two entries
// from that table rather than adding two — an id back on its own rail is
// reached by `readLocation` before the table is consulted, and a table entry
// that cannot be reached is a lookup claiming a move that was undone. That is
// exactly what `markets/stake` records.
//
// The cost is honest and small: six rail sections where there were four, and
// `#coherence/combos` now lands on the parlays themselves rather than on the
// section that had absorbed them — which is where it pointed when it was
// published.
//
// THE ORDER IS THE ARGUMENT, since 2026-08-26, and nothing else about the rail
// moved: seven ids, seven URLs, `RELOCATED_SECTIONS` untouched. Rail order is
// not addressable — no hash, no relocation entry and no test names it directly,
// only `coherence-sections` asking that the panels be drawn in whatever order
// this array happens to be in. So it is free to state something, and it now
// states the order a reader meets the claims in:
//
//   certificate  is there an arbitrage in this family, right now
//   portfolio    the basket that answer hands back, and what it pays
//   combos       the same test on the venue's own conjunctions
//   index        how far from arbitrage-free the quotes have been sitting
//   calibration  and were the prices, separately, RIGHT
//   corpus       what that score was computed on
//   lessons      the curriculum, and what pins it
//
// `index` moves up three places, which is the whole change. It measures the
// same object as the three tests above it — distance from a price vector that
// admits a measure — and it was sitting after Scorecard, which measures a
// different one: whether settled outcomes matched the quotes. Two questions
// that both produce a number, separated by nothing, in the wrong order.
// Scorecard and Corpus then sit together at the end, which is where the corpus
// argument belongs: a score is a score OF something, and the thing follows it.
export const COHERENCE_SECTIONS = [
  { id: "certificate", label: "Coherence test", description: "Whether these prices admit a probability, and the proof" },
  { id: "portfolio", label: "Basket", description: "The portfolio the test hands back, and what it pays" },
  { id: "combos", label: "Parlays", description: "The venue's conjunctions against the bounds their legs impose" },
  { id: "index", label: "Coherence index", description: "How far the quotes sit from admitting a probability, per poll" },
  { id: "calibration", label: "Scorecard", description: "Were the prices right, on what has settled" },
  { id: "corpus", label: "Corpus", description: "What that score was computed on, and how it accrued" },
  { id: "lessons", label: "Lessons", description: "The curriculum & what guards it" },
] as const;
export type CoherenceSection = (typeof COHERENCE_SECTIONS)[number]["id"];
export const COHERENCE_SECTION_IDS =
  COHERENCE_SECTIONS.map((s) => s.id) as readonly CoherenceSection[];

// Diffusion — how fast anything the market did not know reaches the price.
//
// A TAB OF ITS OWN SINCE 2026-08-25, and the reason is that it was never the
// same question as the rest of Proofs. Every other section on that rail argues
// from ONE poll of the exchange: does this family's prices admit a probability,
// what portfolio does the failure hand back, how far from coherent is it right
// now. This one argues from a RESEARCH PANEL — 200 recorded runs, a control
// arm of matched windows with no news in them, an out-of-sample verdict — and
// answers a question about how long absorption takes rather than about what a
// price implies.
//
// It also stopped fitting. Before extraction, four groups over eleven views
// were a whole rail's worth of subject sitting behind one section's button,
// and it had already
// grown a THIRD level: `FindingsPane` drew its own switcher inside a view
// inside a group, which `coherence-sections.test.ts` carried as a named
// exemption because there was nowhere else for it to go. The current tab has
// seven sections and sixteen registered views, with one section row and at most
// one addressable view row inside it; the exemption was deleted rather than
// inherited.
//
// `findings` is a PUBLISHED id and takes its own section back here, which is
// the fourth time this restructure has spent nothing to restore a link.
export const DIFFUSION_SECTIONS = [
  { id: "arm", label: "Announcement arm", description: "Absorption against a control of matched quiet windows" },
  { id: "meetings", label: "Meetings", description: "Each decision's own half-life, and the two-stage window every comparison rests on" },
  { id: "episodes", label: "Kalshi episodes", description: "How long a published mispricing survives" },
  { id: "model", label: "Measurement", description: "What the estimator computes on a price path, worked in the browser" },
  { id: "instrument", label: "Instrument", description: "The clock and the information spectrum built on top of it" },
  { id: "sandbox", label: "Sandbox", description: "The estimator with its controls left on, including where it declines to answer" },
  { id: "findings", label: "Findings", description: "What the study concluded, and whether it was fit to" },
] as const;
export type DiffusionSection = (typeof DIFFUSION_SECTIONS)[number]["id"];
export const DIFFUSION_SECTION_IDS =
  DIFFUSION_SECTIONS.map((s) => s.id) as readonly DiffusionSection[];

/**
 * All three quantitative tabs, in reading order.
 *
 * The curriculum, its coverage strip and anything else that asks "which section
 * teaches this" span the whole engine rather than one tab, and a lesson's
 * `pane` is a SECTION id with no tab inside it. Concatenated once here rather
 * than in each consumer: two components each doing it is two places for the
 * order to drift, and the split of 2026-08-24 is exactly the change that would
 * have drifted them.
 */
export const ENGINE_SECTIONS: readonly WorkspaceSectionDef[] = [
  ...MARKETS_SECTIONS,
  ...COHERENCE_SECTIONS,
  ...DIFFUSION_SECTIONS,
];
export const ENGINE_SECTION_IDS: readonly string[] = ENGINE_SECTIONS.map((s) => s.id);
