/**
 * The technical reading contract for every addressable Markets destination.
 *
 * These are presentation facts, not observations. They name the analytical
 * question, the surface that answers it, the exact-value fallback and the
 * interpretation guardrail. Live numbers continue to come only from gateway
 * payloads owned by the section components.
 */

export interface MarketSectionContract {
  label: string;
  defaultView: string;
  question: string;
  guardrail: string;
}

export const MARKET_SECTION_CONTRACTS = {
  universe: {
    label: "Universe",
    defaultView: "baskets",
    question: "Which watched contracts are executable, mapped and current?",
    guardrail: "A missing family or leg is withheld; it is never priced as zero.",
  },
  settlement: {
    label: "Settlement",
    defaultView: "reading",
    question: "What pays, from which authority, and at which cutoff?",
    guardrail: "Pending, unavailable and settled are distinct contract states.",
  },
  books: {
    label: "Books",
    defaultView: "ladder",
    question: "Which native bids and derived offers are executable now?",
    guardrail: "Derived asks are labelled and stale depth is never treated as executable.",
  },
  dispersion: {
    label: "Makers",
    defaultView: "quotes",
    question: "How far do independent makers disagree on the same event?",
    guardrail: "Unanswered, stale and refused requests never enter a numeric dispersion.",
  },
  lattice: {
    label: "Lattice",
    defaultView: "survival",
    question: "Does the quote-implied state measure behave like a probability distribution?",
    guardrail: "Negative mass is an exception state, not a decorative below-axis mark.",
  },
  stake: {
    label: "Stake",
    defaultView: "plan",
    question: "Which allocation survives fees, capital and drawdown constraints?",
    guardrail: "Declined capital remains visible and no plan implies an order was placed.",
  },
  fees: {
    label: "Fees",
    defaultView: "example",
    question: "Which costs create break-even and change the replay answer?",
    guardrail: "A missing fee component is withheld unless the contract explicitly reports zero.",
  },
  shell: {
    label: "Shell",
    defaultView: "layout",
    question: "Can the selected market read be located and reproduced?",
    guardrail: "The tree is read-only and never implies a filesystem mutation.",
  },
} as const satisfies Record<string, MarketSectionContract>;

export type MarketsContractSection = keyof typeof MARKET_SECTION_CONTRACTS;

interface MarketViewDetail {
  viewLabel: string;
  leadSurface: string;
  exactAlternative: string;
}

const MARKET_VIEW_DETAILS = {
  "universe/baskets": {
    viewLabel: "Basket pricing",
    leadSurface: "basket-cost and coverage matrix",
    exactAlternative: "family composition and executable-price rows",
  },
  "universe/positions": {
    viewLabel: "Positions",
    leadSurface: "open-interest price-band map",
    exactAlternative: "family and band contract readings",
  },
  "universe/families": {
    viewLabel: "Families",
    leadSurface: "selected-family price profile",
    exactAlternative: "member markets and quote table",
  },
  "settlement/reading": {
    viewLabel: "Index",
    leadSurface: "index and settlement-basis trace",
    exactAlternative: "quality-control readings and sample values",
  },
  "settlement/formation": {
    viewLabel: "Formation",
    leadSurface: "observation-to-published-index pipeline",
    exactAlternative: "stage values and station membership",
  },
  "settlement/pending": {
    viewLabel: "Pending",
    leadSurface: "pending-minute disagreement bars",
    exactAlternative: "provisional minute rows with timestamps",
  },
  "books/ladder": {
    viewLabel: "Ladder",
    leadSurface: "mirrored executable depth ladder",
    exactAlternative: "native bids, derived asks and sizes",
  },
  "books/identity": {
    viewLabel: "Identity",
    leadSurface: "two-sided quote identity instrument",
    exactAlternative: "selected bid and implied-offer arithmetic",
  },
  "books/history": {
    viewLabel: "History",
    leadSurface: "recorded best-quote history",
    exactAlternative: "timestamped quote snapshots",
  },
  "dispersion/quotes": {
    viewLabel: "Dispersion",
    leadSurface: "maker range and concentration strips",
    exactAlternative: "sortable maker response rows",
  },
  "dispersion/channel": {
    viewLabel: "REST poll",
    leadSurface: "signed-channel lifecycle diagram",
    exactAlternative: "request-state and response ledger",
  },
  "lattice/survival": {
    viewLabel: "Survival",
    leadSurface: "strike-implied survival curve",
    exactAlternative: "selected strike and executable quote rows",
  },
  "lattice/mass": {
    viewLabel: "Mass",
    leadSurface: "adjacent-strike probability mass",
    exactAlternative: "interval mass and violation table",
  },
  "lattice/moments": {
    viewLabel: "Moment shape",
    leadSurface: "distribution moment instrument",
    exactAlternative: "moment values and measurability reasons",
  },
  "lattice/support": {
    viewLabel: "Moment support",
    leadSurface: "bounded-support and open-tail reservoir",
    exactAlternative: "interior and tail mass readings",
  },
  "stake/plan": {
    viewLabel: "Plan",
    leadSurface: "edge-to-allocation decision path",
    exactAlternative: "admitted and declined stake rows",
  },
  "stake/capital": {
    viewLabel: "Capital",
    leadSurface: "bankroll deployment and reserve split",
    exactAlternative: "capital fractions and residual cash",
  },
  "stake/method": {
    viewLabel: "Method",
    leadSurface: "solver constraint and method comparison",
    exactAlternative: "binding constraints and solve readings",
  },
  "stake/family": {
    viewLabel: "All outcomes",
    leadSurface: "all-outcome allocation surface",
    exactAlternative: "outcome ranking and exact stake table",
  },
  "fees/example": {
    viewLabel: "Worked example",
    leadSurface: "worked all-in cost stack",
    exactAlternative: "trade, rounding and net fee arithmetic",
  },
  "fees/shape": {
    viewLabel: "Cost shape",
    leadSurface: "price-indexed fee curve",
    exactAlternative: "selected price and component values",
  },
  "fees/comparison": {
    viewLabel: "Ablation",
    leadSurface: "four-model replay ablation",
    exactAlternative: "model totals and reconciliation rows",
  },
  "fees/table": {
    viewLabel: "Replay table",
    leadSurface: "row-level replay ledger",
    exactAlternative: "contracts, prices and recomputed fees",
  },
  "shell/layout": {
    viewLabel: "Namespace",
    leadSurface: "watchlist lineage and namespace map",
    exactAlternative: "path grammar and command reference",
  },
  "shell/route": {
    viewLabel: "Routing",
    leadSurface: "collateral routing activity diagram",
    exactAlternative: "same-shard and cross-shard decision result",
  },
  "shell/tree": {
    viewLabel: "Browse",
    leadSurface: "interactive read-only tree walk",
    exactAlternative: "command result and file reading",
  },
} as const satisfies Record<string, MarketViewDetail>;

export interface MarketViewContract extends MarketSectionContract, MarketViewDetail {
  section: MarketsContractSection;
  view: string;
  sectionLabel: string;
  viewLabel: string;
  deepLink: string;
  ordinal: number;
  total: number;
}

export const MARKET_VIEW_CONTRACTS: Readonly<Record<string, MarketViewContract>> = Object.fromEntries(
  Object.entries(MARKET_VIEW_DETAILS).map(([key, detail], index, orderedViews) => {
    const [section, view] = key.split("/") as [MarketsContractSection, string];
    const sectionContract = MARKET_SECTION_CONTRACTS[section];
    if (!sectionContract) throw new Error(`Markets view ${key} has no section contract`);
    return [key, {
      ...sectionContract,
      ...detail,
      section,
      view,
      sectionLabel: sectionContract.label,
      deepLink: view === sectionContract.defaultView ? `markets/${section}` : `markets/${section}/${view}`,
      ordinal: index + 1,
      total: orderedViews.length,
    }];
  }),
);

export function marketsViewContract(section: string, view: string): MarketViewContract | null {
  return MARKET_VIEW_CONTRACTS[`${section}/${view}`] ?? null;
}

export function marketsDefaultView(section: string): string | null {
  return MARKET_SECTION_CONTRACTS[section as MarketsContractSection]?.defaultView ?? null;
}
