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

const roleCards: Array<{
  role: string;
  title: string;
  description: string;
  destination: WorkspaceView;
  action: string;
}> = [
  {
    role: "PM",
    title: "Portfolio manager",
    description: "Review the investment case, validation quality, drawdown and implementation constraints in one decision trail.",
    destination: "portfolio",
    action: "Open portfolio",
  },
  {
    role: "TR",
    title: "Trader",
    description: "Price the current order intent against consolidated depth and compare live impact with the research assumption.",
    destination: "live",
    action: "Open execution",
  },
  {
    role: "RS",
    title: "Researcher",
    description: "Run parameter grids, inspect robustness and promote only candidates that survive walk-forward validation.",
    destination: "research",
    action: "Open research lab",
  },
  {
    role: "DX",
    title: "Developer & data ops",
    description: "Trace quote provenance, provider health, quotas and the API surfaces that power the desk.",
    destination: "data",
    action: "Inspect systems",
  },
];

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

  return (
    <div className="overview-page">
      <section className="overview-hero">
        <div>
          <span className="page-kicker">Investment decision cockpit</span>
          <h1>One operating context from idea to execution.</h1>
          <p>
            AlphaEngine keeps the instrument, research candidate, order intent and data lineage
            connected so every role works from the same decision record.
          </p>
        </div>
        <div className="hero-actions">
          <button className="primary-action" onClick={() => onNavigate("portfolio")}>Review portfolio</button>
          <button className="secondary-action" onClick={() => onNavigate("research")}>Continue research</button>
        </div>
      </section>

      <section className="decision-metrics" aria-label="Current decision context">
        <div>
          <span>Active instrument</span>
          <strong className="num">{request.symbol}</strong>
          <small>{request.interval} decision horizon</small>
        </div>
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
        <div>
          <span>Data plane</span>
          <strong className="num">{providers}</strong>
          <small>{providerSummary?.degraded ? `${providerSummary.degraded} degraded` : "provider routes ready"}</small>
        </div>
      </section>

      <section className="overview-section">
        <div className="section-heading">
          <div>
            <span className="page-kicker">Connected workflow</span>
            <h2>Decision pipeline</h2>
          </div>
          <span className="section-note">Context passes forward; assumptions stay visible.</span>
        </div>

        <div className="pipeline-grid">
          <article className="pipeline-card">
            <div className="pipeline-card__step"><span>01</span> Research</div>
            <h3>{candidate}</h3>
            <p>{result ? result.verdict.headline : "A baseline parameter sweep is running for the active instrument."}</p>
            <div className="pipeline-card__meta">
              <span>Source</span>
              <strong>{result ? (result.dataSource === "binance" ? "Binance market data" : "Synthetic fallback") : "Resolving"}</strong>
            </div>
            <button onClick={() => onNavigate("research")}>Inspect evidence <span aria-hidden>→</span></button>
          </article>

          <article className="pipeline-card">
            <div className="pipeline-card__step"><span>02</span> Execution</div>
            <h3 className="num">{side} {request.symbol} · {usd(notional, 0)}</h3>
            <p>Walk the cross-venue book and check whether live impact remains inside the modeled cost budget.</p>
            <div className="pipeline-card__meta">
              <span>Research budget</span>
              <strong className="num">{request.slippageBps} bps slippage</strong>
            </div>
            <button onClick={() => onNavigate("live")}>Price order intent <span aria-hidden>→</span></button>
          </article>

          <article className="pipeline-card">
            <div className="pipeline-card__step"><span>03</span> Data & systems</div>
            <h3>{providerSummary ? `${providerSummary.configured} providers configured` : "Provider registry loading"}</h3>
            <p>Verify the quote, compare sources and trace the upstream route before a number enters a decision.</p>
            <div className="pipeline-card__meta">
              <span>Last research run</span>
              <strong>{result ? `${result.bars.toLocaleString()} bars · ${result.durationMs} ms` : "Pending"}</strong>
            </div>
            <button onClick={() => onNavigate("data")}>Verify lineage <span aria-hidden>→</span></button>
          </article>
        </div>
      </section>

      <section className="overview-section">
        <div className="section-heading">
          <div>
            <span className="page-kicker">Shared infrastructure</span>
            <h2>Built around the desk, not isolated tools</h2>
          </div>
        </div>

        <div className="role-grid">
          {roleCards.map((card) => (
            <button className="role-card" key={card.role} onClick={() => onNavigate(card.destination)}>
              <span className="role-monogram" aria-hidden>{card.role}</span>
              <span className="role-card__body">
                <strong>{card.title}</strong>
                <small>{card.description}</small>
                <span>{card.action} →</span>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
