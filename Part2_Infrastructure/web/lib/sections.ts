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

// The Kalshi engine — TWO tabs, TEN sections, and the fifth shape of one day.
//
// THE HONEST HISTORY, because pretending this was always obvious would make the
// next reader distrust every other comment in the file. On 2026-08-24 this rail
// went: one tab of eleven (the shape `origin/main` published) → Markets +
// Coherence → seventeen, when six in-pane `.seg` views were promoted to rails →
// back to one tab of eleven → consolidated to nine → and now two tabs again,
// renamed, with those nine divided by what they are FOR. Each move was right
// about its own cost and wrong about the total; what survives from every one of
// them is the consolidation, because nine sections is the number a reader can
// hold and seventeen was not.
//
// THE IDS ARE THE PUBLISHED ONES AND THE LABELS ARE NEW, which is house practice
// here rather than a smell — `live` renders "Execution", `codex` renders
// "Strategies", `activity` renders "Blotter", `model` renders "Risk engine".
//
//   `markets` → "Quotes"   what the exchange is quoting.
//   `coherence` → "Proofs"  what this engine proves about those quotes.
//
// THE FIFTH MOVE IS THE ONLY ONE THAT ADDED A SECTION BACK, and it is worth the
// sentence because every earlier move subtracted. `stake` was a rail section for
// part of 2026-08-24 and was demoted into `lattice`'s switcher; there it stacked
// a SECOND `.seg` under the first, so a reader met five buttons, then three more,
// then a family picker before any drawing — three rows of chrome over an empty
// state. The subject is also not the same question: `lattice` reads what measure
// the quotes imply (`/surface`), `stake` reads what to bet against that measure
// (`/stake`), and one read per section is what removes the second control row.
// So ten, and the id is the one it was published under.
//
// `coherence` is the only tab id `origin/main` ever published, so it keeps the
// half that carries the proof and every `#coherence/<section>` link in the world
// still resolves natively. `markets` was alive for one unpushed day and is
// reused rather than invented: today's tests, the relocation table and the desk
// sweep already speak it, and a third vocabulary would be a migration mechanism
// for no migration.
//
// WHAT THE SPLIT COSTS AND WHAT IT BUYS. It costs the tenth tab back — about
// 74px of header row, owned and measured by another session — and it costs four
// sections their native `#coherence/<id>` link. It buys the thing eleven
// sections on one rail could not give: a reader holds ONE question per tab.
// Prices is a reading; Proofs is an argument about that reading. Nothing in
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
// A view is not in the URL, not in the command palette, and not walked by
// `scripts/desk-sweep.mjs`. Eight subjects on this engine are reachable only by
// pressing a button, and the sweep's count is 57 rather than 65 for exactly that
// reason. The reader used the addressable shape for a day and chose depth:
// "make sure the markets and coherance tabs do not have so many subtabs, if we
// can merge and summarise it will be good."

// Prices — what the exchange is quoting, read live and recorded.
export const MARKETS_SECTIONS = [
  { id: "universe", label: "Universe", description: "Baskets, families & what they settle against" },
  { id: "books", label: "Books", description: "Two bid ladders, the identity & maker dispersion" },
  { id: "lattice", label: "Lattice", description: "Implied mass, its moments & the negative bins" },
  { id: "stake", label: "Stake", description: "The log-optimal plan, its capital split & method" },
  { id: "fees", label: "Fees", description: "Three-component cost & the four-model ablation" },
  { id: "shell", label: "Shell", description: "The watched universe as a filesystem" },
] as const;
export type MarketsSection = (typeof MARKETS_SECTIONS)[number]["id"];
export const MARKETS_SECTION_IDS =
  MARKETS_SECTIONS.map((s) => s.id) as readonly MarketsSection[];

// Proofs — what follows from those quotes. Ids unchanged; `certificate` and
// `calibration` keep the ids they were published under while their labels move.
export const COHERENCE_SECTIONS = [
  { id: "certificate", label: "Dutch book", description: "The coherence test, its proof & the parlays it bounds" },
  { id: "calibration", label: "Scorecard", description: "Were the prices right — once settled, and over time" },
  { id: "diffusion", label: "Diffusion", description: "How fast information is absorbed, and the findings" },
  { id: "lessons", label: "Lessons", description: "The curriculum & what guards it" },
] as const;
export type CoherenceSection = (typeof COHERENCE_SECTIONS)[number]["id"];
export const COHERENCE_SECTION_IDS =
  COHERENCE_SECTIONS.map((s) => s.id) as readonly CoherenceSection[];

/**
 * Both halves of the Kalshi engine, in reading order.
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
];
export const ENGINE_SECTION_IDS: readonly string[] = ENGINE_SECTIONS.map((s) => s.id);
