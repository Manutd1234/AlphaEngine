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
  { id: "model", label: "VaR & model", description: "Loss estimates & drivers" },
  { id: "montecarlo", label: "Monte Carlo", description: "Terminal distribution & tail" },
  { id: "scenarios", label: "Stress tests", description: "Forward shock damage" },
  { id: "controls", label: "Controls", description: "Halt & flatten handoffs" },
] as const;
export type RiskSection = (typeof RISK_SECTIONS)[number]["id"];
export const RISK_SECTION_IDS = RISK_SECTIONS.map((s) => s.id) as readonly RiskSection[];

export const DATA_SECTIONS = [
  { id: "overview", label: "Trust Summary", description: "Verdict, composition & boundary" },
  { id: "feeds", label: "Feeds & Contracts", description: "Freshness, validation & next action" },
  { id: "quality", label: "Quality & Incidents", description: "Reconcile, contracts & quarantine" },
  { id: "lineage", label: "Lineage & Payloads", description: "Trace source, cache & coercion" },
  { id: "providers", label: "Providers & Capacity", description: "Failover, quota & reserve" },
  { id: "queue", label: "Work Queue", description: "Mocked, session-only workflow" },
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
