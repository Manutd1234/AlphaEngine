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
            <h2>Connected workflow</h2>
          </div>
        </div>

        <div className="pipeline-grid">
          <button type="button" className="pipeline-card pipeline-card--action" onClick={() => onNavigate("portfolio")}>
            <span className="pipeline-card__step"><span>01</span> Portfolio</span>
            <strong className="pipeline-card__value">Book, exposure &amp; risk</strong>
            <small className="pipeline-card__status">Positions, concentration and risk headroom</small>
            <span className="pipeline-card__link">Open portfolio <span aria-hidden>→</span></span>
          </button>

          <button type="button" className="pipeline-card pipeline-card--action" onClick={() => onNavigate("research")}>
            <span className="pipeline-card__step"><span>02</span> Research</span>
            <strong className="pipeline-card__value">{candidate}</strong>
            <small className="pipeline-card__status">{researchStatus}</small>
            <span className="pipeline-card__link">Inspect evidence <span aria-hidden>→</span></span>
          </button>

          <button type="button" className="pipeline-card pipeline-card--action" onClick={() => onNavigate("live")}>
            <span className="pipeline-card__step"><span>03</span> Execution</span>
            <strong className="pipeline-card__value num">{side} {request.symbol} · {usd(notional, 0)}</strong>
            <small className="pipeline-card__status">{request.slippageBps} bps modeled cost budget</small>
            <span className="pipeline-card__link">Price order intent <span aria-hidden>→</span></span>
          </button>

          <button type="button" className="pipeline-card pipeline-card--action" onClick={() => onNavigate("data")}>
            <span className="pipeline-card__step"><span>04</span> Systems</span>
            <strong className="pipeline-card__value num">{providers}</strong>
            <small className="pipeline-card__status">{systemStatus}</small>
            <span className="pipeline-card__link">Verify lineage <span aria-hidden>→</span></span>
          </button>
        </div>
      </section>
    </div>
  );
}
