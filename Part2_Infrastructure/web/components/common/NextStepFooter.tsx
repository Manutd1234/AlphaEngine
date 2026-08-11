"use client";

import type { WorkspaceView } from "@/components/WorkspaceHeader";

interface NextStepFooterProps {
  currentView: WorkspaceView;
  onNavigate: (nextView: WorkspaceView) => void;
}

const FLOW_MAP: Record<WorkspaceView, { nextId: WorkspaceView; roleLabel: string; title: string; hint: string }> = {
  overview: {
    nextId: "research",
    roleLabel: "Quant Researcher",
    title: "Validate Strategy & Signal Evidence",
    hint: "Move from desk overview to parameter sweeps, stability metrics, and walk-forward analysis.",
  },
  research: {
    nextId: "live",
    roleLabel: "Quant Trader",
    title: "Stage Paper Execution & Market Depth",
    hint: "Inspect consolidated L2 order book, venue routing costs, and pre-trade gate validation.",
  },
  live: {
    nextId: "portfolio",
    roleLabel: "Portfolio Manager",
    title: "Review Positions & P&L Attribution",
    hint: "Reconcile equity curve, sleeve breakdown, concentration, and intraday P&L waterfall.",
  },
  portfolio: {
    nextId: "risk",
    roleLabel: "Risk Manager",
    title: "Audit Pre-Trade Risk & Limits",
    hint: "Check gross/net headroom, historical VaR, stress scenario testing, and kill switch state.",
  },
  risk: {
    nextId: "data",
    roleLabel: "Data Engineer",
    title: "Verify Data Lineage & Feed Freshness",
    hint: "Audit market feed freshness, provider quotas, contract evidence, and pipeline DAG.",
  },
  data: {
    nextId: "reliability",
    roleLabel: "DevOps / SRE",
    title: "Check SRE Telemetry & Circuit Health",
    hint: "Monitor provider API latency percentiles, active incident alerts, and recovery workflows.",
  },
  reliability: {
    nextId: "developer",
    roleLabel: "Quant Developer",
    title: "Inspect CI/CD & Schema Contracts",
    hint: "Verify deployment topology, launch readiness ring, OpenAPI diffs, and task queue.",
  },
  developer: {
    nextId: "overview",
    roleLabel: "Desk Command Center",
    title: "Return to Desk Overview",
    hint: "Complete the operating loop and return to the unified desk dashboard.",
  },
};

export default function NextStepFooter({ currentView, onNavigate }: NextStepFooterProps) {
  const step = FLOW_MAP[currentView];
  if (!step) return null;

  return (
    <footer className="next-step-footer" aria-label="Decision loop progression">
      <div className="next-step-footer__content">
        <div className="next-step-footer__info">
          <span className="next-step-footer__kicker">Decision Loop Flow · {step.roleLabel}</span>
          <h3 className="next-step-footer__title">{step.title}</h3>
          <p className="next-step-footer__hint">{step.hint}</p>
        </div>
        <button
          type="button"
          className="next-step-footer__action"
          onClick={() => onNavigate(step.nextId)}
        >
          <span>Next Step</span>
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </footer>
  );
}
