"use client";

/**
 * The way out of the section you are on.
 *
 * This used to walk a fixed ring of the eight workspaces, ignoring which
 * section was on screen and what it had just said — so a reader who had just
 * read the walk-forward folds on Research was offered "Execution" whether or
 * not the candidate had cleared anything. Twenty rail sections carry no
 * outbound contextual link of their own, and for those this footer is the only
 * exit; a generic one is barely better than none.
 *
 * So the destination is keyed by `workspace/section` — the same pair the rail
 * and the URL hash use — and the ring survives only as the fallback, where it
 * is honest: a handoff to the next desk role rather than a continuation of the
 * thing just read.
 */

import { NAV_ITEMS, type WorkspaceView } from "@/components/WorkspaceHeader";
import {
  DATA_SECTIONS,
  COHERENCE_SECTIONS,
  DEVELOPER_SECTIONS,
  EXECUTION_SECTIONS,
  OVERVIEW_SECTIONS,
  PORTFOLIO_SECTIONS,
  RELIABILITY_SECTIONS,
  RESEARCH_SECTIONS,
  RISK_SECTIONS,
  type WorkspaceSectionDef,
} from "@/lib/sections";

interface NextStepFooterProps {
  currentView: WorkspaceView;
  /** The rail section on screen — what the reader has just finished reading. */
  currentSection: string;
  onNavigate: (nextView: WorkspaceView, section?: string) => void;
}

/**
 * The rails themselves, so the destination's name and one-line description are
 * read from `lib/sections` rather than mirrored here. A label that drifted from
 * the rail would send a reader looking for a section that no longer goes by
 * that name.
 */
const SECTIONS_BY_VIEW: Record<WorkspaceView, readonly WorkspaceSectionDef[]> = {
  overview: OVERVIEW_SECTIONS,
  research: RESEARCH_SECTIONS,
  live: EXECUTION_SECTIONS,
  portfolio: PORTFOLIO_SECTIONS,
  risk: RISK_SECTIONS,
  data: DATA_SECTIONS,
  reliability: RELIABILITY_SECTIONS,
  developer: DEVELOPER_SECTIONS,
  coherence: COHERENCE_SECTIONS,
};

/**
 * Where a reader wants to go next from each section that has a measured answer.
 *
 * Every key and every destination is a `workspace/section` pair that must exist
 * in `lib/sections`; `tests/desk-interconnect-next-step.test.ts` checks both directions,
 * because a footer naming a section the desk no longer has is a dead end
 * wearing the clothes of a next step.
 */
const NEXT_FROM: Record<string, { view: WorkspaceView; section: string; why: string }> = {
  "overview/audit": {
    view: "live",
    section: "activity",
    why: "These rows arrive there live.",
  },

  "research/summary": {
    view: "research",
    section: "parameters",
    why: "The winner, not the margin.",
  },
  "research/parameters": {
    view: "research",
    section: "walkforward",
    why: "In-sample rank needs unseen windows.",
  },
  "research/walkforward": {
    view: "research",
    section: "decision",
    why: "The promotion gate's input.",
  },
  "research/decision": {
    // Absorbed from an inline hand-off card on the decision section itself:
    // with no key here the ring fallback offered Execution at the same moment
    // PromotionPanel's staged hand-off did, shadowing it. Verifying the inputs
    // is the continuation a promotion decision actually has.
    view: "data",
    section: "overview",
    why: "Trust evidence for the bars just judged.",
  },
  "research/attribution": {
    view: "risk",
    section: "model",
    why: "Built from exposure and tail shape.",
  },
  "research/lineage": {
    view: "data",
    section: "lineage",
    why: "The source payload's own trail.",
  },
  "research/runs": {
    view: "research",
    section: "summary",
    why: "An archived hypothesis restores its curve.",
  },

  "live/quality": {
    view: "live",
    section: "routing",
    why: "Realised cost needs its benchmark model.",
  },

  "portfolio/equity": {
    view: "portfolio",
    section: "performance",
    why: "The curve hides sleeve and cost.",
  },
  "portfolio/allocation": {
    view: "live",
    section: "trade",
    why: "Drift is a rebalance waiting.",
  },
  "portfolio/performance": {
    view: "live",
    section: "quality",
    why: "Attribution charges a modelled cost.",
  },

  // The engine's own continuation, not the next desk's: the loss estimate on
  // `model` is a forecast, and `diagram` is where it gets marked against what
  // the book actually lost. Sending a reader straight from the forecast to a
  // second forecast (montecarlo) offered a second opinion before the first one
  // had been scored, which is the order this split exists to correct.
  "risk/model": {
    view: "risk",
    section: "diagram",
    why: "A forecast is a claim until it is scored.",
  },
  "risk/diagram": {
    view: "risk",
    section: "montecarlo",
    why: "The bootstrap resamples these returns.",
  },
  "risk/drivers": {
    view: "risk",
    section: "scenarios",
    why: "Volatility-carrying positions move most under shock.",
  },
  "risk/scenarios": {
    view: "risk",
    section: "controls",
    why: "A breached budget wants the halt.",
  },
  "risk/controls": {
    view: "portfolio",
    section: "positions",
    why: "Confirm what a halt actually moved.",
  },

  "data/overview": {
    view: "data",
    section: "feeds",
    why: "The evidence behind the verdict.",
  },
  "data/lineage": {
    view: "data",
    section: "quality",
    why: "A traced payload still needs validating.",
  },
  "data/queue": {
    view: "data",
    section: "quality",
    why: "Every item came from a finding there.",
  },

  "reliability/events": {
    view: "reliability",
    section: "controls",
    why: "A remediation's input.",
  },
  "reliability/controls": {
    view: "reliability",
    section: "events",
    why: "An action lands when the mutation shows.",
  },

  "developer/quality": {
    view: "developer",
    section: "apis",
    why: "The last gate is the contract digest.",
  },
  "developer/apis": {
    view: "developer",
    section: "codebase",
    why: "A changed route has a source file.",
  },
  "developer/codebase": {
    view: "developer",
    section: "quality",
    why: "Unproven until the pipeline runs.",
  },
  "developer/work": {
    view: "developer",
    section: "codebase",
    why: "Work items reference files.",
  },
};

/**
 * The role ring, kept as the fallback for the twenty sections with no measured
 * continuation of their own.
 *
 * It names no section deliberately: this is a handoff between desk roles, not a
 * continuation, so it does not claim to know which panel the reader wants and
 * leaves them where they last were in that workspace.
 */
/* Sentence case and British spelling, like the contextual variant above it —
   the ring used to shout Title Case and American "Center" while the measured
   steps spoke the house voice, two registers in one footer. */
const FLOW_MAP: Record<WorkspaceView, { nextId: WorkspaceView; kicker: string; title: string; hint: string }> = {
  overview: {
    nextId: "research",
    kicker: "Next step for the quant researcher",
    title: "Validate strategy and signal evidence",
    hint: "Parameter sweeps, stability and walk-forward.",
  },
  research: {
    nextId: "live",
    kicker: "Next step for the quant trader",
    title: "Stage paper execution and market depth",
    hint: "L2 depth, routing costs, pre-trade gates.",
  },
  live: {
    nextId: "portfolio",
    kicker: "Next step for the portfolio manager",
    title: "Review positions and P&L attribution",
    hint: "Equity curve, sleeves, concentration, P&L waterfall.",
  },
  portfolio: {
    nextId: "risk",
    kicker: "Next step for the risk manager",
    title: "Audit pre-trade risk and limits",
    hint: "Headroom, VaR, stress scenarios, kill switch.",
  },
  risk: {
    nextId: "data",
    kicker: "Next step for the data engineer",
    title: "Verify data lineage and feed freshness",
    hint: "Provider quotas, contract evidence, pipeline DAG.",
  },
  data: {
    nextId: "reliability",
    kicker: "Next step for DevOps and SRE",
    title: "Check SRE telemetry and circuit health",
    hint: "Latency percentiles, incidents, recovery workflows.",
  },
  reliability: {
    nextId: "developer",
    kicker: "Next step for the quant developer",
    title: "Inspect CI/CD and schema contracts",
    hint: "Deployment topology, OpenAPI diffs, task queue.",
  },
  developer: {
    nextId: "coherence",
    kicker: "Next step for the quant researcher",
    title: "Test a market against its own probabilities",
    hint: "Basket totals, book identities, recorded tape.",
  },
  coherence: {
    nextId: "overview",
    kicker: "Next step around the decision loop",
    title: "Return to the desk overview",
    hint: "Equity, decision pipeline, audit trail.",
  },
};

/**
 * The tab's own visible label, not its accessible one: this names the tab the
 * reader is about to land on, and "Next step in Data operations" would send them
 * looking for a tab that reads "Data".
 */
function workspaceLabel(view: WorkspaceView): string {
  return NAV_ITEMS.find((nav) => nav.id === view)?.label ?? view;
}

export default function NextStepFooter({ currentView, currentSection, onNavigate }: NextStepFooterProps) {
  const contextual = NEXT_FROM[`${currentView}/${currentSection}`];
  // Resolved against the rail rather than trusted: a section that was renamed
  // out of lib/sections drops this footer back to the role ring instead of
  // offering a button that lands nowhere in particular.
  const destination = contextual
    ? SECTIONS_BY_VIEW[contextual.view].find((section) => section.id === contextual.section)
    : undefined;
  const ring = FLOW_MAP[currentView];

  const step = contextual && destination
    ? {
        view: contextual.view,
        section: contextual.section as string | undefined,
        kicker: `Next step in ${workspaceLabel(contextual.view)}`,
        title: `${destination.label} — ${destination.description}`,
        hint: contextual.why,
        action: `Open ${destination.label}`,
      }
    : {
        view: ring.nextId,
        section: undefined,
        kicker: ring.kicker,
        title: ring.title,
        hint: ring.hint,
        action: "Next step",
      };

  return (
    <footer className="next-step-footer" aria-label="Suggested next step">
      <div className="next-step-footer__content">
        <div className="next-step-footer__info">
          <span className="next-step-footer__kicker">{step.kicker}</span>
          <h3 className="next-step-footer__title">{step.title}</h3>
          <p className="next-step-footer__hint">{step.hint}</p>
        </div>
        <button
          type="button"
          className="next-step-footer__action"
          onClick={() => onNavigate(step.view, step.section)}
        >
          <span>{step.action}</span>
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </footer>
  );
}
