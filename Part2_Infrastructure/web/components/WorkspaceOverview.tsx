"use client";

import { STRATEGY_LABELS, SweepRequest, SweepResponse } from "@/lib/types";
import { fmt, signedPct, usd } from "@/lib/format";
import type { Side } from "@/lib/venues";
import type { WorkspaceView } from "@/components/WorkspaceHeader";

interface WorkspaceOverviewProps {
  request: SweepRequest;
  result: SweepResponse | null;
  running: boolean;
  side: Side;
  notional: number;
  providerSummary: { configured: number; total: number; degraded: number } | null;
  onNavigate: (view: WorkspaceView) => void;
}

export default function WorkspaceOverview({
  request,
  result,
  running,
  side,
  notional,
  providerSummary,
  onNavigate,
}: WorkspaceOverviewProps) {
  const candidate = result
    ? `${STRATEGY_LABELS[result.request.strategy]} · ${result.best.fast}/${result.best.slow}`
    : STRATEGY_LABELS[request.strategy];
  const validation = result
    ? result.walkForwardOosSharpe == null
      ? "Not available"
      : fmt(result.walkForwardOosSharpe, 2)
    : running
      ? "Running"
      : "Pending";
  const providers = providerSummary
    ? `${providerSummary.configured}/${providerSummary.total}`
    : "Checking";
  const researchStatus = result
    ? `${result.verdict.level.toUpperCase()} · ${validation} OOS Sharpe`
    : running
      ? "Baseline running"
      : "Awaiting validation";
  const systemStatus = providerSummary?.degraded
    ? `${providerSummary.degraded} degraded`
    : providerSummary
      ? `${providers} ready`
      : "Checking routes";

  const context: RoleContext = {
    symbol: request.symbol,
    candidate,
    researchStatus,
    side,
    notional,
    slippageBps: request.slippageBps,
    providers,
    systemStatus,
  };

  return (
    <div className="overview-page">
      <section className="overview-hero">
        <div>
          <span className="page-kicker">Decision overview</span>
          <h1>{request.symbol} decision workspace</h1>
          <p>Research evidence, portfolio risk, execution intent and data health in one shared context — for every desk role, reconciling to the same audit log.</p>
        </div>
      </section>

      <section className="decision-metrics" aria-label="Current decision context">
        <div>
          <span>Research candidate</span>
          <strong>{candidate}</strong>
          <small>{result ? `${result.verdict.level.toUpperCase()} validation verdict` : "First sweep in progress"}</small>
        </div>
        <div>
          <span>Out-of-sample Sharpe</span>
          <strong className="num">{validation}</strong>
          <small>{result ? `${signedPct(result.best.totalReturn)} in-sample return` : "Awaiting result"}</small>
        </div>
        <div>
          <span>Order intent</span>
          <strong className="num">{side} {usd(notional, 0)}</strong>
          <small>{request.slippageBps} bps modeled slippage</small>
        </div>
      </section>

      <section className="overview-section">
        <div className="section-heading">
          <div>
            <span className="page-kicker">Workspaces</span>
            <h2>One tab per desk role</h2>
          </div>
          <span className="section-note">
            Each role owns its surface; every action still lands in the same audit log.
          </span>
        </div>

        {/* Ordered the way work moves — an idea is researched, executed, held,
            and constrained — then the three roles that keep that possible. */}
        <div className="role-grid">
          {ROLE_CARDS.map((card) => (
            <button
              type="button"
              key={card.view}
              className="pipeline-card pipeline-card--action role-card"
              onClick={() => onNavigate(card.view)}
            >
              <span className="pipeline-card__step">{card.role}</span>
              <strong className="pipeline-card__value">{card.headline(context)}</strong>
              <small className="pipeline-card__status">{card.status(context)}</small>
              <span className="pipeline-card__link">{card.action} <span aria-hidden>→</span></span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

interface RoleContext {
  symbol: string;
  candidate: string;
  researchStatus: string;
  side: Side;
  notional: number;
  slippageBps: number;
  providers: string;
  systemStatus: string;
}

/**
 * The seven roles the platform is built for. Each card states what that role
 * would open the tab to find out, filled in from live context where there is
 * any — a launcher that only listed names would be a table of contents.
 */
const ROLE_CARDS: {
  view: WorkspaceView;
  role: string;
  action: string;
  headline: (context: RoleContext) => string;
  status: (context: RoleContext) => string;
}[] = [
  {
    view: "research",
    role: "Quant researcher",
    action: "Inspect evidence",
    headline: (c) => c.candidate,
    status: (c) => c.researchStatus,
  },
  {
    view: "live",
    role: "Quant trader",
    action: "Work the order",
    headline: (c) => `${c.side} ${c.symbol} · ${usd(c.notional, 0)}`,
    status: (c) => `${c.slippageBps} bps modeled cost budget`,
  },
  {
    view: "portfolio",
    role: "Portfolio manager",
    action: "Open the book",
    headline: () => "Positions & allocation",
    status: () => "Exposure, concentration and sleeve attribution",
  },
  {
    view: "risk",
    role: "Risk manager",
    action: "Check headroom",
    headline: () => "Limits & tail risk",
    status: () => "VaR scored against its own record, scenarios, kill switch",
  },
  {
    view: "data",
    role: "Data engineer",
    action: "Verify lineage",
    headline: (c) => c.providers,
    status: () => "Routing, source agreement, quarantine and quota",
  },
  {
    view: "reliability",
    role: "DevOps / SRE",
    action: "Check health",
    headline: (c) => c.systemStatus,
    status: () => "Breakers, latency percentiles, trace and outage drills",
  },
  {
    view: "developer",
    role: "Quant developer",
    action: "Read the contract",
    headline: () => "API & verification",
    status: () => "Committed schema, parity fixtures and the CI gates",
  },
];
