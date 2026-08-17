"use client";

/**
 * The way out of the section you are on.
 *
 * This used to walk a fixed ring of the eight workspaces, ignoring which
 * section was on screen and what it had just said — so a reader who had just
 * read the walk-forward folds on Research was offered "Execution" whether or
 * not the candidate had cleared anything. Twenty-three rail sections carry no
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
};

/**
 * Where a reader wants to go next from each section that has a measured answer.
 *
 * Every key and every destination is a `workspace/section` pair that must exist
 * in `lib/sections`; `tests/desk-interconnect.test.ts` checks both directions,
 * because a footer naming a section the desk no longer has is a dead end
 * wearing the clothes of a next step.
 */
const NEXT_FROM: Record<string, { view: WorkspaceView; section: string; why: string }> = {
  "overview/audit": {
    view: "live",
    section: "activity",
    why: "The same orders, live. The blotter is where these rows arrive before they are accounted for here.",
  },

  "research/summary": {
    view: "research",
    section: "parameters",
    why: "The verdict names one winning pair. The ranking behind it says how far ahead of its neighbours it really was.",
  },
  "research/parameters": {
    view: "research",
    section: "walkforward",
    why: "A pair that tops the in-sample grid has still proved nothing. Walk-forward asks whether it holds on windows it never saw.",
  },
  "research/walkforward": {
    view: "research",
    section: "decision",
    why: "Out-of-sample evidence is the promotion gate's input — take it straight to the gate and the sizing that follows.",
  },
  "research/decision": {
    // Absorbed from an inline hand-off card on the decision section itself:
    // with no key here the ring fallback offered Execution at the same moment
    // PromotionPanel's staged hand-off did, shadowing it. Verifying the inputs
    // is the continuation a promotion decision actually has.
    view: "data",
    section: "overview",
    why: "Verify the inputs before approving the candidate — the trust verdict rules on exactly the bars this gate just judged.",
  },
  "research/attribution": {
    view: "risk",
    section: "model",
    why: "Factor exposure and tail shape are what the loss estimate is built from, so the same decomposition continues on the risk side.",
  },
  "research/lineage": {
    view: "data",
    section: "lineage",
    why: "The provenance question does not stop at the signal path — the data workspace traces the payload it was computed from.",
  },
  "research/runs": {
    view: "research",
    section: "summary",
    why: "The archive is a list of hypotheses. Opening one puts its verdict and its curve back on screen.",
  },

  "live/quality": {
    view: "live",
    section: "routing",
    why: "Realised cost only means something beside the model it beat or missed, which is where the venue allocation was decided.",
  },

  "portfolio/equity": {
    view: "portfolio",
    section: "performance",
    why: "The curve says what happened. Attribution says which sleeve and which cost it happened through.",
  },
  "portfolio/allocation": {
    view: "live",
    section: "trade",
    why: "A drift number is a rebalance waiting to be staged, and the ticket is where it becomes an order.",
  },
  "portfolio/performance": {
    view: "live",
    section: "quality",
    why: "Attribution charges a modelled cost. Fill quality is what the desk actually paid for it.",
  },

  "risk/model": {
    view: "risk",
    section: "montecarlo",
    why: "Same driver, distribution form: the bootstrap resamples exactly the returns this estimate was fitted to.",
  },
  "risk/scenarios": {
    view: "risk",
    section: "controls",
    why: "A scenario that breaches the drawdown budget wants the halt beside it, not a note to find it later.",
  },
  "risk/controls": {
    view: "portfolio",
    section: "positions",
    why: "After a halt or a flatten, the holdings table is where you confirm what actually moved.",
  },

  "data/overview": {
    view: "data",
    section: "feeds",
    why: "The trust verdict is a summary of the feeds. Their freshness, contracts and validation are the evidence for it.",
  },
  "data/lineage": {
    view: "data",
    section: "quality",
    why: "A traced payload is worth validating: reconciliation, contract checks and the quarantine sit one section along.",
  },
  "data/queue": {
    view: "data",
    section: "quality",
    why: "Every item in this queue was created by a finding — this is where those findings are raised and cleared.",
  },

  "reliability/events": {
    view: "reliability",
    section: "controls",
    why: "A correlated log is the input to a remediation, and the guarded actions that answer it are here.",
  },
  "reliability/controls": {
    view: "reliability",
    section: "events",
    why: "An operator action is only finished once the mutation is visible in the stream. Verify it landed.",
  },

  "developer/quality": {
    view: "developer",
    section: "apis",
    why: "The pipeline's last gate is the contract: OpenAPI drift against the committed digest is checked here.",
  },
  "developer/apis": {
    view: "developer",
    section: "codebase",
    why: "A route that changed shape has a source file behind it, with the change custody to match.",
  },
  "developer/codebase": {
    view: "developer",
    section: "quality",
    why: "A diff is unproven until the pipeline has run over it — the test gates and artefacts are the proof.",
  },
  "developer/work": {
    view: "developer",
    section: "codebase",
    why: "Work items reference files. Open the repository view to read what an item is actually about.",
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
const FLOW_MAP: Record<WorkspaceView, { nextId: WorkspaceView; roleLabel: string; kicker: string; title: string; hint: string }> = {
  overview: {
    nextId: "research",
    roleLabel: "Quant researcher",
    kicker: "Next step for the quant researcher",
    title: "Validate strategy and signal evidence",
    hint: "Move from desk overview to parameter sweeps, stability metrics, and walk-forward analysis.",
  },
  research: {
    nextId: "live",
    roleLabel: "Quant trader",
    kicker: "Next step for the quant trader",
    title: "Stage paper execution and market depth",
    hint: "Inspect the consolidated L2 order book, venue routing costs, and pre-trade gate validation.",
  },
  live: {
    nextId: "portfolio",
    roleLabel: "Portfolio manager",
    kicker: "Next step for the portfolio manager",
    title: "Review positions and P&L attribution",
    hint: "Reconcile the equity curve, sleeve breakdown, concentration, and intraday P&L waterfall.",
  },
  portfolio: {
    nextId: "risk",
    roleLabel: "Risk manager",
    kicker: "Next step for the risk manager",
    title: "Audit pre-trade risk and limits",
    hint: "Check gross/net headroom, historical VaR, stress scenario testing, and kill switch state.",
  },
  risk: {
    nextId: "data",
    roleLabel: "Data engineer",
    kicker: "Next step for the data engineer",
    title: "Verify data lineage and feed freshness",
    hint: "Audit market feed freshness, provider quotas, contract evidence, and the pipeline DAG.",
  },
  data: {
    nextId: "reliability",
    roleLabel: "DevOps / SRE",
    kicker: "Next step for DevOps and SRE",
    title: "Check SRE telemetry and circuit health",
    hint: "Monitor provider API latency percentiles, active incident alerts, and recovery workflows.",
  },
  reliability: {
    nextId: "developer",
    roleLabel: "Quant developer",
    kicker: "Next step for the quant developer",
    title: "Inspect CI/CD and schema contracts",
    hint: "Verify deployment topology, the launch readiness ring, OpenAPI diffs, and the task queue.",
  },
  developer: {
    nextId: "overview",
    roleLabel: "Desk command centre",
    kicker: "Next step around the decision loop",
    title: "Return to the desk overview",
    hint: "Complete the operating loop and return to the unified desk dashboard.",
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
